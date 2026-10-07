import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { appendAudit } from "@ewm/audit";
import { schema, type Database, type Tx } from "@ewm/database";
import type { CreateTicketInput, TicketStatus } from "@ewm/shared";
import type { AuthUser } from "../context";
import { badRequest, notFound } from "../errors";

const { tickets, ticketEvents, projects, sapSystems, environments, users } = schema;

const reporter = alias(users, "reporter");

const listColumns = {
  id: tickets.id,
  number: tickets.number,
  title: tickets.title,
  status: tickets.status,
  priority: tickets.priority,
  process: tickets.process,
  warehouse: tickets.warehouse,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
  reportedByName: reporter.name,
  sapSystemSid: sapSystems.sid,
  sapSystemAdapter: sapSystems.adapter,
};

export function listTickets(
  db: Database,
  projectId: string,
  filter: { status?: TicketStatus } = {},
) {
  return db
    .select(listColumns)
    .from(tickets)
    .innerJoin(reporter, eq(reporter.id, tickets.reportedBy))
    .leftJoin(sapSystems, eq(sapSystems.id, tickets.sapSystemId))
    .where(
      and(
        eq(tickets.projectId, projectId),
        filter.status ? eq(tickets.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(tickets.number))
    .limit(500);
}

export async function createTicket(
  db: Database,
  actor: AuthUser,
  projectId: string,
  input: CreateTicketInput,
  opts: { ip?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    if (input.sapSystemId) {
      // A ticket may only point at a system of its own project.
      const [system] = await tx
        .select({ id: sapSystems.id })
        .from(sapSystems)
        .where(and(eq(sapSystems.id, input.sapSystemId), eq(sapSystems.projectId, projectId)))
        .limit(1);
      if (!system) throw badRequest("The selected SAP system does not belong to this project.");
    }
    // Ticket numbers count up per project. The row lock on the project makes them gap-free.
    const [seq] = await tx
      .update(projects)
      .set({ ticketSeq: sql`${projects.ticketSeq} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ number: projects.ticketSeq, key: projects.key });
    if (!seq) throw notFound("Project");

    const [ticket] = await tx
      .insert(tickets)
      .values({
        projectId,
        number: seq.number,
        title: input.title,
        description: input.description,
        priority: input.priority,
        process: input.process,
        warehouse: input.warehouse ?? null,
        sapSystemId: input.sapSystemId ?? null,
        reportedBy: actor.id,
      })
      .returning();
    await tx.insert(ticketEvents).values({
      projectId,
      ticketId: ticket!.id,
      type: "created",
      actorUserId: actor.id,
    });
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "ticket.created",
      entityType: "ticket",
      entityId: ticket!.id,
      data: {
        reference: `${seq.key}-${seq.number}`,
        title: ticket!.title,
        priority: ticket!.priority,
      },
      ip: opts.ip,
    });
    return { ...ticket!, reference: `${seq.key}-${seq.number}` };
  });
}

/** The human reference of a ticket, e.g. MUHW-12. */
async function ticketReference(tx: Tx, projectId: string, number: number): Promise<string> {
  const [project] = await tx
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return `${project?.key ?? "?"}-${number}`;
}

export async function getTicket(db: Database, projectId: string, ticketId: string) {
  const [ticket] = await db
    .select({
      ...listColumns,
      description: tickets.description,
      closedAt: tickets.closedAt,
      sapSystemId: tickets.sapSystemId,
      sapSystemName: sapSystems.name,
      sapSystemClient: sapSystems.client,
      sapSystemEnvironment: environments.kind,
    })
    .from(tickets)
    .innerJoin(reporter, eq(reporter.id, tickets.reportedBy))
    .leftJoin(sapSystems, eq(sapSystems.id, tickets.sapSystemId))
    .leftJoin(environments, eq(environments.id, sapSystems.environmentId))
    // Both conditions matter: the ticket must exist and must belong to this project.
    .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, projectId)))
    .limit(1);
  if (!ticket) throw notFound("Ticket");

  const events = await db
    .select({
      id: ticketEvents.id,
      type: ticketEvents.type,
      actorType: ticketEvents.actorType,
      actorName: users.name,
      body: ticketEvents.body,
      data: ticketEvents.data,
      createdAt: ticketEvents.createdAt,
    })
    .from(ticketEvents)
    .leftJoin(users, eq(users.id, ticketEvents.actorUserId))
    .where(and(eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.projectId, projectId)))
    .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
  return { ...ticket, events };
}

export async function addComment(
  db: Database,
  actor: AuthUser,
  projectId: string,
  ticketId: string,
  body: string,
  opts: { ip?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, projectId)))
      .returning({ id: tickets.id, number: tickets.number });
    if (!ticket) throw notFound("Ticket");
    const reference = await ticketReference(tx, projectId, ticket.number);
    const [event] = await tx
      .insert(ticketEvents)
      .values({ projectId, ticketId, type: "comment", actorUserId: actor.id, body })
      .returning();
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "ticket.commented",
      entityType: "ticket",
      entityId: ticketId,
      data: { reference, eventId: event!.id, length: body.length },
      ip: opts.ip,
    });
    return event!;
  });
}

export async function changeStatus(
  db: Database,
  actor: AuthUser,
  projectId: string,
  ticketId: string,
  input: { status: TicketStatus; note?: string },
  opts: { ip?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: tickets.status, number: tickets.number })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, projectId)))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Ticket");
    if (current.status === input.status)
      throw badRequest(`The ticket is already ${input.status.replace("_", " ")}.`);

    const now = new Date();
    await tx
      .update(tickets)
      .set({
        status: input.status,
        updatedAt: now,
        closedAt: input.status === "closed" ? now : null,
      })
      .where(eq(tickets.id, ticketId));
    await tx.insert(ticketEvents).values({
      projectId,
      ticketId,
      type: "status_changed",
      actorUserId: actor.id,
      body: input.note ?? "",
      data: { from: current.status, to: input.status },
    });
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "ticket.status_changed",
      entityType: "ticket",
      entityId: ticketId,
      data: {
        reference: await ticketReference(tx, projectId, current.number),
        from: current.status,
        to: input.status,
      },
      ip: opts.ip,
    });
    return { id: ticketId, status: input.status };
  });
}
