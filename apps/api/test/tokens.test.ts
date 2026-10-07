import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSessionToken } from "@ewm/auth";
import { schema } from "@ewm/database";
import { createProjectWithTeam, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let team: Awaited<ReturnType<typeof createProjectWithTeam>>;
let p: string;
let systemId: string;
let token: string;
let tokenId: string;

const asAgent = (method: "GET" | "POST" | "DELETE", url: string, body?: object, bearer = token) =>
  ctx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${bearer}` },
    ...(body ? { payload: body } : {}),
  });

beforeAll(async () => {
  ctx = await createTestContext();
  team = await createProjectWithTeam(ctx, "AGNT");
  p = `/projects/${team.project.id}`;
  systemId = (
    await team.admin.post(`${p}/sap-systems`, {
      name: "Simulated",
      sid: "S4D",
      client: "100",
      environment: "DEV",
    })
  ).json().sapSystem.id;
  await team.admin.post(`${p}/sap-systems/${systemId}/sample-tickets`);
  const created = await team.consultant.post(`${p}/api-tokens`, { name: "Claude Desktop" });
  expect(created.statusCode).toBe(201);
  token = created.json().token.token;
  tokenId = created.json().token.id;
});
afterAll(() => ctx.close());

describe("agent access tokens", () => {
  it("are shown once, stored only as a hash, and listed without the secret", async () => {
    expect(token).toMatch(/^ewm_pat_[A-Za-z0-9_-]{43}$/);
    const [row] = await ctx.database.db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, tokenId));
    expect(row!.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const listed = await team.consultant.get(`${p}/api-tokens`);
    expect(listed.body).not.toContain(token);
    expect(listed.json().tokens[0]).toMatchObject({
      name: "Claude Desktop",
      userName: "The consultant",
      revokedAt: null,
    });
    expect((await team.admin.get(`${p}/audit-logs?limit=200`)).body).not.toContain(token);
  });

  it("can be created by consultants and admins only, and each person sees their own", async () => {
    expect((await team.analyst.post(`${p}/api-tokens`, { name: "No" })).statusCode).toBe(403);
    expect((await team.analyst.get(`${p}/api-tokens`)).statusCode).toBe(403);
    await team.admin.post(`${p}/api-tokens`, { name: "Admin's own" });
    const forConsultant = (await team.consultant.get(`${p}/api-tokens`))
      .json()
      .tokens.map((t: { name: string }) => t.name);
    expect(forConsultant).toEqual(["Claude Desktop"]);
    const forAdmin = (await team.admin.get(`${p}/api-tokens`))
      .json()
      .tokens.map((t: { name: string }) => t.name);
    expect(forAdmin.sort()).toEqual(["Admin's own", "Claude Desktop"]);
  });

  it("give the agent its context: project, systems, tools and open tickets", async () => {
    const res = await asAgent("GET", "/agent/context");
    expect(res.statusCode).toBe(200);
    const context = res.json();
    expect(context.project).toMatchObject({ key: "AGNT" });
    expect(context.actingFor).toEqual({ name: "The consultant", role: "consultant" });
    expect(context.sapSystems).toEqual([
      expect.objectContaining({ sid: "S4D", source: "SIMULATED" }),
    ]);
    expect(context.sapSystems[0].toolsAvailable).toHaveLength(11);
    expect(context.tools.map((t: { name: string }) => t.name)).toContain("get_warehouse_tasks");
    expect(context.openTickets).toHaveLength(3);
    // A browser session cannot use the agent address.
    expect((await team.consultant.get("/agent/context")).statusCode).toBe(403);
  });

  it("let the agent read tickets and run read-only tools, recorded under the token", async () => {
    const tickets = (await asAgent("GET", `${p}/tickets`)).json().tickets;
    expect(tickets).toHaveLength(3);
    const ticket = (await asAgent("GET", `${p}/tickets/${tickets[0].id}`)).json().ticket;
    expect(ticket.events[0].type).toBe("created");

    const run = await asAgent("POST", `${p}/sap-systems/${systemId}/tools/get_delivery`, {
      input: { direction: "outbound", delivery: "80001003" },
      ticketId: tickets[0].id,
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().result).toMatchObject({ status: "ok", source: "SIMULATED" });
    const recorded = (
      await team.consultant.get(`${p}/tool-calls/${run.json().result.toolCallId}`)
    ).json().toolCall;
    expect(recorded).toMatchObject({ viaToken: "Claude Desktop", calledByName: "The consultant" });
  });

  it("cannot change anything or reach beyond its project", async () => {
    const forbidden = [
      await asAgent("POST", `${p}/tickets`, { title: "Created by an agent" }),
      await asAgent("POST", `${p}/tickets/00000000-0000-4000-8000-000000000000/comments`, {
        body: "hi",
      }),
      await asAgent("POST", `${p}/sap-systems`, { name: "x", sid: "X4D", client: "100" }),
      await asAgent("POST", `${p}/sap-systems/${systemId}/sample-tickets`),
      await asAgent("POST", `${p}/api-tokens`, { name: "Self-replicating" }),
      await asAgent("DELETE", `${p}/api-tokens/${tokenId}`),
      await asAgent("GET", `${p}/audit-logs`),
      await asAgent("GET", `${p}/tool-calls`),
      await asAgent("GET", "/projects"),
      await asAgent("GET", "/users"),
      await asAgent("GET", "/auth/me"),
      await asAgent("POST", "/auth/change-password", {
        currentPassword: "x",
        newPassword: "y".repeat(12),
      }),
    ];
    for (const res of forbidden) expect(res.statusCode, res.raw.req?.url ?? "").toBe(403);

    const other = await createProjectWithTeam(ctx, "ELSE");
    const theirSystem = (
      await other.admin.post(`/projects/${other.project.id}/sap-systems`, {
        name: "Theirs",
        sid: "X4D",
        client: "100",
      })
    ).json().sapSystem.id;
    expect((await asAgent("GET", `/projects/${other.project.id}/tickets`)).statusCode).toBe(404);
    expect(
      (
        await asAgent(
          "POST",
          `/projects/${other.project.id}/sap-systems/${theirSystem}/tools/get_queue_status`,
          { input: {} },
        )
      ).statusCode,
    ).toBe(404);

    // The person behind the token is a member of a second project too. The token still only
    // opens the project it was created for.
    const second = (
      await team.orgAdmin.post("/projects", { key: "SECOND", name: "Second project" })
    ).json().project;
    await team.orgAdmin.put(`/projects/${second.id}/members`, {
      userId: team.consultant.userId,
      role: "consultant",
    });
    const secondSystem = (
      await team.orgAdmin.post(`/projects/${second.id}/sap-systems`, {
        name: "Second",
        sid: "S4D",
        client: "100",
      })
    ).json().sapSystem.id;
    expect((await team.consultant.get(`/projects/${second.id}/tickets`)).statusCode).toBe(200);
    expect((await asAgent("GET", `/projects/${second.id}/tickets`)).statusCode).toBe(404);
    expect((await asAgent("GET", `/projects/${second.id}/sap-systems`)).statusCode).toBe(404);
    expect(
      (
        await asAgent(
          "POST",
          `/projects/${second.id}/sap-systems/${secondSystem}/tools/get_queue_status`,
          { input: {} },
        )
      ).statusCode,
    ).toBe(404);

    // The same holds for an organisation administrator's token.
    const adminToken = (await team.orgAdmin.post(`${p}/api-tokens`, { name: "Org admin's" })).json()
      .token.token;
    expect(
      (await asAgent("GET", `/projects/${second.id}/tickets`, undefined, adminToken)).statusCode,
    ).toBe(404);
    expect((await asAgent("GET", "/users", undefined, adminToken)).statusCode).toBe(403);
  });

  it("stop working when revoked, expired, or when the person loses the role or the account", async () => {
    const make = async (client = team.consultant) =>
      (await client.post(`${p}/api-tokens`, { name: "Temp" })).json().token;

    expect(
      (await asAgent("GET", "/agent/context", undefined, "ewm_pat_" + "x".repeat(43))).statusCode,
    ).toBe(401);

    const revoked = await make();
    expect((await team.consultant.delete(`${p}/api-tokens/${revoked.id}`)).statusCode).toBe(200);
    expect((await asAgent("GET", "/agent/context", undefined, revoked.token)).statusCode).toBe(401);
    expect((await team.consultant.delete(`${p}/api-tokens/${revoked.id}`)).statusCode).toBe(404);

    const expired = await make();
    await ctx.database.db
      .update(schema.apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apiTokens.id, expired.id));
    expect((await asAgent("GET", "/agent/context", undefined, expired.token)).statusCode).toBe(401);

    // Someone else's token cannot be revoked by a consultant, but a project admin can.
    const adminsToken = await make(team.admin);
    expect((await team.consultant.delete(`${p}/api-tokens/${adminsToken.id}`)).statusCode).toBe(
      404,
    );
    const consultantsToken = await make();
    expect((await team.admin.delete(`${p}/api-tokens/${consultantsToken.id}`)).statusCode).toBe(
      200,
    );

    const demoted = await make();
    await team.admin.put(`${p}/members`, { userId: team.consultant.userId, role: "analyst" });
    expect(
      (
        await asAgent(
          "POST",
          `${p}/sap-systems/${systemId}/tools/get_queue_status`,
          { input: {} },
          demoted.token,
        )
      ).statusCode,
    ).toBe(403);
    await team.admin.put(`${p}/members`, { userId: team.consultant.userId, role: "consultant" });
    expect(
      (
        await asAgent(
          "POST",
          `${p}/sap-systems/${systemId}/tools/get_queue_status`,
          { input: {} },
          demoted.token,
        )
      ).statusCode,
    ).toBe(200);

    await team.orgAdmin.patch(`/users/${team.consultant.userId}`, { isActive: false });
    expect((await asAgent("GET", "/agent/context", undefined, demoted.token)).statusCode).toBe(401);
    await team.orgAdmin.patch(`/users/${team.consultant.userId}`, { isActive: true });
  });

  it("audits creation and revocation", async () => {
    const actions = (await team.admin.get(`${p}/audit-logs?limit=200`))
      .json()
      .entries.map((e: { action: string }) => e.action);
    expect(actions).toContain("api_token.created");
    expect(actions).toContain("api_token.revoked");
  });
});
