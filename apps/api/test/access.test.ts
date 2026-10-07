import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOrg,
  createProjectWithTeam,
  createTestContext,
  createUser,
  signIn,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let team: Awaited<ReturnType<typeof createProjectWithTeam>>;
let ticketId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  team = await createProjectWithTeam(ctx, "ROLE");
  const res = await team.analyst.post(`/projects/${team.project.id}/tickets`, {
    title: "Seed ticket",
  });
  ticketId = res.json().ticket.id;
});
afterAll(() => ctx.close());

const system = { name: "Sandbox", sid: "S4D", client: "100", environment: "DEV" };

describe("project roles", () => {
  it("analyst: raises and reads tickets, nothing more", async () => {
    const p = `/projects/${team.project.id}`;
    expect((await team.analyst.get(p)).statusCode).toBe(200);
    expect((await team.analyst.post(`${p}/tickets`, { title: "WT not created" })).statusCode).toBe(
      201,
    );
    expect(
      (await team.analyst.post(`${p}/tickets/${ticketId}/comments`, { body: "Seen again today" }))
        .statusCode,
    ).toBe(201);

    expect(
      (await team.analyst.post(`${p}/tickets/${ticketId}/status`, { status: "resolved" }))
        .statusCode,
    ).toBe(403);
    expect((await team.analyst.get(`${p}/audit-logs`)).statusCode).toBe(403);
    expect((await team.analyst.post(`${p}/sap-systems`, system)).statusCode).toBe(403);
    expect(
      (await team.analyst.put(`${p}/members`, { userId: team.analyst.userId, role: "admin" }))
        .statusCode,
    ).toBe(403);
  });

  it("consultant: also changes ticket status and reads the audit log", async () => {
    const p = `/projects/${team.project.id}`;
    expect(
      (await team.consultant.post(`${p}/tickets/${ticketId}/status`, { status: "investigating" }))
        .statusCode,
    ).toBe(200);
    expect((await team.consultant.get(`${p}/audit-logs`)).statusCode).toBe(200);

    expect((await team.consultant.post(`${p}/sap-systems`, system)).statusCode).toBe(403);
    expect(
      (await team.consultant.put(`${p}/members`, { userId: team.consultant.userId, role: "admin" }))
        .statusCode,
    ).toBe(403);
    expect((await team.consultant.delete(`${p}/members/${team.analyst.userId}`)).statusCode).toBe(
      403,
    );
  });

  it("project admin: also manages SAP systems and members", async () => {
    const p = `/projects/${team.project.id}`;
    expect((await team.admin.post(`${p}/sap-systems`, system)).statusCode).toBe(201);
    const extra = await createUser(ctx, team.org.id);
    expect(
      (await team.admin.put(`${p}/members`, { userId: extra.id, role: "analyst" })).statusCode,
    ).toBe(200);
    expect(
      (await team.admin.put(`${p}/members`, { userId: extra.id, role: "consultant" })).statusCode,
    ).toBe(200);
    expect((await team.admin.delete(`${p}/members/${extra.id}`)).statusCode).toBe(200);
  });

  it("only a project admin sees who could be added, and never people of another organisation", async () => {
    const p = `/projects/${team.project.id}`;
    expect((await team.analyst.get(`${p}/member-candidates`)).statusCode).toBe(403);
    expect((await team.consultant.get(`${p}/member-candidates`)).statusCode).toBe(403);

    const colleague = await createUser(ctx, team.org.id, { name: "Not yet a member" });
    const outsider = await createUser(ctx, (await createOrg(ctx, "Elsewhere")).id);
    const ids = (await team.admin.get(`${p}/member-candidates`))
      .json()
      .users.map((u: { id: string }) => u.id);
    expect(ids).toContain(colleague.id);
    expect(ids).not.toContain(outsider.id);
    expect(ids).not.toContain(team.analyst.userId);
  });

  it("a role cannot be escalated by the person holding it", async () => {
    const p = `/projects/${team.project.id}`;
    await team.analyst.put(`${p}/members`, { userId: team.analyst.userId, role: "admin" });
    const detail = await team.orgAdmin.get(p);
    const me = detail
      .json()
      .members.find((m: { userId: string }) => m.userId === team.analyst.userId);
    expect(me.role).toBe("analyst");
  });
});

describe("organisation administration", () => {
  it("only an organisation administrator creates projects and users", async () => {
    for (const client of [team.analyst, team.consultant, team.admin]) {
      expect((await client.post("/projects", { key: "NOPE", name: "No" })).statusCode).toBe(403);
      expect((await client.get("/users")).statusCode).toBe(403);
      expect(
        (
          await client.post("/users", {
            email: "x@example.test",
            name: "X",
            password: "long-enough-password",
          })
        ).statusCode,
      ).toBe(403);
      expect((await client.get("/audit-logs")).statusCode).toBe(403);
      expect((await client.get("/audit-logs/verify")).statusCode).toBe(403);
    }
  });

  it("an organisation administrator is admin on every project without being a member", async () => {
    const secondAdmin = await signIn(ctx, await createUser(ctx, team.org.id, { isOrgAdmin: true }));
    const detail = await secondAdmin.get(`/projects/${team.project.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().project.role).toBe("admin");
  });

  it("creates users with a unique email and a password of at least 12 characters", async () => {
    const email = `new-${Date.now()}@example.test`;
    const short = await team.orgAdmin.post("/users", {
      email,
      name: "New Person",
      password: "short",
    });
    expect(short.statusCode).toBe(400);

    const created = await team.orgAdmin.post("/users", {
      email,
      name: "New Person",
      password: "long-enough-password",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user).not.toHaveProperty("passwordHash");

    const duplicate = await team.orgAdmin.post("/users", {
      email,
      name: "Again",
      password: "long-enough-password",
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("lets an administrator set a new password for a locked-out user, which ends their sessions", async () => {
    const user = await createUser(ctx, team.org.id);
    const client = await signIn(ctx, user);
    const login = (password: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: user.email, password },
      });

    expect(
      (
        await team.admin.post(`/users/${user.id}/reset-password`, {
          password: "a-new-long-password",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await team.orgAdmin.post(`/users/${user.id}/reset-password`, { password: "short" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await team.orgAdmin.post(`/users/${user.id}/reset-password`, {
          password: "a-new-long-password",
        })
      ).statusCode,
    ).toBe(200);

    expect((await client.get("/auth/me")).statusCode).toBe(401);
    expect((await login("a-new-long-password")).statusCode).toBe(200);

    const outsider = await createUser(ctx, (await createOrg(ctx, "Other")).id);
    expect(
      (
        await team.orgAdmin.post(`/users/${outsider.id}/reset-password`, {
          password: "a-new-long-password",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("does not let an administrator deactivate their own account", async () => {
    const res = await team.orgAdmin.patch(`/users/${team.orgAdmin.userId}`, { isActive: false });
    expect(res.statusCode).toBe(400);
  });

  it("does not let an administrator touch a user of another organisation", async () => {
    const otherOrg = await createOrg(ctx, "Other");
    const outsider = await createUser(ctx, otherOrg.id);
    expect(
      (await team.orgAdmin.patch(`/users/${outsider.id}`, { isActive: false })).statusCode,
    ).toBe(404);
  });
});
