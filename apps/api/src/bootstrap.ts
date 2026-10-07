import { count } from "drizzle-orm";
import { appendAudit } from "@ewm/audit";
import { DEFAULT_SCRYPT_PARAMS, hashPassword } from "@ewm/auth";
import { schema, type Database } from "@ewm/database";
import type { Config } from "./config";

const { organizations, users } = schema;

/**
 * Creates the organisation and its first administrator when the database has no users yet.
 * Does nothing on every later start, so changing the BOOTSTRAP_ values afterwards has no effect.
 */
export async function bootstrapFirstAdmin(
  db: Database,
  bootstrap: Config["bootstrap"],
  opts: { scryptN?: number } = {},
): Promise<"created" | "skipped" | "not_configured"> {
  const [existing] = await db.select({ count: count() }).from(users);
  if ((existing?.count ?? 0) > 0) return "skipped";
  if (!bootstrap.adminEmail || !bootstrap.adminPassword) return "not_configured";

  const passwordHash = await hashPassword(bootstrap.adminPassword, {
    ...DEFAULT_SCRYPT_PARAMS,
    N: opts.scryptN ?? DEFAULT_SCRYPT_PARAMS.N,
  });
  await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: bootstrap.orgName }).returning();
    const [admin] = await tx
      .insert(users)
      .values({
        organizationId: org!.id,
        email: bootstrap.adminEmail!,
        name: bootstrap.adminName,
        passwordHash,
        isOrgAdmin: true,
      })
      .returning();
    await appendAudit(tx, {
      organizationId: org!.id,
      actorType: "system",
      action: "organization.bootstrapped",
      entityType: "organization",
      entityId: org!.id,
      data: { organization: org!.name, adminEmail: admin!.email },
    });
  });
  return "created";
}
