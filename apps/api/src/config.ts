import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@ewm/shared";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: bool,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** 64 hex characters. Encrypts SAP connection secrets. Without it only simulated systems work. */
  SECRETS_KEY: z.string().optional(),
  BOOTSTRAP_ORG_NAME: z.string().default("My Consulting Company"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default("Administrator"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** Origins allowed to make state-changing requests. */
  webOrigins: string[];
  cookieSecure: boolean;
  logLevel: string;
  secretsKey?: string;
  bootstrap: { orgName: string; adminEmail?: string; adminName: string; adminPassword?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration. ${problems}`);
  }
  const e = parsed.data;
  if (e.SECRETS_KEY?.trim() && !/^[0-9a-fA-F]{64}$/.test(e.SECRETS_KEY.trim())) {
    throw new Error("SECRETS_KEY must be 64 hexadecimal characters. See docs/SETUP.md for how to create one.");
  }
  if (e.BOOTSTRAP_ADMIN_PASSWORD && e.BOOTSTRAP_ADMIN_PASSWORD.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.API_PORT,
    host: e.API_HOST,
    webOrigins: e.WEB_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: e.COOKIE_SECURE,
    logLevel: e.LOG_LEVEL,
    secretsKey: e.SECRETS_KEY?.trim() || undefined,
    bootstrap: {
      orgName: e.BOOTSTRAP_ORG_NAME,
      adminEmail: e.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || undefined,
      adminName: e.BOOTSTRAP_ADMIN_NAME,
      adminPassword: e.BOOTSTRAP_ADMIN_PASSWORD || undefined,
    },
  };
}
