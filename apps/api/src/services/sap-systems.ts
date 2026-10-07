import { and, asc, eq, inArray } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import { schema, type Database } from "@ewm/database";
import {
  assertSandboxUrl,
  checkConnection,
  createAdapter,
  loadSystem,
  SapApiSandboxAdapter,
  SCENARIO_PACKS,
  sourceOf,
  SystemNotFoundError,
  TOOLS,
  type GatewayDeps,
} from "@ewm/sap-tools";
import { DEFAULT_SANDBOX_URL, type CreateSapSystemInput } from "@ewm/shared";
import type { AppDeps, AuthUser } from "../context";
import { badRequest, conflict, notFound } from "../errors";
import { isUniqueViolation } from "./pg-errors";
import { createTicket } from "./tickets";

const { sapSystems, sapCredentials, environments, tickets } = schema;

export const gatewayDeps = (deps: AppDeps): GatewayDeps => ({
  db: deps.db,
  secrets: deps.secrets,
  fetchImpl: deps.sapFetch,
  sandboxHosts: deps.sandboxHosts,
});

const publicColumns = {
  id: sapSystems.id,
  name: sapSystems.name,
  sid: sapSystems.sid,
  client: sapSystems.client,
  deployment: sapSystems.deployment,
  adapter: sapSystems.adapter,
  baseUrl: sapSystems.baseUrl,
  isActive: sapSystems.isActive,
  environment: environments.kind,
  lastCheck: sapSystems.lastCheck,
  lastCheckedAt: sapSystems.lastCheckedAt,
  createdAt: sapSystems.createdAt,
};

/** Which tools a connection can run, before any connection test: decided by the kind of connection. */
async function toolAvailability(deps: AppDeps, system: typeof sapSystems.$inferSelect) {
  if (system.adapter === "simulated")
    return TOOLS.map((t) => ({ name: t.name, available: true, reason: null as string | null }));
  // No network call: a throwaway adapter only answers "is there a binding for this tool".
  const probe = new SapApiSandboxAdapter({
    baseUrl: system.baseUrl ?? DEFAULT_SANDBOX_URL,
    headers: {},
  });
  return TOOLS.map((t) => {
    const reason = probe.unsupportedReason(t.name);
    return { name: t.name, available: reason === null, reason };
  });
}

export function listSapSystems(db: Database, projectId: string) {
  return db
    .select(publicColumns)
    .from(sapSystems)
    .innerJoin(environments, eq(environments.id, sapSystems.environmentId))
    .where(eq(sapSystems.projectId, projectId))
    .orderBy(asc(environments.kind), asc(sapSystems.sid))
    .then((rows) => rows.map((row) => ({ ...row, source: sourceOf(row.adapter) })));
}

export async function getSapSystem(deps: AppDeps, projectId: string, sapSystemId: string) {
  let resolved;
  try {
    resolved = await loadSystem(deps.db, projectId, sapSystemId);
  } catch (err) {
    if (err instanceof SystemNotFoundError) throw notFound("SAP system");
    throw err;
  }
  const { system, environment } = resolved;
  return {
    id: system.id,
    name: system.name,
    sid: system.sid,
    client: system.client,
    deployment: system.deployment,
    adapter: system.adapter,
    source: sourceOf(system.adapter),
    baseUrl: system.baseUrl,
    isActive: system.isActive,
    environment: environment.kind,
    lastCheck: system.lastCheck,
    lastCheckedAt: system.lastCheckedAt,
    createdAt: system.createdAt,
    tools: await toolAvailability(deps, system),
    scenarios:
      system.adapter === "simulated"
        ? SCENARIO_PACKS.map((p) => ({
            id: p.id,
            useCase: p.useCase,
            title: p.title,
            ticketTitle: p.ticket.title,
          }))
        : [],
  };
}

export async function createSapSystem(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  input: CreateSapSystemInput,
  opts: { ip?: string | null } = {},
) {
  const { db } = deps;
  // No connector for customer systems exists yet. Refusing here keeps the platform from ever
  // implying that it is talking to a client's SAP when it is not (master prompt, section 33).
  if (input.adapter === "sap") {
    throw badRequest(
      "Customer SAP systems cannot be connected yet. Register a simulated system or SAP's API sandbox. " +
        "Connecting a customer system arrives with Milestone 6.",
    );
  }

  let values: { sid: string; client: string; baseUrl: string | null; secret: string | null };
  if (input.adapter === "sap_api_sandbox") {
    if (!deps.secrets) {
      throw badRequest(
        "The server has no SECRETS_KEY, so it cannot store an API key safely. Add SECRETS_KEY to .env and restart (docs/SETUP.md).",
      );
    }
    if (input.environment !== "DEV") {
      throw badRequest("SAP's API sandbox holds demo data. Register it in the DEV environment.");
    }
    const baseUrl = input.baseUrl || DEFAULT_SANDBOX_URL;
    try {
      assertSandboxUrl(baseUrl, deps.sandboxHosts);
    } catch (err) {
      throw badRequest((err as Error).message, [
        { field: "baseUrl", message: (err as Error).message },
      ]);
    }
    // The sandbox has no system ID or client. These fixed values mark it as "not a real system".
    values = {
      sid: "SBX",
      client: "000",
      baseUrl: baseUrl.replace(/\/+$/, ""),
      secret: deps.secrets.encrypt(input.apiKey!),
    };
  } else {
    values = { sid: input.sid!, client: input.client!, baseUrl: null, secret: null };
  }

  try {
    return await db.transaction(async (tx) => {
      const [env] = await tx
        .select({ id: environments.id })
        .from(environments)
        .where(and(eq(environments.projectId, projectId), eq(environments.kind, input.environment)))
        .limit(1);
      if (!env) throw badRequest(`This project has no ${input.environment} environment.`);
      const [system] = await tx
        .insert(sapSystems)
        .values({
          projectId,
          environmentId: env.id,
          name: input.name,
          sid: values.sid,
          client: values.client,
          deployment: input.deployment,
          adapter: input.adapter,
          baseUrl: values.baseUrl,
          createdBy: actor.id,
        })
        .returning();
      if (values.secret) {
        await tx.insert(sapCredentials).values({
          sapSystemId: system!.id,
          kind: "api_key",
          secretEncrypted: values.secret,
          updatedBy: actor.id,
        });
      }
      await appendAudit(tx, {
        organizationId: actor.organizationId,
        projectId,
        actorUserId: actor.id,
        action: "sap_system.created",
        entityType: "sap_system",
        entityId: system!.id,
        // The API key is never part of an audit entry.
        data: {
          name: system!.name,
          sid: system!.sid,
          client: system!.client,
          environment: input.environment,
          adapter: system!.adapter,
          ...(values.baseUrl ? { baseUrl: values.baseUrl } : {}),
        },
        ip: opts.ip,
      });
      return {
        id: system!.id,
        name: system!.name,
        sid: system!.sid,
        client: system!.client,
        deployment: system!.deployment,
        adapter: system!.adapter,
        source: sourceOf(system!.adapter),
        baseUrl: system!.baseUrl,
        environment: input.environment,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(
        input.adapter === "sap_api_sandbox"
          ? "SAP's API sandbox is already registered in this project."
          : `System ${values.sid} client ${values.client} is already registered in this project.`,
      );
    }
    throw err;
  }
}

/** Replaces the stored API key of a sandbox connection. */
export async function updateCredential(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  sapSystemId: string,
  apiKey: string,
  opts: { ip?: string | null } = {},
) {
  if (!deps.secrets)
    throw badRequest("The server has no SECRETS_KEY. Add it to .env and restart (docs/SETUP.md).");
  const system = await getSapSystem(deps, projectId, sapSystemId);
  if (system.adapter !== "sap_api_sandbox")
    throw badRequest("Only a sandbox connection has an API key.");
  const secretEncrypted = deps.secrets.encrypt(apiKey);
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(sapCredentials)
      .values({ sapSystemId, kind: "api_key", secretEncrypted, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: sapCredentials.sapSystemId,
        set: { secretEncrypted, updatedBy: actor.id, updatedAt: new Date() },
      });
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "sap_system.credential_changed",
      entityType: "sap_system",
      entityId: sapSystemId,
      data: { name: system.name },
      ip: opts.ip,
    });
  });
}

/** Asks the connected system which services answer and what they expose. Read-only. */
export async function testConnection(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  sapSystemId: string,
  opts: { ip?: string | null } = {},
) {
  const { system } = await loadSystem(deps.db, projectId, sapSystemId).catch((err) => {
    if (err instanceof SystemNotFoundError) throw notFound("SAP system");
    throw err;
  });
  if (system.adapter !== "sap_api_sandbox") {
    throw badRequest(
      "A simulated system has no connection to test. It always answers from its scenario packs.",
    );
  }
  let adapter;
  try {
    adapter = await createAdapter(gatewayDeps(deps), system);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  const check = await checkConnection((adapter as SapApiSandboxAdapter).client);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(sapSystems)
      .set({ lastCheck: check, lastCheckedAt: new Date(check.checkedAt) })
      .where(eq(sapSystems.id, system.id));
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "sap_system.tested",
      entityType: "sap_system",
      entityId: system.id,
      data: {
        name: system.name,
        reachable: check.reachable,
        servicesOk: check.services.filter((s) => s.usedByTools.length > 0 && s.state === "ok")
          .length,
        toolsAvailable: check.tools.filter((t) => t.available).length,
      },
      ip: opts.ip,
    });
  });
  return check;
}

/** Raises the ticket of every scenario pack that has no ticket yet, against a simulated system. */
export async function createSampleTickets(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  sapSystemId: string,
  opts: { ip?: string | null } = {},
) {
  const system = await getSapSystem(deps, projectId, sapSystemId);
  if (system.adapter !== "simulated")
    throw badRequest("Sample tickets belong to the scenario packs of a simulated system.");
  const titles = SCENARIO_PACKS.map((p) => p.ticket.title);
  const existing = await deps.db
    .select({ title: tickets.title })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), inArray(tickets.title, titles)));
  const have = new Set(existing.map((t) => t.title));
  const created = [];
  for (const pack of SCENARIO_PACKS) {
    if (have.has(pack.ticket.title)) continue;
    const ticket = await createTicket(
      deps.db,
      actor,
      projectId,
      {
        title: pack.ticket.title,
        description: pack.ticket.description,
        priority: pack.ticket.priority,
        process: pack.ticket.process,
        warehouse: "MUHW",
        sapSystemId,
      },
      opts,
    );
    created.push({ id: ticket.id, reference: ticket.reference, title: ticket.title });
  }
  return { created, skipped: SCENARIO_PACKS.length - created.length };
}
