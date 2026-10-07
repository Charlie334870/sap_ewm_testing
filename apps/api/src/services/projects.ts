import { and, asc, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import { schema, type Database } from "@ewm/database";
import { ENVIRONMENT_KINDS, type CreateProjectInput, type ProjectRole } from "@ewm/shared";
import type { AuthUser } from "../context";
import { badRequest, conflict, notFound } from "../errors";
import { isUniqueViolation } from "./pg-errors";

const { projects, projectMembers, environments, users, tickets, sapSystems, ticketEvents } = schema;

/** Projects the user can see: all in the organisation for its administrators, otherwise memberships. */
export async function listProjects(db: Database, user: AuthUser) {
  const base = db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
    })
    .from(projects);
  if (user.isOrgAdmin) {
    const rows = await base
      .where(eq(projects.organizationId, user.organizationId))
      .orderBy(asc(projects.name));
    return rows.map((p) => ({ ...p, role: "admin" as ProjectRole }));
  }
  const memberships = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));
  if (memberships.length === 0) return [];
  const roleByProject = new Map(memberships.map((m) => [m.projectId, m.role]));
  const rows = await base
    .where(
      and(
        eq(projects.organizationId, user.organizationId),
        inArray(
          projects.id,
          memberships.map((m) => m.projectId),
        ),
      ),
    )
    .orderBy(asc(projects.name));
  return rows.map((p) => ({ ...p, role: roleByProject.get(p.id)! }));
}

export async function createProject(
  db: Database,
  actor: AuthUser,
  input: CreateProjectInput,
  opts: { ip?: string | null } = {},
) {
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          organizationId: actor.organizationId,
          key: input.key,
          name: input.name,
          description: input.description,
          createdBy: actor.id,
        })
        .returning();
      // Every project starts with the three environments. Production is the strictest.
      await tx.insert(environments).values(
        ENVIRONMENT_KINDS.map((kind) => ({
          projectId: project!.id,
          kind,
          requiresChangeReference: kind === "PROD",
        })),
      );
      await tx.insert(projectMembers).values({
        projectId: project!.id,
        userId: actor.id,
        role: "admin",
        addedBy: actor.id,
      });
      await appendAudit(tx, {
        organizationId: actor.organizationId,
        projectId: project!.id,
        actorUserId: actor.id,
        action: "project.created",
        entityType: "project",
        entityId: project!.id,
        data: { key: project!.key, name: project!.name },
        ip: opts.ip,
      });
      return project!;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw conflict(`A project with the key ${input.key} already exists.`);
    throw err;
  }
}

export function listEnvironments(db: Database, projectId: string) {
  return db
    .select({
      id: environments.id,
      kind: environments.kind,
      maxAutoToolLevel: environments.maxAutoToolLevel,
      requiresChangeReference: environments.requiresChangeReference,
    })
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.kind));
}

export function listMembers(db: Database, projectId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      role: projectMembers.role,
      addedAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.name));
}

/** Active people of the organisation who are not yet members of the project. */
export async function listMemberCandidates(
  db: Database,
  organizationId: string,
  projectId: string,
) {
  const current = db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.isActive, true),
        notInArray(users.id, current),
      ),
    )
    .orderBy(asc(users.name));
}

export async function setMember(
  db: Database,
  actor: AuthUser,
  projectId: string,
  input: { userId: string; role: ProjectRole },
  opts: { ip?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    // Only people from the same organisation can be added to its projects.
    const [target] = await tx
      .select({ id: users.id, email: users.email, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.organizationId, actor.organizationId)))
      .limit(1);
    if (!target) throw notFound("User");
    if (!target.isActive) throw badRequest("This user is deactivated.");

    const [existing] = await tx
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, input.userId)))
      .limit(1);
    if (existing?.role === input.role)
      return { userId: input.userId, role: input.role, changed: false };

    await tx
      .insert(projectMembers)
      .values({ projectId, userId: input.userId, role: input.role, addedBy: actor.id })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role: input.role },
      });
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: existing ? "member.role_changed" : "member.added",
      entityType: "user",
      entityId: input.userId,
      data: {
        email: target.email,
        role: input.role,
        ...(existing ? { previousRole: existing.role } : {}),
      },
      ip: opts.ip,
    });
    return { userId: input.userId, role: input.role, changed: true };
  });
}

export async function removeMember(
  db: Database,
  actor: AuthUser,
  projectId: string,
  userId: string,
  opts: { ip?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .returning({ role: projectMembers.role });
    if (!removed) throw notFound("Member");
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "member.removed",
      entityType: "user",
      entityId: userId,
      data: { role: removed.role },
      ip: opts.ip,
    });
  });
}

/** Numbers for the dashboard of one project. */
export async function projectSummary(db: Database, projectId: string) {
  const byStatus = await db
    .select({ status: tickets.status, count: count() })
    .from(tickets)
    .where(eq(tickets.projectId, projectId))
    .groupBy(tickets.status);
  const [systems] = await db
    .select({ count: count() })
    .from(sapSystems)
    .where(eq(sapSystems.projectId, projectId));
  const [members] = await db
    .select({ count: count() })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const recent = await db
    .select({
      id: ticketEvents.id,
      type: ticketEvents.type,
      body: ticketEvents.body,
      data: ticketEvents.data,
      createdAt: ticketEvents.createdAt,
      ticketId: tickets.id,
      ticketNumber: tickets.number,
      ticketTitle: tickets.title,
      actorName: sql<string | null>`${users.name}`,
    })
    .from(ticketEvents)
    .innerJoin(tickets, eq(tickets.id, ticketEvents.ticketId))
    .leftJoin(users, eq(users.id, ticketEvents.actorUserId))
    .where(eq(ticketEvents.projectId, projectId))
    .orderBy(desc(ticketEvents.createdAt))
    .limit(8);
  return {
    ticketsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    sapSystems: systems?.count ?? 0,
    members: members?.count ?? 0,
    recentActivity: recent,
  };
}
