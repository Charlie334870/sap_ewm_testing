import { and, asc, eq } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import { schema, type Database } from "@ewm/database";
import type { CreateSapSystemInput } from "@ewm/shared";
import type { AuthUser } from "../context";
import { badRequest, conflict } from "../errors";
import { isUniqueViolation } from "./pg-errors";

const { sapSystems, environments } = schema;

export function listSapSystems(db: Database, projectId: string) {
  return db
    .select({
      id: sapSystems.id,
      name: sapSystems.name,
      sid: sapSystems.sid,
      client: sapSystems.client,
      deployment: sapSystems.deployment,
      adapter: sapSystems.adapter,
      isActive: sapSystems.isActive,
      environment: environments.kind,
      createdAt: sapSystems.createdAt,
    })
    .from(sapSystems)
    .innerJoin(environments, eq(environments.id, sapSystems.environmentId))
    .where(eq(sapSystems.projectId, projectId))
    .orderBy(asc(environments.kind), asc(sapSystems.sid));
}

export async function createSapSystem(
  db: Database,
  actor: AuthUser,
  projectId: string,
  input: CreateSapSystemInput,
  opts: { ip?: string | null } = {},
) {
  // No real SAP connector exists yet. Refusing here keeps the platform from ever implying
  // that it is talking to SAP when it is not (master prompt, section 33).
  if (input.adapter !== "simulated") {
    throw badRequest(
      "Only simulated systems can be registered for now. Connecting a real SAP system arrives with Milestone 6.",
    );
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
          sid: input.sid,
          client: input.client,
          deployment: input.deployment,
          adapter: input.adapter,
          createdBy: actor.id,
        })
        .returning();
      await appendAudit(tx, {
        organizationId: actor.organizationId,
        projectId,
        actorUserId: actor.id,
        action: "sap_system.created",
        entityType: "sap_system",
        entityId: system!.id,
        data: {
          name: system!.name,
          sid: system!.sid,
          client: system!.client,
          environment: input.environment,
          adapter: system!.adapter,
        },
        ip: opts.ip,
      });
      return { ...system!, environment: input.environment };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(
        `System ${input.sid} client ${input.client} is already registered in this project.`,
      );
    }
    throw err;
  }
}
