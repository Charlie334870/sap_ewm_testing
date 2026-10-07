import { and, eq, gt, ne } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import {
  DEFAULT_SCRYPT_PARAMS,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  SESSION_TTL_MS,
  verifyPassword,
} from "@ewm/auth";
import { schema, type Database } from "@ewm/database";
import type { AuthUser } from "../context";
import { badRequest, unauthorized } from "../errors";

const { users, sessions } = schema;

// Verified against when the email is unknown, so both paths cost about the same time.
const dummyHash = hashPassword("not-a-real-password", { ...DEFAULT_SCRYPT_PARAMS, N: 2 ** 12 });

const INVALID_LOGIN = "The email or password is not correct.";

export async function login(
  db: Database,
  input: { email: string; password: string },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user) {
    await verifyPassword(input.password, await dummyHash);
    throw unauthorized(INVALID_LOGIN);
  }
  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    await db.transaction((tx) =>
      appendAudit(tx, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user.id,
        data: { reason: passwordOk ? "account_deactivated" : "wrong_password" },
        ip: meta.ip,
      }),
    );
    throw unauthorized(INVALID_LOGIN);
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      })
      .returning({ id: sessions.id });
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await appendAudit(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "auth.login",
      entityType: "session",
      entityId: session!.id,
      ip: meta.ip,
    });
  });
  return { token, expiresAt, user: toAuthUser(user) };
}

export async function resolveSession(
  db: Database,
  token: string,
): Promise<{ user: AuthUser; sessionId: string } | null> {
  const [row] = await db
    .select({ sessionId: sessions.id, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.user.isActive) return null;
  return { user: toAuthUser(row.user), sessionId: row.sessionId };
}

export async function logout(db: Database, user: AuthUser, sessionId: string, ip?: string | null) {
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.id, sessionId));
    await appendAudit(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "auth.logout",
      entityType: "session",
      entityId: sessionId,
      ip,
    });
  });
}

export async function changePassword(
  db: Database,
  user: AuthUser,
  sessionId: string,
  input: { currentPassword: string; newPassword: string },
  opts: { ip?: string | null; scryptN?: number } = {},
) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row || !(await verifyPassword(input.currentPassword, row.passwordHash))) {
    throw badRequest("The current password is not correct.");
  }
  if (input.newPassword === input.currentPassword) {
    throw badRequest("The new password must be different from the current one.");
  }
  const passwordHash = await hashPassword(input.newPassword, {
    ...DEFAULT_SCRYPT_PARAMS,
    N: opts.scryptN ?? DEFAULT_SCRYPT_PARAMS.N,
  });
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    // Sign out every other device.
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, sessionId)));
    await appendAudit(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "auth.password_changed",
      entityType: "user",
      entityId: user.id,
      ip: opts.ip,
    });
  });
}

function toAuthUser(u: typeof users.$inferSelect): AuthUser {
  return {
    id: u.id,
    organizationId: u.organizationId,
    email: u.email,
    name: u.name,
    isOrgAdmin: u.isOrgAdmin,
  };
}
