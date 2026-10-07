/**
 * A stand-in for SAP's HTTP interface, for automated tests only.
 *
 * It is generated from reference/sap-api-metadata.json, the service definitions SAP published.
 * It serves $metadata and entity sets in OData V2 and V4 form, applies $filter, $expand and $top,
 * and refuses a filter on a property the definition does not have. Tests that pass against it
 * show that the connector speaks SAP's published contract. They do not show that SAP itself
 * behaves the same way; only a connection test against SAP can show that.
 */
import reference from "./reference/sap-api-metadata.json" with { type: "json" };

interface FieldDef {
  name: string;
  type: string;
  nullable: boolean;
}
interface EntityDef {
  keys: string[];
  fields: FieldDef[];
  navigation: string[];
}
interface ServiceDef {
  servicePath: string;
  odataVersion: "v2" | "v4";
  entities: Record<string, EntityDef>;
}

const SERVICES = reference as unknown as Record<string, ServiceDef>;
export const FAKE_BASE_URL = "https://sandbox.api.sap.com/s4hanacloud";
export const FAKE_API_KEY = "test-api-key-0123456789";

export type FakeRow = Record<string, unknown>;

export interface FakeSapOptions {
  apiKey?: string;
  /** Rows per entity set. Properties left out are filled with a neutral value of the right type. */
  data?: Record<string, FakeRow[]>;
  /** Service ids that answer 404, as if SAP had removed them. */
  removedServices?: string[];
  /** Properties to drop from an entity set, as if SAP had changed the service. */
  removedProperties?: Record<string, string[]>;
  /** Extra services that exist on this fake system: path -> entity set -> property names. */
  extraServices?: Record<string, Record<string, string[]>>;
  /** Answer every request with this status. */
  failWith?: number;
}

export interface FakeSap {
  fetch: typeof fetch;
  /** Every request received, for assertions about what was sent. */
  requests: Array<{ url: string; method: string; headers: Record<string, string> }>;
}

function neutralValue(field: FieldDef, version: "v2" | "v4"): unknown {
  switch (field.type) {
    case "Edm.Decimal":
      return version === "v2" ? "0.000" : 0;
    case "Edm.Boolean":
      return false;
    case "Edm.DateTimeOffset":
      return version === "v2" ? "/Date(1759740000000+0000)/" : "2026-10-06T08:40:00Z";
    case "Edm.DateTime":
      return "/Date(1759740000000)/";
    case "Edm.Date":
      return "2026-10-06";
    case "Edm.Guid":
      return "00000000-0000-0000-0000-000000000001";
    default:
      return "";
  }
}

function findEntity(entitySet: string): { service: ServiceDef; entity: EntityDef } | null {
  for (const service of Object.values(SERVICES)) {
    const entity = service.entities[entitySet];
    if (entity) return { service, entity };
  }
  return null;
}

/** A complete row of an entity set: every published property present, the given ones overridden. */
export function fakeRow(entitySet: string, values: FakeRow): FakeRow {
  const found = findEntity(entitySet);
  if (!found) throw new Error(`Unknown entity set ${entitySet}`);
  for (const key of Object.keys(values)) {
    if (!found.entity.fields.some((f) => f.name === key)) {
      throw new Error(`${entitySet} has no property ${key} in SAP's published definition`);
    }
  }
  return Object.fromEntries(
    found.entity.fields.map((f) => [f.name, f.name in values ? values[f.name] : neutralValue(f, found.service.odataVersion)]),
  );
}

function metadataXml(entities: Record<string, string[]>): string {
  const types = Object.entries(entities)
    .map(
      ([name, properties]) =>
        `<EntityType Name="${name}Type">${properties.map((p) => `<Property Name="${p}" Type="Edm.String"/>`).join("")}</EntityType>`,
    )
    .join("");
  const sets = Object.keys(entities)
    .map((name) => `<EntitySet Name="${name}" EntityType="FAKE.${name}Type"/>`)
    .join("");
  return `<?xml version="1.0"?><edmx:Edmx><edmx:DataServices><Schema Namespace="FAKE">${types}<EntityContainer Name="C">${sets}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
}

/** Evaluates the small part of $filter the connector uses: eq comparisons joined by and, with (a or b) groups. */
function matches(row: FakeRow, filter: string, properties: string[]): boolean {
  const term = (t: string): boolean => {
    const m = /^(\w+) eq '((?:[^']|'')*)'$/.exec(t.trim());
    if (!m) throw new FilterError(`Unsupported filter expression: ${t}`);
    if (!properties.includes(m[1]!)) throw new FilterError(`Property ${m[1]} is not defined for this entity.`);
    return String(row[m[1]!] ?? "") === m[2]!.replace(/''/g, "'");
  };
  return filter.split(" and ").every((part) => {
    const group = /^\((.*)\)$/.exec(part.trim());
    return group ? group[1]!.split(" or ").some(term) : term(part);
  });
}
class FilterError extends Error {}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sapError = (status: number, message: string, version: "v2" | "v4" = "v2") =>
  json(status, version === "v2" ? { error: { code: "FAKE/000", message: { lang: "en", value: message } } } : { error: { code: "FAKE/000", message } });

export function createFakeSap(options: FakeSapOptions = {}): FakeSap {
  const apiKey = options.apiKey ?? FAKE_API_KEY;
  const requests: FakeSap["requests"] = [];

  const rowsOf = (entitySet: string): FakeRow[] => {
    const removed = options.removedProperties?.[entitySet] ?? [];
    return (options.data?.[entitySet] ?? []).map((row) => {
      const full = fakeRow(entitySet, row);
      for (const property of removed) delete full[property];
      return full;
    });
  };

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = init?.method ?? "GET";
    requests.push({ url: url.toString(), method, headers });

    if (method !== "GET") return sapError(405, "This fake only accepts GET, like the connector should only send.");
    if (options.failWith) return sapError(options.failWith, `Forced failure ${options.failWith}`);
    if (headers.apikey !== apiKey) return sapError(401, "Invalid API key.");
    if (!url.toString().startsWith(FAKE_BASE_URL)) return sapError(404, "Unknown host or prefix.");
    const path = decodeURIComponent(url.pathname.slice(new URL(FAKE_BASE_URL).pathname.length));

    for (const [servicePath, entities] of Object.entries(options.extraServices ?? {})) {
      if (path === `${servicePath}/$metadata`) return new Response(metadataXml(entities), { status: 200 });
    }

    const entry = Object.entries(SERVICES).find(([, s]) => path === s.servicePath || path.startsWith(`${s.servicePath}/`));
    if (!entry || options.removedServices?.includes(entry[0])) return sapError(404, "Service not found.");
    const [, service] = entry;
    const rest = path.slice(service.servicePath.length + 1);

    const exposed = (name: string) =>
      service.entities[name]!.fields.map((f) => f.name).filter((p) => !(options.removedProperties?.[name] ?? []).includes(p));

    if (rest === "$metadata") {
      return new Response(metadataXml(Object.fromEntries(Object.keys(service.entities).map((n) => [n, exposed(n)]))), { status: 200 });
    }
    const entity = service.entities[rest];
    if (!entity) return sapError(404, `Entity set ${rest} not found.`, service.odataVersion);

    let rows = rowsOf(rest);
    const filter = url.searchParams.get("$filter");
    try {
      if (filter) rows = rows.filter((row) => matches(row, filter, exposed(rest)));
    } catch (err) {
      if (err instanceof FilterError) return sapError(400, err.message, service.odataVersion);
      throw err;
    }
    const top = Number(url.searchParams.get("$top") ?? rows.length);
    rows = rows.slice(0, top);

    const expand = (url.searchParams.get("$expand") ?? "").split(",").filter(Boolean);
    for (const nav of expand) {
      if (!entity.navigation.includes(nav)) return sapError(400, `Navigation property ${nav} not found.`, service.odataVersion);
    }
    const withNavigation = rows.map((row) => {
      const out: FakeRow = service.odataVersion === "v2" ? { __metadata: { type: `FAKE.${rest}Type` }, ...row } : { ...row };
      for (const nav of entity.navigation) {
        // SAP's navigation names follow "to_" + a (sometimes abbreviated) entity name.
        const target = Object.keys(service.entities).find((n) => `to_${n}` === nav);
        if (!expand.includes(nav) || !target) {
          if (service.odataVersion === "v2") out[nav] = { __deferred: { uri: "deferred" } };
          continue;
        }
        const shared = entity.keys.filter((k) => service.entities[target]!.fields.some((f) => f.name === k));
        const related = rowsOf(target).filter((r) => shared.every((k) => r[k] === row[k]));
        out[nav] = service.odataVersion === "v2" ? { results: related } : related;
      }
      return out;
    });

    return json(200, service.odataVersion === "v2" ? { d: { results: withNavigation } } : { value: withNavigation });
  };

  return { fetch: handler as typeof fetch, requests };
}
