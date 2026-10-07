import { AdapterError } from "../adapter";
import { TOOLS, type ToolName } from "../contracts";
import { SERVICES, SERVICE_USAGE, unsupportedReason, type ServiceKey } from "./bindings";
import type { ODataClient, ODataService } from "./client";

/**
 * Services that are probably the successors of the ones the bindings use. Their paths were NOT
 * confirmed from an SAP source, so no tool reads from them. The connection test only asks
 * whether they exist and records what they expose, so a binding can be written from the system's
 * own description.
 */
const CANDIDATE_SERVICES: ODataService[] = [
  {
    id: "api_warehouse_order_task_2",
    title: "Warehouse Order and Task, version 2 (candidate, path unconfirmed)",
    path: "/sap/opu/odata4/sap/api_warehouse_order_task_2/srvd_a2x/sap/warehouseorder/0001",
    version: "v4",
  },
];

export interface ServiceCheck {
  id: string;
  title: string;
  path: string;
  version: "v2" | "v4";
  /** True when the definition our tools use came from an SAP-published source. */
  usedByTools: ToolName[];
  state: "ok" | "changed" | "not_found" | "refused" | "error";
  detail: string | null;
  /** Entity sets our tools read, and filter properties the system does not have. */
  entitySets: Array<{ name: string; present: boolean; missingProperties: string[] }>;
  /** Real key values from the first row SAP returned: handy for trying the tools. */
  example: Record<string, string> | null;
  /** Candidate services only: everything the system says it exposes. */
  exposes?: Record<string, string[]>;
}

export interface ConnectionCheck {
  checkedAt: string;
  reachable: boolean;
  summary: string;
  services: ServiceCheck[];
  tools: Array<{ name: ToolName; available: boolean; reason: string | null }>;
}

/** Entity sets and their property names, read from an EDMX $metadata document. */
export function parseMetadata(xml: string): Record<string, string[]> {
  const types = new Map<string, string[]>();
  for (const match of xml.matchAll(/<EntityType\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) {
    const properties = [...match[2]!.matchAll(/<Property\b[^>]*\bName="([^"]+)"/g)].map((p) => p[1]!);
    types.set(match[1]!, properties);
  }
  const sets: Record<string, string[]> = {};
  for (const match of xml.matchAll(/<EntitySet\b[^>]*\bName="([^"]+)"[^>]*\bEntityType="([^"]+)"/g)) {
    const typeName = match[2]!.split(".").pop()!;
    sets[match[1]!] = types.get(typeName) ?? [];
  }
  return sets;
}

function describeFailure(err: unknown): Pick<ServiceCheck, "state" | "detail"> {
  if (err instanceof AdapterError) {
    if (err.code === "service_unavailable") return { state: "not_found", detail: err.message };
    if (err.code === "authentication_failed") return { state: "refused", detail: err.message };
    return { state: "error", detail: err.message };
  }
  const aborted = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
  return { state: "error", detail: aborted ? "SAP did not answer in time." : String((err as Error)?.message ?? err) };
}

async function checkService(client: ODataClient, key: ServiceKey): Promise<ServiceCheck> {
  const service = SERVICES[key];
  const usage = SERVICE_USAGE[key];
  const base = { id: service.id, title: service.title, path: service.path, version: service.version, usedByTools: usage.tools };
  const expected = Object.entries(usage.entitySets);
  try {
    const exposed = parseMetadata(await client.metadata(service, AbortSignal.timeout(15_000)));
    const entitySets = expected.map(([name, properties]) => ({
      name,
      present: name in exposed,
      missingProperties: name in exposed ? properties.filter((p) => !exposed[name]!.includes(p)) : [],
    }));
    const changed = entitySets.some((e) => !e.present || e.missingProperties.length > 0);

    // Metadata can be readable while data is not, so read one real row as well.
    let example: Record<string, string> | null = null;
    let detail: string | null = null;
    const [firstSet, firstProperties] = expected[0]!;
    try {
      const [row] = await client.read(service, firstSet, { top: 1 }, AbortSignal.timeout(15_000));
      if (row) {
        example = Object.fromEntries(
          firstProperties.filter((p) => row[p] !== null && row[p] !== undefined && row[p] !== "").map((p) => [p, String(row[p])]),
        );
      } else {
        detail = "The service answered but holds no data.";
      }
    } catch (err) {
      return { ...base, ...describeFailure(err), entitySets, example: null };
    }
    return {
      ...base,
      state: changed ? "changed" : "ok",
      detail: changed ? "The system's description of this service differs from the definition the tools were built on." : detail,
      entitySets,
      example,
    };
  } catch (err) {
    return { ...base, ...describeFailure(err), entitySets: [], example: null };
  }
}

async function checkCandidate(client: ODataClient, service: ODataService): Promise<ServiceCheck> {
  const base = { id: service.id, title: service.title, path: service.path, version: service.version, usedByTools: [] as ToolName[] };
  try {
    const exposes = parseMetadata(await client.metadata(service, AbortSignal.timeout(15_000)));
    return { ...base, state: "ok", detail: "Exists. Not used by any tool yet.", entitySets: [], example: null, exposes };
  } catch (err) {
    return { ...base, ...describeFailure(err), entitySets: [], example: null };
  }
}

/**
 * Asks the connected system which of the services the tools rely on are really there, whether
 * they still look the way the tools expect, and whether data can be read. Read-only.
 */
export async function checkConnection(client: ODataClient): Promise<ConnectionCheck> {
  const services = await Promise.all([
    ...(Object.keys(SERVICES) as ServiceKey[]).map((key) => checkService(client, key)),
    ...CANDIDATE_SERVICES.map((service) => checkCandidate(client, service)),
  ]);
  const used = services.filter((s) => s.usedByTools.length > 0);
  const working = new Set(used.filter((s) => s.state === "ok").flatMap((s) => s.usedByTools));
  // get_delivery needs both delivery services; report it available if either answers.
  const tools = TOOLS.map((tool) => {
    const structural = unsupportedReason(tool.name);
    if (structural) return { name: tool.name, available: false, reason: structural };
    if (working.has(tool.name)) return { name: tool.name, available: true, reason: null };
    const failing = used.find((s) => s.usedByTools.includes(tool.name));
    return { name: tool.name, available: false, reason: failing?.detail ?? "The SAP service behind this tool did not pass the check." };
  });

  const reachable = used.some((s) => s.state === "ok" || s.state === "changed");
  const refused = used.length > 0 && used.every((s) => s.state === "refused");
  const okCount = used.filter((s) => s.state === "ok").length;
  const summary = refused
    ? "SAP refused the API key. Check that the key is copied completely and is still valid."
    : !reachable
      ? "None of the SAP services answered. Check the address and your network connection."
      : `${okCount} of ${used.length} SAP services answered as expected. ${tools.filter((t) => t.available).length} of ${tools.length} tools can run over this connection.`;

  return { checkedAt: new Date().toISOString(), reachable, summary, services, tools };
}
