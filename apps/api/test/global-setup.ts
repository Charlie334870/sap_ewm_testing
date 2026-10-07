import { sql } from "drizzle-orm";
import { createDatabase, runMigrations } from "@ewm/database";
import { testDatabaseUrl } from "./env";

/** Runs once before all tests: empties the test database and applies every migration. */
export default async function setup() {
  const handle = createDatabase(testDatabaseUrl(), { max: 1 });
  try {
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`create schema public`);
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
