import { createDatabase, runMigrations } from "@ewm/database";
import { createSecretBox } from "@ewm/sap-tools";
import { buildApp } from "./app";
import { bootstrapFirstAdmin } from "./bootstrap";
import { loadConfig } from "./config";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);

await runMigrations(database.db);
const bootstrap = await bootstrapFirstAdmin(database.db, config.bootstrap);

const app = await buildApp({
  db: database.db,
  config,
  secrets: config.secretsKey ? createSecretBox(config.secretsKey) : null,
  trustProxy: process.env.TRUST_PROXY === "true",
});

if (bootstrap === "created")
  app.log.info(`First administrator created: ${config.bootstrap.adminEmail}`);
if (!config.secretsKey) {
  app.log.warn("SECRETS_KEY is not set: only simulated SAP systems can be registered. See docs/SETUP.md.");
}
if (bootstrap === "not_configured") {
  app.log.warn(
    "No users exist. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, then restart.",
  );
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: config.host });
