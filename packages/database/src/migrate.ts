import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Default location of the SQL migrations, relative to this package. */
export const defaultMigrationsFolder = path.resolve(here, "../migrations");

/** Applies any migrations that have not run yet. Safe to call on every start. */
export async function runMigrations(
  db: Database,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
