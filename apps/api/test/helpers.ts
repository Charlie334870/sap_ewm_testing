import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { DEFAULT_SCRYPT_PARAMS, hashPassword, SESSION_COOKIE } from "@ewm/auth";
import { createDatabase, schema, type DatabaseHandle } from "@ewm/database";
import type { ProjectRole } from "@ewm/shared";
import { createSecretBox } from "@ewm/sap-tools";
import { buildApp } from "../src/app";
import type { Config } from "../src/config";
import { testDatabaseUrl } from "./env";

export const TEST_SCRYPT_N = 2 ** 10; // fast hashing, tests only
export const PASSWORD = "correct-horse-battery";

export interface TestContext {
  app: FastifyInstance;
  database: DatabaseHandle;
  close: () => Promise<void>;
}

export async function createTestContext(options: { sapFetch?: typeof fetch } = {}): Promise<TestContext> {
  const database = createDatabase(testDatabaseUrl(), { max: 10 });
  const config: Config = {
    databaseUrl: testDatabaseUrl(),
    port: 0,
    host: "127.0.0.1",
    webOrigins: ["http://localhost:3000"],
    cookieSecure: false,
    logLevel: "silent",
    bootstrap: { orgName: "Test", adminName: "Admin" },
  };
  const app = await buildApp({
    db: database.db,
    config,
    scryptN: TEST_SCRYPT_N,
    loginRateLimit: 10_000,
    toolRateLimit: 10_000,
    secrets: createSecretBox("ab".repeat(32)),
    sapFetch: options.sapFetch,
    sandboxHosts: ["sandbox.api.sap.com"],
  });
  return {
    app,
    database,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

/** Each test creates its own organisation, so tests never see each other's data. */
export async function createOrg(ctx: TestContext, name = "Org") {
  const [org] = await ctx.database.db
    .insert(schema.organizations)
    .values({ name: `${name} ${randomUUID().slice(0, 8)}` })
    .returning();
  return org!;
}

export async function createUser(
  ctx: TestContext,
  organizationId: string,
  opts: { isOrgAdmin?: boolean; name?: string } = {},
) {
  const email = `user-${randomUUID().slice(0, 12)}@example.test`;
  const passwordHash = await hashPassword(PASSWORD, { ...DEFAULT_SCRYPT_PARAMS, N: TEST_SCRYPT_N });
  const [user] = await ctx.database.db
    .insert(schema.users)
    .values({
      organizationId,
      email,
      name: opts.name ?? "Test User",
      passwordHash,
      isOrgAdmin: opts.isOrgAdmin ?? false,
    })
    .returning();
  return user!;
}

/** A signed-in client: a thin wrapper that sends the session cookie with every request. */
export interface Client {
  userId: string;
  cookie: string;
  get: (url: string) => Promise<LightMyRequestResponse>;
  post: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  put: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  patch: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  delete: (url: string) => Promise<LightMyRequestResponse>;
}

export async function signIn(
  ctx: TestContext,
  user: { id: string; email: string },
): Promise<Client> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: user.email, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!session) throw new Error("no session cookie");
  const cookie = `${SESSION_COOKIE}=${session.value}`;
  const send = (method: InjectOptions["method"], url: string, body?: unknown) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie },
      ...(body === undefined ? {} : { payload: body as object }),
    });
  return {
    userId: user.id,
    cookie,
    get: (url) => send("GET", url),
    post: (url, body) => send("POST", url, body ?? {}),
    put: (url, body) => send("PUT", url, body ?? {}),
    patch: (url, body) => send("PATCH", url, body ?? {}),
    delete: (url) => send("DELETE", url),
  };
}

/**
 * A ready-made situation: one organisation with an administrator, one project, and one
 * signed-in member for each project role.
 */
export async function createProjectWithTeam(ctx: TestContext, key = "MUHW") {
  const org = await createOrg(ctx);
  const adminUser = await createUser(ctx, org.id, { isOrgAdmin: true, name: "Org Admin" });
  const orgAdmin = await signIn(ctx, adminUser);
  const created = await orgAdmin.post("/projects", { key, name: `Project ${key}` });
  if (created.statusCode !== 201) throw new Error(`project create failed: ${created.body}`);
  const project = created.json().project as { id: string; key: string };

  const members = {} as Record<ProjectRole, Client>;
  for (const role of ["analyst", "consultant", "admin"] as const) {
    const user = await createUser(ctx, org.id, { name: `The ${role}` });
    const res = await orgAdmin.put(`/projects/${project.id}/members`, { userId: user.id, role });
    if (res.statusCode !== 200) throw new Error(`member add failed: ${res.body}`);
    members[role] = await signIn(ctx, user);
  }
  return { org, orgAdmin, adminUser, project, ...members };
}
