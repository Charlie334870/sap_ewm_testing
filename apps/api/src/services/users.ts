import { and, asc, eq } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import { DEFAULT_SCRYPT_PARAMS, hashPassword } from "@ewm/auth";
import { schema, type Database } from "@ewm/database";
import type { CreateUserInput } from "@ewm/shared";
import type { AuthUser } from "../context";
import { badRequest, conflict, notFound } from "../errors";
import { isUniqueViolation } from "./pg-errors";

const { users, sessions } = schema;

const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  isOrgAdmin: users.isOrgAdmin,
  isActive: users.isActive,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
};

export function listUsers(db: Database, organizationId: string) {
  return db
    .select(publicColumns)
    .from(users)
    .where(eq(users.organizationId, organizationId))
    .orderBy(asc(users.name));
}

export async function createUser(
  db: Database,
  actor: AuthUser,
  input: CreateUserInput,
  opts: { ip?: string | null; scryptN?: number } = {},
) {
  const passwordHash = await hashPassword(input.password, {
    ...DEFAULT_SCRYPT_PARAMS,
    N: opts.scryptN ?? DEFAULT_SCRYPT_PARAMS.N,
  });
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          organizationId: actor.organizationId,
          email: input.email,
          name: input.name,
          passwordHash,
          isOrgAdmin: input.isOrgAdmin,
        })
        .returning(publicColumns);
      await appendAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: "user.created",
        entityType: "user",
        entityId: user!.id,
        data: { email: user!.email, name: user!.name, isOrgAdmin: user!.isOrgAdmin },
        ip: opts.ip,
      });
      return user!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A user with this email already exists.");
    throw err;
  }
}

export async function setUserActive(
  db: Database,
  actor: AuthUser,
  userId: string,
  isActive: boolean,
  opts: { ip?: string | null } = {},
) {
  if (userId === actor.id && !isActive) throw badRequest("You cannot deactivate your own account.");
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ isActive })
      .where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)))
      .returning(publicColumns);
    if (!user) throw notFound("User");
    if (!isActive) await tx.delete(sessions).where(eq(sessions.userId, userId));
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: isActive ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: user.id,
      data: { email: user.email },
      ip: opts.ip,
    });
    return user;
  });
}

/** An administrator sets a new password for someone who is locked out. Ends all their sessions. */
export async function resetPassword(
  db: Database,
  actor: AuthUser,
  userId: string,
  password: string,
  opts: { ip?: string | null; scryptN?: number } = {},
) {
  if (userId === actor.id) throw badRequest("Use the Password page to change your own password.");
  const passwordHash = await hashPassword(password, {
    ...DEFAULT_SCRYPT_PARAMS,
    N: opts.scryptN ?? DEFAULT_SCRYPT_PARAMS.N,
  });
  await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)))
      .returning({ id: users.id, email: users.email });
    if (!user) throw notFound("User");
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await appendAudit(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: "user.password_reset",
      entityType: "user",
      entityId: user.id,
      data: { email: user.email },
      ip: opts.ip,
    });
  });
}
