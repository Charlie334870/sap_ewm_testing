import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectWithTeam, createTestContext, type TestContext } from "../../api/test/helpers";
import { PlatformApi } from "../src/api";
import { createMcpServer, INSTRUCTIONS } from "../src/mcp-server";

/**
 * The MCP server is tested against the real API (in process) and a real MCP client, joined by
 * an in-memory transport. Only the HTTP hop and the stdio pipe are left out.
 */
let ctx: TestContext;
let team: Awaited<ReturnType<typeof createProjectWithTeam>>;
let client: Client;
let p: string;

async function connect(token: string): Promise<Client> {
  const viaApp = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const res = await ctx.app.inject({
      method: (init?.method ?? "GET") as "GET",
      url: u.pathname + u.search,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(res.body, {
      status: res.statusCode,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const server = createMcpServer(new PlatformApi("http://platform.test", token, viaApp));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test-client", version: "1.0.0" });
  await c.connect(clientSide);
  return c;
}

const textOf = (result: unknown) =>
  (result as { content: Array<{ text: string }> }).content[0]!.text;

beforeAll(async () => {
  ctx = await createTestContext();
  team = await createProjectWithTeam(ctx, "MCPT");
  p = `/projects/${team.project.id}`;
  const systemId = (
    await team.admin.post(`${p}/sap-systems`, { name: "Simulated EWM", sid: "S4D", client: "100" })
  ).json().sapSystem.id;
  await team.admin.post(`${p}/sap-systems/${systemId}/sample-tickets`);
  const token = (await team.consultant.post(`${p}/api-tokens`, { name: "MCP test" })).json().token
    .token;
  client = await connect(token);
});
afterAll(async () => {
  await client.close();
  await ctx.close();
});

describe("EWM Agent MCP server", () => {
  it("introduces itself with the working rules", () => {
    expect(client.getServerVersion()).toMatchObject({ name: "ewm-agent" });
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toContain("Never fill the gap with an assumed result");
  });

  it("lists the platform tools and all SAP tools, every one marked read-only", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "ewm_list_tickets",
        "ewm_get_ticket",
        "ewm_list_sap_systems",
        "get_delivery",
        "get_configuration",
      ]),
    );
    expect(tools).toHaveLength(14);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
    const delivery = tools.find((t) => t.name === "get_delivery")!;
    expect(Object.keys(delivery.inputSchema.properties!)).toEqual(
      expect.arrayContaining(["system", "ticket", "direction", "delivery"]),
    );
    expect(delivery.inputSchema.required).toEqual(["direction", "delivery"]); // one system: it may be left out
  });

  it("reads tickets by reference", async () => {
    const list = JSON.parse(
      textOf(await client.callTool({ name: "ewm_list_tickets", arguments: {} })),
    );
    expect(list.openTickets.map((t: { reference: string }) => t.reference).sort()).toEqual([
      "MCPT-1",
      "MCPT-2",
      "MCPT-3",
    ]);
    const ticket = JSON.parse(
      textOf(await client.callTool({ name: "ewm_get_ticket", arguments: { ticket: "mcpt-1" } })),
    );
    expect(ticket.title).toContain("80001001");
    const missing = await client.callTool({
      name: "ewm_get_ticket",
      arguments: { ticket: "MCPT-99" },
    });
    expect(missing.isError).toBe(true);
  });

  it("runs an SAP tool, labels the source, and the call lands in the platform's record with the ticket", async () => {
    const result = await client.callTool({
      name: "get_stock",
      arguments: { warehouse: "MUHW", product: "P-1001", ticket: "MCPT-1" },
    });
    expect(result.isError).toBeFalsy();
    const body = textOf(result);
    expect(
      body.startsWith("SOURCE: SIMULATED (built-in practice system, no SAP system involved)"),
    ).toBe(true);
    expect(body).toContain("SYSTEM: S4D/100 DEV");
    const callId = /CALL ID: ([0-9a-f-]{36})/.exec(body)![1];
    expect(JSON.parse(body.slice(body.indexOf("{"))).rows[0]).toMatchObject({
      stockType: "Q4",
      physicalQuantity: 40,
    });

    const recorded = (await team.consultant.get(`${p}/tool-calls/${callId}`)).json().toolCall;
    expect(recorded).toMatchObject({
      toolName: "get_stock",
      viaToken: "MCP test",
      ticketNumber: 1,
      status: "ok",
    });
  });

  it("reports a refused call as an error with no data", async () => {
    const result = await client.callTool({
      name: "get_warehouse_tasks",
      arguments: { warehouse: "MUHW" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The call was stopped (invalid_input)");
    expect(textOf(result)).toContain("No data was returned");
    const unknownSystem = await client.callTool({
      name: "get_queue_status",
      arguments: { system: "PRD" },
    });
    expect(unknownSystem.isError).toBe(true);
    expect(textOf(unknownSystem)).toContain("Registered systems: S4D");
    const unknownTool = await client.callTool({ name: "delete_delivery", arguments: {} });
    expect(unknownTool.isError).toBe(true);
  });

  it("offers the investigation prompt in the standard solution format", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((x) => x.name)).toEqual(["investigate_ticket"]);
    const prompt = await client.getPrompt({
      name: "investigate_ticket",
      arguments: { ticket: "MCPT-2" },
    });
    const body = (prompt.messages[0]!.content as { text: string }).text;
    for (const heading of ["Root Cause", "Evidence", "Rollback Plan", "Test Plan", "Confidence"])
      expect(body).toContain(heading);
    expect(body).toContain("MCPT-2");
  });

  it("fails clearly with a token that is not valid", async () => {
    const bad = await connect("ewm_pat_" + "x".repeat(43));
    await expect(bad.listTools()).rejects.toThrow(/not valid/);
    await bad.close();
  });
});
