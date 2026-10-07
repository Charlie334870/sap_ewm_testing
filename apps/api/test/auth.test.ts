import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSessionToken, SESSION_COOKIE } from "@ewm/auth";
import { schema } from "@ewm/database";
import {
  createOrg,
  createTestContext,
  createUser,
  PASSWORD,
  signIn,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const login = (email: string, password: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
    headers,
  });

describe("signing in", () => {
  it("sets an HttpOnly session cookie and stores only a hash of the token", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    const res = await login(user.email, PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: user.id, email: user.email });
    expect(JSON.stringify(res.json())).not.toContain("passwordHash");

    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");

    const stored = await ctx.database.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(hashSessionToken(cookie.value));
    expect(stored[0]!.tokenHash).not.toBe(cookie.value);
  });

  it("accepts the email in any letter case", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    expect((await login(user.email.toUpperCase(), PASSWORD)).statusCode).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    const wrong = await login(user.email, "definitely-wrong-password");
    const unknown = await login("nobody@example.test", "definitely-wrong-password");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.cookies).toHaveLength(0);
  });

  it("records a failed attempt in the audit log", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    await login(user.email, "definitely-wrong-password");
    const entries = await ctx.database.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, org.id));
    expect(entries.map((e) => e.action)).toEqual(["auth.login_failed"]);
    expect(JSON.stringify(entries)).not.toContain("definitely-wrong-password");
  });

  it("refuses a deactivated user and ends their open sessions", async () => {
    const org = await createOrg(ctx);
    const admin = await signIn(ctx, await createUser(ctx, org.id, { isOrgAdmin: true }));
    const user = await createUser(ctx, org.id);
    const client = await signIn(ctx, user);
    expect((await client.get("/auth/me")).statusCode).toBe(200);

    expect((await admin.patch(`/users/${user.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await client.get("/auth/me")).statusCode).toBe(401);
    expect((await login(user.email, PASSWORD)).statusCode).toBe(401);
  });
});

describe("sessions", () => {
  it("requires a session for every data route", async () => {
    for (const url of ["/auth/me", "/projects", "/users", "/audit-logs", "/audit-logs/verify"]) {
      const res = await ctx.app.inject({ method: "GET", url: `/api/v1${url}` });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it("ignores a made-up session cookie", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ignores an expired session", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    const client = await signIn(ctx, user);
    await ctx.database.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.userId, user.id));
    expect((await client.get("/auth/me")).statusCode).toBe(401);
  });

  it("ends the session on sign-out", async () => {
    const org = await createOrg(ctx);
    const client = await signIn(ctx, await createUser(ctx, org.id));
    expect((await client.post("/auth/logout")).statusCode).toBe(200);
    expect((await client.get("/auth/me")).statusCode).toBe(401);
  });

  it("rejects state-changing requests that come from another website", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    const foreign = await login(user.email, PASSWORD, { origin: "https://evil.example" });
    expect(foreign.statusCode).toBe(403);
    const own = await login(user.email, PASSWORD, { origin: "http://localhost:3000" });
    expect(own.statusCode).toBe(200);
  });
});

describe("changing a password", () => {
  it("needs the current password, enforces the minimum length and signs out other devices", async () => {
    const org = await createOrg(ctx);
    const user = await createUser(ctx, org.id);
    const laptop = await signIn(ctx, user);
    const phone = await signIn(ctx, user);

    const wrongCurrent = await laptop.post("/auth/change-password", {
      currentPassword: "not-the-password",
      newPassword: "a-brand-new-password",
    });
    expect(wrongCurrent.statusCode).toBe(400);

    const tooShort = await laptop.post("/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "short",
    });
    expect(tooShort.statusCode).toBe(400);

    const ok = await laptop.post("/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });
    expect(ok.statusCode).toBe(200);
    expect((await laptop.get("/auth/me")).statusCode).toBe(200);
    expect((await phone.get("/auth/me")).statusCode).toBe(401);
    expect((await login(user.email, PASSWORD)).statusCode).toBe(401);
    expect((await login(user.email, "a-brand-new-password")).statusCode).toBe(200);
  });
});
