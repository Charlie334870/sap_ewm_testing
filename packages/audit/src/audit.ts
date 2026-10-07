import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { schema, type DbOrTx, type Tx } from "@ewm/database";
import type { ActorType } from "@ewm/shared";
import { auditHash } from "./canonical";

const { auditLogs } = schema;

export interface AuditEntryInput {
  organizationId: string;
  projectId?: string | null;
  actorType?: ActorType;
  actorUserId?: string | null;
  /** Dotted name of what happened, e.g. "ticket.created". */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Facts about the change. Never put passwords, tokens or other secrets in here. */
  data?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Appends one entry to the organisation's audit chain.
 *
 * Call it inside the same transaction as the change it records, so a change is never committed
 * without its audit entry and an audit entry is never committed for a change that rolled back.
 */
export async function appendAudit(tx: Tx, input: AuditEntryInput) {
  // One writer per organisation at a time, so seq has no gaps and prev_hash is always the
  // latest. The lock is released when the surrounding transaction ends.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"audit:" + input.organizationId}, 0))`,
  );

  const [last] = await tx
    .select({ seq: auditLogs.seq, hash: auditLogs.hash })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, input.organizationId))
    .orderBy(desc(auditLogs.seq))
    .limit(1);

  const content = {
    organizationId: input.organizationId,
    seq: (last?.seq ?? 0) + 1,
    projectId: input.projectId ?? null,
    actorType: input.actorType ?? "user",
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    data: input.data ?? {},
    ip: input.ip ?? null,
    createdAt: new Date(),
  };
  const prevHash = last?.hash ?? "";
  const [row] = await tx
    .insert(auditLogs)
    .values({ ...content, prevHash, hash: auditHash(prevHash, content) })
    .returning();
  return row!;
}

export interface ChainVerification {
  ok: boolean;
  entries: number;
  /** Sequence number of the first entry that does not check out, when ok is false. */
  brokenAtSeq?: number;
  reason?: string;
}

/** Recomputes every hash in an organisation's chain and reports the first break, if any. */
export async function verifyAuditChain(
  db: DbOrTx,
  organizationId: string,
): Promise<ChainVerification> {
  let prevHash = "";
  let expectedSeq = 1;
  let afterSeq = 0;
  const batch = 1000;
  for (;;) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), gt(auditLogs.seq, afterSeq)))
      .orderBy(asc(auditLogs.seq))
      .limit(batch);
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        return {
          ok: false,
          entries: expectedSeq - 1,
          brokenAtSeq: expectedSeq,
          reason: "An entry is missing.",
        };
      }
      if (row.prevHash !== prevHash) {
        return {
          ok: false,
          entries: expectedSeq - 1,
          brokenAtSeq: row.seq,
          reason: "Link to the previous entry does not match.",
        };
      }
      if (auditHash(prevHash, row) !== row.hash) {
        return {
          ok: false,
          entries: expectedSeq - 1,
          brokenAtSeq: row.seq,
          reason: "Entry content was changed after it was written.",
        };
      }
      prevHash = row.hash;
      expectedSeq += 1;
      afterSeq = row.seq;
    }
    if (rows.length < batch) break;
  }
  return { ok: true, entries: expectedSeq - 1 };
}
