import { and, desc, eq, lt } from "drizzle-orm";
import { schema, type Database } from "@ewm/database";

const { auditLogs, users, projects } = schema;

/** Newest first. Pass the seq of the last row you have as `before` to get the next page. */
export async function listAuditLogs(
  db: Database,
  scope: { organizationId: string; projectId?: string },
  page: { limit: number; before?: number },
) {
  const rows = await db
    .select({
      seq: auditLogs.seq,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      actorType: auditLogs.actorType,
      actorName: users.name,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      data: auditLogs.data,
      ip: auditLogs.ip,
      hash: auditLogs.hash,
      projectId: auditLogs.projectId,
      projectKey: projects.key,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(projects, eq(projects.id, auditLogs.projectId))
    .where(
      and(
        eq(auditLogs.organizationId, scope.organizationId),
        scope.projectId ? eq(auditLogs.projectId, scope.projectId) : undefined,
        page.before ? lt(auditLogs.seq, page.before) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.seq))
    .limit(page.limit + 1);
  const hasMore = rows.length > page.limit;
  const entries = hasMore ? rows.slice(0, page.limit) : rows;
  return { entries, nextBefore: hasMore ? entries[entries.length - 1]!.seq : null };
}
