import { and, desc, eq } from "drizzle-orm";
import { schema, type Database } from "@ewm/database";
import { executeTool, SystemNotFoundError } from "@ewm/sap-tools";
import type { AppDeps, AuthUser } from "../context";
import { notFound } from "../errors";
import { gatewayDeps } from "./sap-systems";

const { sapToolCalls, sapSystems, users, apiTokens, tickets } = schema;

export async function runTool(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  sapSystemId: string,
  toolName: string,
  body: { input: unknown; ticketId?: string },
) {
  try {
    return await executeTool(gatewayDeps(deps), {
      projectId,
      sapSystemId,
      toolName,
      input: body.input,
      ticketId: body.ticketId ?? null,
      actor: { userId: actor.id, apiTokenId: actor.token?.id ?? null },
    });
  } catch (err) {
    if (err instanceof SystemNotFoundError) throw notFound("SAP system");
    throw err;
  }
}

const listColumns = {
  id: sapToolCalls.id,
  createdAt: sapToolCalls.createdAt,
  toolName: sapToolCalls.toolName,
  status: sapToolCalls.status,
  source: sapToolCalls.source,
  durationMs: sapToolCalls.durationMs,
  error: sapToolCalls.error,
  input: sapToolCalls.input,
  sapSystemId: sapToolCalls.sapSystemId,
  sapSystemSid: sapSystems.sid,
  calledByName: users.name,
  /** Name of the agent access token, when the call came from an outside agent. */
  viaToken: apiTokens.name,
  ticketNumber: tickets.number,
};

export function listToolCalls(db: Database, projectId: string, filter: { sapSystemId?: string; limit: number }) {
  return db
    .select(listColumns)
    .from(sapToolCalls)
    .innerJoin(sapSystems, eq(sapSystems.id, sapToolCalls.sapSystemId))
    .leftJoin(users, eq(users.id, sapToolCalls.calledByUserId))
    .leftJoin(apiTokens, eq(apiTokens.id, sapToolCalls.apiTokenId))
    .leftJoin(tickets, eq(tickets.id, sapToolCalls.ticketId))
    .where(and(eq(sapToolCalls.projectId, projectId), filter.sapSystemId ? eq(sapToolCalls.sapSystemId, filter.sapSystemId) : undefined))
    .orderBy(desc(sapToolCalls.createdAt))
    .limit(filter.limit);
}

export async function getToolCall(db: Database, projectId: string, toolCallId: string) {
  const [call] = await db
    .select({ ...listColumns, output: sapToolCalls.output, authLevel: sapToolCalls.authLevel })
    .from(sapToolCalls)
    .innerJoin(sapSystems, eq(sapSystems.id, sapToolCalls.sapSystemId))
    .leftJoin(users, eq(users.id, sapToolCalls.calledByUserId))
    .leftJoin(apiTokens, eq(apiTokens.id, sapToolCalls.apiTokenId))
    .leftJoin(tickets, eq(tickets.id, sapToolCalls.ticketId))
    .where(and(eq(sapToolCalls.id, toolCallId), eq(sapToolCalls.projectId, projectId)))
    .limit(1);
  if (!call) throw notFound("Tool call");
  return call;
}
