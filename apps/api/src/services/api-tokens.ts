import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import { hashSessionToken, newApiToken } from "@ewm/auth";
import { schema, type Database } from "@ewm/database";
import type { AuthUser } from "../context";
import { notFound } from "../errors";

const { apiTokens, users } = schema;

const listColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  tokenPrefix: apiTokens.tokenPrefix,
  createdAt: apiTokens.createdAt,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  revokedAt: apiTokens.revokedAt,
  userId: apiTokens.userId,
  userName: users.name,
};

/** A project admin sees every token of the project; everyone else only their own. */
export function listApiTokens(
  db: Database,
  projectId: string,
  viewer: { id: string; seesAll: boolean },
) {
  return db
    .select(listColumns)
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.projectId, projectId),
        viewer.seesAll ? undefined : eq(apiTokens.userId, viewer.id),
      ),
    )
    .orderBy(desc(apiTokens.createdAt));
}

export async function createApiToken(
  db: Database,
  actor: AuthUser,
  projectId: string,
  input: { name: string; expiresInDays: number },
  opts: { ip?: string | null } = {},
) {
  const token = newApiToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiTokens)
      .values({
        projectId,
        userId: actor.id,
        name: input.name,
        tokenHash: hashSessionToken(token),
        tokenPrefix: token.slice(0, 14),
        expiresAt,
      })
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        expiresAt: apiTokens.expiresAt,
        tokenPrefix: apiTokens.tokenPrefix,
      });
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "api_token.created",
      entityType: "api_token",
      entityId: row!.id,
      data: { name: row!.name, expiresAt: expiresAt.toISOString() },
      ip: opts.ip,
    });
    // The only time the token itself leaves the server.
    return { ...row!, token };
  });
}

export async function revokeApiToken(
  db: Database,
  actor: AuthUser,
  projectId: string,
  tokenId: string,
  opts: { ip?: string | null; mayRevokeOthers: boolean },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.projectId, projectId),
          isNull(apiTokens.revokedAt),
          opts.mayRevokeOthers ? undefined : eq(apiTokens.userId, actor.id),
        ),
      )
      .returning({ id: apiTokens.id, name: apiTokens.name });
    if (!row) throw notFound("Token");
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      projectId,
      actorUserId: actor.id,
      action: "api_token.revoked",
      entityType: "api_token",
      entityId: row.id,
      data: { name: row.name },
      ip: opts.ip,
    });
  });
}

/** Turns a presented token into the user it acts for, or null when it is unknown, expired or revoked. */
export async function resolveApiToken(db: Database, token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashSessionToken(token)),
        isNull(apiTokens.revokedAt),
        gt(apiTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row || !row.user.isActive) return null;
  const lastUsed = row.token.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > 60_000) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, row.token.id));
  }
  return {
    id: row.user.id,
    organizationId: row.user.organizationId,
    email: row.user.email,
    name: row.user.name,
    isOrgAdmin: row.user.isOrgAdmin,
    token: { id: row.token.id, projectId: row.token.projectId },
  };
}
