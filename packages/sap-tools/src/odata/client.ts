import { AdapterError } from "../adapter";

export interface ODataService {
  /** SAP's technical name of the service. */
  id: string;
  title: string;
  /** Path below the system's base address. */
  path: string;
  version: "v2" | "v4";
}

export interface ODataQuery {
  filter?: string;
  expand?: string[];
  top?: number;
}

export type ODataRow = Record<string, unknown>;

export interface ODataConnection {
  baseUrl: string;
  /** Authentication headers. Built inside the tool server; never logged or returned. */
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/** Quotes a value for use in $filter. A single quote inside the value is doubled, as OData requires. */
export const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
export const equals = (field: string, value: string) => `${field} eq ${quote(value)}`;
export const and = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(" and ");

/**
 * Minimal read-only OData client for SAP services, versions 2 and 4.
 *
 * It only ever sends GET. There is no method here that could change anything in SAP.
 */
export class ODataClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly connection: ODataConnection) {
    this.fetchImpl = connection.fetchImpl ?? fetch;
  }

  /** Reads rows of one entity set. Navigation properties that were expanded come back as arrays. */
  async read(service: ODataService, entitySet: string, query: ODataQuery, signal: AbortSignal): Promise<ODataRow[]> {
    const params: string[] = [];
    if (service.version === "v2") params.push("$format=json");
    if (query.filter) params.push(`$filter=${encodeURIComponent(query.filter)}`);
    if (query.expand?.length) params.push(`$expand=${query.expand.map(encodeURIComponent).join(",")}`);
    if (query.top) params.push(`$top=${query.top}`);
    const url = `${this.serviceUrl(service)}/${entitySet}${params.length ? `?${params.join("&")}` : ""}`;

    const body = await this.get(url, "application/json", service, signal);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new AdapterError("unexpected_data", `${service.id} did not answer with JSON.`);
    }
    const rows = service.version === "v2" ? unwrapV2(parsed) : (parsed as { value?: unknown })?.value;
    if (!Array.isArray(rows)) {
      throw new AdapterError("unexpected_data", `${service.id} answered in a shape that is not an OData collection.`);
    }
    return rows.map((row) => cleanRow(row as ODataRow));
  }

  /** The service's own description of its entities and properties (EDMX). */
  metadata(service: ODataService, signal: AbortSignal): Promise<string> {
    return this.get(`${this.serviceUrl(service)}/$metadata`, "application/xml", service, signal);
  }

  private serviceUrl(service: ODataService): string {
    return `${this.connection.baseUrl.replace(/\/+$/, "")}${service.path}`;
  }

  private async get(url: string, accept: string, service: ODataService, signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { ...this.connection.headers, accept },
        signal,
        redirect: "error",
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new AdapterError("network", `Could not reach SAP for ${service.id}: ${(err as Error).message}`, true);
    }
    const text = await response.text();
    if (response.ok) return text;

    const detail = sapErrorMessage(text);
    if (response.status === 401 || response.status === 403) {
      throw new AdapterError(
        "authentication_failed",
        `SAP refused access to ${service.id} (HTTP ${response.status}).${detail ? ` ${detail}` : ""}`,
      );
    }
    if (response.status === 404) {
      throw new AdapterError(
        "service_unavailable",
        `SAP has no service at ${service.path} on this connection (HTTP 404).${detail ? ` ${detail}` : ""}`,
      );
    }
    const transient = response.status === 429 || response.status >= 500;
    throw new AdapterError(
      "sap_error",
      `SAP answered HTTP ${response.status} for ${service.id}.${detail ? ` ${detail}` : ""}`,
      transient,
    );
  }
}

function unwrapV2(parsed: unknown): unknown {
  const d = (parsed as { d?: unknown })?.d;
  if (Array.isArray(d)) return d;
  return (d as { results?: unknown })?.results;
}

/** Removes OData bookkeeping and turns expanded V2 navigation ({ results: [...] }) into arrays. */
function cleanRow(row: ODataRow): ODataRow {
  const out: ODataRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "__metadata" || key.startsWith("@odata.") || key.includes("@")) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value as { __deferred?: unknown; results?: unknown };
      if (v.__deferred) continue; // navigation that was not expanded
      if (Array.isArray(v.results)) {
        out[key] = v.results.map((r) => cleanRow(r as ODataRow));
        continue;
      }
      out[key] = cleanRow(value as ODataRow);
      continue;
    }
    out[key] = Array.isArray(value) ? value.map((r) => (r && typeof r === "object" ? cleanRow(r as ODataRow) : r)) : value;
  }
  return out;
}

/** SAP's own error text, from either the V2 or the V4 error format. Never more than 300 characters. */
function sapErrorMessage(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: { message?: unknown } }).error;
    const message = error?.message;
    const text = typeof message === "string" ? message : (message as { value?: string } | undefined)?.value;
    return text ? text.slice(0, 300) : "";
  } catch {
    const match = /<message[^>]*>([^<]+)<\/message>/i.exec(body);
    return match?.[1]?.slice(0, 300) ?? "";
  }
}

// ------------------------------------------------------------------ value conversion

export const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
};

export const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** Accepts ISO strings (V4) and the V2 form /Date(1696156800000+0000)/. */
export const dateTime = (value: unknown): string | null => {
  if (typeof value !== "string" || value === "") return null;
  const v2 = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  const date = v2 ? new Date(Number(v2[1])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** A status as SAP gave it. The code is passed through untouched; its meaning is not guessed. */
export const status = (code: unknown, name?: unknown) => {
  const c = text(code);
  const n = text(name);
  return c === null && n === null ? null : { code: c, text: n };
};

/** Scalar properties only: nested navigation data is mapped separately. */
export const scalars = (row: ODataRow): ODataRow =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v === null || typeof v !== "object"));
