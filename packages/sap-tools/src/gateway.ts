import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@ewm/database";
import type { DataSource, EnvironmentKind, SapAdapter as SapAdapterKind } from "@ewm/shared";
import { AdapterError, type SapAdapter } from "./adapter";
import { findTool } from "./contracts";
import {
  assertSandboxUrl,
  SapApiSandboxAdapter,
  sandboxHeaders,
  SANDBOX_HOSTS,
} from "./odata/adapter";
import type { SecretBox } from "./secrets";
import { SimulatedSapAdapter } from "./simulated/adapter";

const { sapSystems, sapCredentials, environments, sapToolCalls, tickets } = schema;

export interface GatewayDeps {
  db: Database;
  /** Needed for real connections. Without it only simulated systems can be used. */
  secrets: SecretBox | null;
  /** Test hooks. Production leaves them unset. */
  fetchImpl?: typeof fetch;
  sandboxHosts?: readonly string[];
}

export interface ToolCallRequest {
  projectId: string;
  sapSystemId: string;
  toolName: string;
  input: unknown;
  actor: { userId: string; apiTokenId?: string | null };
  ticketId?: string | null;
  investigationId?: string | null;
}

export type ToolCallStatus = "ok" | "error" | "timeout" | "rejected";

export interface ToolCallEnvelope {
  toolCallId: string;
  tool: string;
  status: ToolCallStatus;
  /** Where the data came from. SIMULATED means no SAP system was involved. */
  source: DataSource;
  system: {
    id: string;
    name: string;
    sid: string;
    client: string;
    environment: EnvironmentKind;
    adapter: SapAdapterKind;
  };
  retrievedAt: string;
  durationMs: number;
  /** Present only when status is ok. */
  data?: unknown;
  /** Present for every other status. Says what stopped the call; never a substitute result. */
  error?: { code: string; message: string };
}

/** The system does not exist in this project. Looks the same as any other missing record. */
export class SystemNotFoundError extends Error {
  constructor() {
    super("SAP system not found.");
  }
}

export interface ResolvedSystem {
  system: typeof sapSystems.$inferSelect;
  environment: typeof environments.$inferSelect;
}

export async function loadSystem(
  db: Database,
  projectId: string,
  sapSystemId: string,
): Promise<ResolvedSystem> {
  const [row] = await db
    .select({ system: sapSystems, environment: environments })
    .from(sapSystems)
    .innerJoin(environments, eq(environments.id, sapSystems.environmentId))
    // Both conditions matter: the system must exist and must belong to this project.
    .where(and(eq(sapSystems.id, sapSystemId), eq(sapSystems.projectId, projectId)))
    .limit(1);
  if (!row) throw new SystemNotFoundError();
  return row;
}

export const sourceOf = (adapter: SapAdapterKind): DataSource =>
  adapter === "simulated" ? "SIMULATED" : adapter === "sap_api_sandbox" ? "SAP_SANDBOX" : "SAP";

/** Builds the adapter for a system. Secrets are decrypted here and go no further than the adapter. */
export async function createAdapter(
  deps: GatewayDeps,
  system: typeof sapSystems.$inferSelect,
): Promise<SapAdapter> {
  if (system.adapter === "simulated") {
    return new SimulatedSapAdapter({
      id: system.id,
      sid: system.sid,
      client: system.client,
      baseUrl: null,
    });
  }
  if (system.adapter === "sap_api_sandbox") {
    if (!deps.secrets)
      throw new AdapterError(
        "authentication_failed",
        "SECRETS_KEY is not configured on the server.",
      );
    if (!system.baseUrl)
      throw new AdapterError("service_unavailable", "This system has no address.");
    try {
      assertSandboxUrl(system.baseUrl, deps.sandboxHosts ?? SANDBOX_HOSTS);
    } catch (err) {
      throw new AdapterError("service_unavailable", (err as Error).message);
    }
    const [credential] = await deps.db
      .select()
      .from(sapCredentials)
      .where(eq(sapCredentials.sapSystemId, system.id))
      .limit(1);
    if (!credential)
      throw new AdapterError("authentication_failed", "No API key is stored for this system.");
    let apiKey: string;
    try {
      apiKey = deps.secrets.decrypt(credential.secretEncrypted);
    } catch {
      throw new AdapterError(
        "authentication_failed",
        "The stored API key cannot be read. Was SECRETS_KEY changed? Enter the key again.",
      );
    }
    return new SapApiSandboxAdapter({
      baseUrl: system.baseUrl,
      headers: sandboxHeaders(apiKey),
      fetchImpl: deps.fetchImpl,
    });
  }
  throw new AdapterError(
    "not_supported",
    "Connections to customer SAP systems arrive with Milestone 6.",
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one way a tool is ever run.
 *
 * Order of checks: tool exists, system belongs to the project and is active, the tool is
 * read-only at a level the environment allows, the input matches the tool's schema, the
 * connection supports the tool, the system is the one it was registered as. Then the call runs
 * with a time limit, and the result must match the tool's output schema or it is discarded.
 * Every call, including a refused one, is recorded with its parameters and outcome.
 *
 * A failure never produces substitute data: the envelope carries an error and no data.
 */
export async function executeTool(
  deps: GatewayDeps,
  request: ToolCallRequest,
): Promise<ToolCallEnvelope> {
  const { db } = deps;
  const { system, environment } = await loadSystem(db, request.projectId, request.sapSystemId);
  const source = sourceOf(system.adapter);
  const tool = findTool(request.toolName);
  const started = Date.now();

  const finish = async (
    status: ToolCallStatus,
    outcome: {
      data?: unknown;
      error?: { code: string; message: string };
      input?: unknown;
      rawOutput?: unknown;
    },
  ): Promise<ToolCallEnvelope> => {
    const durationMs = Date.now() - started;
    const [row] = await db
      .insert(sapToolCalls)
      .values({
        projectId: request.projectId,
        sapSystemId: system.id,
        investigationId: request.investigationId ?? null,
        ticketId: request.ticketId ?? null,
        apiTokenId: request.actor.apiTokenId ?? null,
        calledByUserId: request.actor.userId,
        toolName: request.toolName.slice(0, 80),
        authLevel: tool?.authLevel ?? 0,
        input: (outcome.input ?? request.input ?? {}) as object,
        output:
          status === "ok"
            ? (outcome.data as object)
            : outcome.rawOutput === undefined
              ? null
              : { discarded: outcome.rawOutput },
        status,
        error: outcome.error
          ? `${outcome.error.code}: ${outcome.error.message}`.slice(0, 2000)
          : null,
        source,
        durationMs,
      })
      .returning({ id: sapToolCalls.id, createdAt: sapToolCalls.createdAt });
    return {
      toolCallId: row!.id,
      tool: request.toolName,
      status,
      source,
      system: {
        id: system.id,
        name: system.name,
        sid: system.sid,
        client: system.client,
        environment: environment.kind,
        adapter: system.adapter,
      },
      retrievedAt: row!.createdAt.toISOString(),
      durationMs,
      ...(status === "ok" ? { data: outcome.data } : { error: outcome.error }),
    };
  };
  const reject = (code: string, message: string) =>
    finish("rejected", { error: { code, message } });

  if (!tool) return reject("unknown_tool", `There is no tool called ${request.toolName}.`);
  if (!system.isActive) return reject("system_inactive", "This SAP system is deactivated.");
  if (tool.access !== "read" || tool.authLevel > environment.maxAutoToolLevel) {
    return reject(
      "approval_required",
      "This tool changes data or needs an approval, which this build cannot give.",
    );
  }
  if (!tool.environments.includes(environment.kind)) {
    return reject("environment_not_allowed", `${tool.name} is not allowed in ${environment.kind}.`);
  }
  if (request.ticketId) {
    const [ticket] = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, request.ticketId), eq(tickets.projectId, request.projectId)))
      .limit(1);
    if (!ticket) return reject("ticket_not_found", "The ticket does not belong to this project.");
  }

  const parsedInput = tool.input.safeParse(request.input ?? {});
  if (!parsedInput.success) {
    const problems = parsedInput.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return reject("invalid_input", problems);
  }
  const input = parsedInput.data;

  let adapter: SapAdapter;
  try {
    adapter = await createAdapter(deps, system);
  } catch (err) {
    if (err instanceof AdapterError)
      return finish("error", { input, error: { code: err.code, message: err.message } });
    throw err;
  }
  const unsupported = adapter.unsupportedReason(tool.name);
  if (unsupported)
    return finish("rejected", { input, error: { code: "not_supported", message: unsupported } });

  for (let attempt = 0; ; attempt++) {
    const signal = AbortSignal.timeout(tool.timeoutMs);
    try {
      // The system must be the one it was registered as. Never inferred from its address.
      const identity = await adapter.identify(signal);
      if (identity && (identity.sid !== system.sid || identity.client !== system.client)) {
        return finish("rejected", {
          input,
          error: {
            code: "identity_mismatch",
            message: `The system answered as ${identity.sid}/${identity.client}, but ${system.sid}/${system.client} is registered.`,
          },
        });
      }
      const raw = await adapter.execute(tool.name, input, signal);
      const output = tool.output.safeParse(raw);
      if (!output.success) {
        // Unexpected data: stop. The result is kept for diagnosis but not handed to the caller.
        const where = output.error.issues
          .slice(0, 5)
          .map((i) => i.path.join("."))
          .join(", ");
        return finish("error", {
          input,
          rawOutput: raw,
          error: {
            code: "unexpected_data",
            message: `The system returned data that does not match the tool's contract (${where}).`,
          },
        });
      }
      return finish("ok", { input, data: output.data });
    } catch (err) {
      const timedOut = signal.aborted;
      const transient = timedOut || (err instanceof AdapterError && err.transient);
      if (transient && attempt < tool.retries) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      if (timedOut) {
        return finish("timeout", {
          input,
          error: {
            code: "timeout",
            message: `The system did not answer within ${tool.timeoutMs / 1000} seconds.`,
          },
        });
      }
      if (err instanceof AdapterError)
        return finish("error", { input, error: { code: err.code, message: err.message } });
      throw err;
    }
  }
}
