import { existsSync } from "node:fs";
import path from "node:path";

/** Loads .env from the repository root (if present) and returns the test database URL. */
export function testDatabaseUrl(): string {
  const envFile = path.resolve(import.meta.dirname, "../../../.env");
  if (!process.env.DATABASE_URL_TEST && existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Copy .env.example to .env and start the database first.",
    );
  }
  // The test run wipes this database. Refuse anything that is not clearly a test database.
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against "${name}": the database name must end with _test.`,
    );
  }
  return url;
}
