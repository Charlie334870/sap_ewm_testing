import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@ewm/database";
import { createFakeSap, FAKE_API_KEY, type FakeSap } from "@ewm/sap-tools/testing";
import { createProjectWithTeam, createTestContext, createUser, signIn, type TestContext } from "./helpers";

let ctx: TestContext;
let sap: FakeSap;
let team: Awaited<ReturnType<typeof createProjectWithTeam>>;
let p: string;
let simulatedId: string;
let sandboxId: string;

beforeAll(async () => {
  sap = createFakeSap({
    data: {
      WarehouseAvailableStock: [{ EWMWarehouse: "1750", Product: "EWMS4-01", EWMStockType: "F2", AvailableEWMStockQty: 95, EWMStockQuantityBaseUnit: "EA" }],
      WarehouseTask: [{ Warehouse: "1750", WarehouseTask: "100000001", Delivery: "80000123", WarehouseTaskStatus: "C" }],
    },
  });
  ctx = await createTestContext({ sapFetch: sap.fetch });
  team = await createProjectWithTeam(ctx, "TOOL");
  p = `/projects/${team.project.id}`;
  simulatedId = (await team.admin.post(`${p}/sap-systems`, { name: "Simulated EWM", sid: "S4D", client: "100", environment: "DEV" })).json().sapSystem.id;
  const sandbox = await team.admin.post(`${p}/sap-systems`, { name: "SAP API sandbox", adapter: "sap_api_sandbox", apiKey: FAKE_API_KEY });
  expect(sandbox.statusCode, sandbox.body).toBe(201);
  sandboxId = sandbox.json().sapSystem.id;
});
afterAll(() => ctx.close());

const tool = (systemId: string, name: string) => `${p}/sap-systems/${systemId}/tools/${name}`;

describe("running tools on a simulated system", () => {
  it("returns the data in an envelope that says it is simulated, and records the call", async () => {
    const res = await team.consultant.post(tool(simulatedId, "get_delivery"), { input: { direction: "outbound", delivery: "80001001" } });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result).toMatchObject({
      tool: "get_delivery",
      status: "ok",
      source: "SIMULATED",
      system: { sid: "S4D", client: "100", environment: "DEV", adapter: "simulated" },
      data: { found: true, delivery: { number: "80001001" } },
    });
    expect(result.error).toBeUndefined();

    const recorded = (await team.consultant.get(`${p}/tool-calls/${result.toolCallId}`)).json().toolCall;
    expect(recorded).toMatchObject({
      toolName: "get_delivery",
      status: "ok",
      source: "SIMULATED",
      calledByName: "The consultant",
      viaToken: null,
      input: { direction: "outbound", delivery: "80001001" },
    });
    expect(recorded.output.found).toBe(true);
  });

  it("lets consultants and admins run tools, not analysts", async () => {
    const body = { input: { warehouse: "MUHW", product: "P-2000" } };
    expect((await team.analyst.post(tool(simulatedId, "get_stock"), body)).statusCode).toBe(403);
    expect((await team.analyst.get(`${p}/tool-calls`)).statusCode).toBe(403);
    expect((await team.consultant.post(tool(simulatedId, "get_stock"), body)).statusCode).toBe(200);
    expect((await team.admin.post(tool(simulatedId, "get_stock"), body)).statusCode).toBe(200);
  });

  it("rejects invalid input without touching the system, and still records the attempt", async () => {
    const res = await team.consultant.post(tool(simulatedId, "get_warehouse_tasks"), { input: { warehouse: "MUHW" } });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.status).toBe("rejected");
    expect(result.error.code).toBe("invalid_input");
    expect(result.data).toBeUndefined();
    const recorded = (await team.consultant.get(`${p}/tool-calls/${result.toolCallId}`)).json().toolCall;
    expect(recorded).toMatchObject({ status: "rejected", output: null });
  });

  it("answers 'not found' for a tool that does not exist and a system of another project", async () => {
    expect((await team.consultant.post(tool(simulatedId, "delete_everything"), { input: {} })).statusCode).toBe(404);
    const other = await createProjectWithTeam(ctx, "OTHR");
    const foreign = (await other.admin.post(`/projects/${other.project.id}/sap-systems`, { name: "Theirs", sid: "X4D", client: "100", environment: "DEV" })).json().sapSystem.id;
    const viaMine = await team.consultant.post(tool(foreign, "get_queue_status"), { input: {} });
    expect(viaMine.statusCode).toBe(404);
    const viaTheirs = await team.consultant.post(`/projects/${other.project.id}/sap-systems/${foreign}/tools/get_queue_status`, { input: {} });
    expect(viaTheirs.statusCode).toBe(404);
    // Their tool calls stay theirs.
    await other.consultant.post(`/projects/${other.project.id}/sap-systems/${foreign}/tools/get_queue_status`, { input: {} });
    const mine = (await team.consultant.get(`${p}/tool-calls?limit=200`)).json().toolCalls;
    expect(mine.every((c: { sapSystemId: string }) => c.sapSystemId !== foreign)).toBe(true);
  });

  it("links a call to a ticket of the same project only", async () => {
    const ticket = (await team.analyst.post(`${p}/tickets`, { title: "Linked" })).json().ticket;
    const ok = (await team.consultant.post(tool(simulatedId, "get_queue_status"), { input: {}, ticketId: ticket.id })).json().result;
    expect(ok.status).toBe("ok");
    expect((await team.consultant.get(`${p}/tool-calls/${ok.toolCallId}`)).json().toolCall.ticketNumber).toBe(ticket.number);

    const other = await createProjectWithTeam(ctx, "TKT");
    const theirs = (await other.analyst.post(`/projects/${other.project.id}/tickets`, { title: "Theirs" })).json().ticket;
    const crossed = (await team.consultant.post(tool(simulatedId, "get_queue_status"), { input: {}, ticketId: theirs.id })).json().result;
    expect(crossed).toMatchObject({ status: "rejected", error: { code: "ticket_not_found" } });
  });

  it("creates the sample ticket of each scenario once", async () => {
    expect((await team.consultant.post(`${p}/sap-systems/${simulatedId}/sample-tickets`)).statusCode).toBe(403);
    const first = await team.admin.post(`${p}/sap-systems/${simulatedId}/sample-tickets`);
    expect(first.statusCode).toBe(201);
    expect(first.json().created).toHaveLength(3);
    expect((await team.admin.post(`${p}/sap-systems/${simulatedId}/sample-tickets`)).json()).toMatchObject({ created: [], skipped: 3 });
    const detail = (await team.analyst.get(`${p}/tickets/${first.json().created[0].id}`)).json().ticket;
    expect(detail).toMatchObject({ sapSystemAdapter: "simulated", warehouse: "MUHW" });
    expect(detail.title).toContain("80001001");
  });

  it("describes a simulated system with all tools and its scenarios", async () => {
    const detail = (await team.analyst.get(`${p}/sap-systems/${simulatedId}`)).json().sapSystem;
    expect(detail.source).toBe("SIMULATED");
    expect(detail.tools.every((t: { available: boolean }) => t.available)).toBe(true);
    expect(detail.scenarios.map((s: { useCase: number }) => s.useCase)).toEqual([1, 5, 9]);
    expect(JSON.stringify(detail)).not.toMatch(/root cause/i);
  });
});

describe("SAP API sandbox connection", () => {
  it("stores the API key encrypted and never gives it back", async () => {
    const [credential] = await ctx.database.db.select().from(schema.sapCredentials).where(eq(schema.sapCredentials.sapSystemId, sandboxId));
    expect(credential!.secretEncrypted).not.toContain(FAKE_API_KEY);

    const everything = [
      await team.admin.get(`${p}/sap-systems`),
      await team.admin.get(`${p}/sap-systems/${sandboxId}`),
      await team.admin.get(`${p}/audit-logs?limit=200`),
      await team.orgAdmin.get(`/audit-logs?limit=200`),
    ];
    for (const res of everything) expect(res.body).not.toContain(FAKE_API_KEY);
    const system = (await team.admin.get(`${p}/sap-systems/${sandboxId}`)).json().sapSystem;
    expect(system).toMatchObject({ sid: "SBX", client: "000", environment: "DEV", source: "SAP_SANDBOX", baseUrl: "https://sandbox.api.sap.com/s4hanacloud" });
  });

  it("reads real-shaped data through the gateway and labels it as sandbox data", async () => {
    const result = (await team.consultant.post(tool(sandboxId, "get_stock"), { input: { warehouse: "1750", product: "EWMS4-01" } })).json().result;
    expect(result).toMatchObject({
      status: "ok",
      source: "SAP_SANDBOX",
      data: { basis: "available_only", rows: [{ stockType: "F2", availableQuantity: 95, physicalQuantity: null }] },
    });
    expect(sap.requests.at(-1)!.headers.apikey).toBe(FAKE_API_KEY);
    expect(sap.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("refuses tools SAP has no released API for, and explains why", async () => {
    const before = sap.requests.length;
    const result = (await team.consultant.post(tool(sandboxId, "get_application_log"), { input: { externalId: "80000123" } })).json().result;
    expect(result.status).toBe("rejected");
    expect(result.error).toMatchObject({ code: "not_supported" });
    expect(result.error.message).toContain("SAP has not released an API");
    expect(result.data).toBeUndefined();
    expect(sap.requests.length).toBe(before); // nothing was sent to SAP
  });

  it("tests the connection, stores the result and audits that it happened", async () => {
    expect((await team.analyst.post(`${p}/sap-systems/${sandboxId}/test`)).statusCode).toBe(403);
    const res = await team.consultant.post(`${p}/sap-systems/${sandboxId}/test`);
    expect(res.statusCode).toBe(200);
    const check = res.json().check;
    expect(check.reachable).toBe(true);
    expect(check.tools.filter((t: { available: boolean }) => t.available)).toHaveLength(6);
    const stored = (await team.admin.get(`${p}/sap-systems/${sandboxId}`)).json().sapSystem;
    expect(stored.lastCheck.summary).toBe(check.summary);
    const audit = (await team.admin.get(`${p}/audit-logs?limit=5`)).json().entries[0];
    expect(audit).toMatchObject({ action: "sap_system.tested", data: { reachable: true, toolsAvailable: 6 } });
    expect((await team.consultant.post(`${p}/sap-systems/${simulatedId}/test`)).statusCode).toBe(400);
  });

  it("reports a wrong key as an authentication failure, then works after the key is replaced", async () => {
    expect((await team.consultant.put(`${p}/sap-systems/${sandboxId}/credential`, { apiKey: "some-other-key-123" })).statusCode).toBe(403);
    expect((await team.admin.put(`${p}/sap-systems/${sandboxId}/credential`, { apiKey: "some-other-key-123" })).statusCode).toBe(200);
    const failed = (await team.consultant.post(tool(sandboxId, "get_stock"), { input: { warehouse: "1750", product: "EWMS4-01" } })).json().result;
    expect(failed).toMatchObject({ status: "error", error: { code: "authentication_failed" } });
    expect(failed.data).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain("some-other-key-123");

    await team.admin.put(`${p}/sap-systems/${sandboxId}/credential`, { apiKey: FAKE_API_KEY });
    const again = (await team.consultant.post(tool(sandboxId, "get_stock"), { input: { warehouse: "1750", product: "EWMS4-01" } })).json().result;
    expect(again.status).toBe("ok");
    const actions = (await team.admin.get(`${p}/audit-logs?limit=10`)).json().entries.map((e: { action: string }) => e.action);
    expect(actions.filter((a: string) => a === "sap_system.credential_changed")).toHaveLength(2);
  });

  it("only accepts SAP's sandbox address, the DEV environment, and one sandbox per project", async () => {
    const fresh = await createProjectWithTeam(ctx, "SBXX");
    const base = `/projects/${fresh.project.id}/sap-systems`;
    const body = { name: "Sandbox", adapter: "sap_api_sandbox", apiKey: FAKE_API_KEY };
    for (const baseUrl of ["https://evil.example/s4hanacloud", "http://sandbox.api.sap.com/s4hanacloud", "https://localhost:4000", "https://169.254.169.254/latest"]) {
      const res = await fresh.admin.post(base, { ...body, baseUrl });
      expect(res.statusCode, baseUrl).toBe(400);
    }
    expect((await fresh.admin.post(base, { ...body, environment: "PROD" })).statusCode).toBe(400);
    expect((await fresh.admin.post(base, { name: "No key", adapter: "sap_api_sandbox" })).statusCode).toBe(400);
    expect((await fresh.consultant.post(base, body)).statusCode).toBe(403);
    expect((await fresh.admin.post(base, body)).statusCode).toBe(201);
    expect((await fresh.admin.post(base, body)).statusCode).toBe(409);
    expect((await fresh.admin.post(base, { name: "Client PRD", adapter: "sap", sid: "PRD", client: "100", environment: "PROD" })).statusCode).toBe(400);
  });

  it("never treats a value from a ticket or a user as part of the filter", async () => {
    const result = (await team.consultant.post(tool(sandboxId, "get_warehouse_tasks"), { input: { warehouse: "1750", delivery: "x' or Warehouse eq '1750" } })).json().result;
    expect(result.status).toBe("ok");
    expect(result.data.tasks).toEqual([]);
  });
});

describe("tool call history", () => {
  it("lists calls newest first and can be narrowed to one system", async () => {
    const all = (await team.consultant.get(`${p}/tool-calls?limit=200`)).json().toolCalls;
    expect(all.length).toBeGreaterThan(5);
    const times = all.map((c: { createdAt: string }) => c.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    const sandboxOnly = (await team.consultant.get(`${p}/tool-calls?sapSystemId=${sandboxId}`)).json().toolCalls;
    expect(sandboxOnly.length).toBeGreaterThan(0);
    expect(sandboxOnly.every((c: { source: string }) => c.source === "SAP_SANDBOX")).toBe(true);
  });

  it("is not visible to people outside the project", async () => {
    const outsider = await signIn(ctx, await createUser(ctx, team.org.id));
    expect((await outsider.get(`${p}/tool-calls`)).statusCode).toBe(404);
    expect((await outsider.get(`${p}/sap-systems/${simulatedId}`)).statusCode).toBe(404);
    expect((await outsider.post(tool(simulatedId, "get_queue_status"), { input: {} })).statusCode).toBe(404);
  });
});
