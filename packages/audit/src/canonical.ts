import { createHash } from "node:crypto";

/** JSON with object keys sorted, so the same content always produces the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface AuditContent {
  organizationId: string;
  seq: number;
  projectId: string | null;
  actorType: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  createdAt: Date;
}

/** The hash that links an audit entry to the one before it. */
export function auditHash(prevHash: string, entry: AuditContent): string {
  // Fields are picked one by one so extra properties on the object (id, hash) never leak in.
  const content = canonicalJson({
    organizationId: entry.organizationId,
    seq: entry.seq,
    projectId: entry.projectId,
    actorType: entry.actorType,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    data: entry.data,
    ip: entry.ip,
    createdAt: entry.createdAt.toISOString(),
  });
  return createHash("sha256").update(prevHash).update("\n").update(content).digest("hex");
}
