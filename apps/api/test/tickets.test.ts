import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectWithTeam, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let team: Awaited<ReturnType<typeof createProjectWithTeam>>;
let p: string;

beforeAll(async () => {
  ctx = await createTestContext();
  team = await createProjectWithTeam(ctx, "MUHW");
  p = `/projects/${team.project.id}`;
});
afterAll(() => ctx.close());

describe("Milestone 1 exit test", () => {
  it("creates the ticket from master prompt section 31 against a simulated system and shows its timeline", async () => {
    const system = await team.admin.post(`${p}/sap-systems`, {
      name: "Simulated S/4HANA embedded EWM",
      sid: "sim",
      client: "100",
      environment: "DEV",
    });
    expect(system.statusCode).toBe(201);
    expect(system.json().sapSystem).toMatchObject({
      sid: "SIM",
      adapter: "simulated",
      deployment: "embedded",
    });

    const created = await team.analyst.post(`${p}/tickets`, {
      title: "Warehouse task is not being created for delivery XXXXX in warehouse MUHW.",
      description: "Outbound delivery order stays without warehouse tasks after wave release.",
      priority: "high",
      process: "outbound",
      warehouse: "muhw",
      sapSystemId: system.json().sapSystem.id,
    });
    expect(created.statusCode).toBe(201);
    const ticket = created.json().ticket;
    expect(ticket).toMatchObject({
      reference: "MUHW-1",
      status: "open",
      warehouse: "MUHW",
      process: "outbound",
    });

    await team.analyst.post(`${p}/tickets/${ticket.id}/comments`, {
      body: "Happens for every item of the delivery.",
    });
    await team.consultant.post(`${p}/tickets/${ticket.id}/status`, {
      status: "investigating",
      note: "Taking this one.",
    });

    const detail = (await team.analyst.get(`${p}/tickets/${ticket.id}`)).json().ticket;
    expect(detail).toMatchObject({
      reference: "MUHW-1",
      status: "investigating",
      sapSystemSid: "SIM",
      sapSystemAdapter: "simulated",
      sapSystemEnvironment: "DEV",
      reportedByName: "The analyst",
    });
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual([
      "created",
      "comment",
      "status_changed",
    ]);
    expect(detail.events[2]).toMatchObject({
      actorName: "The consultant",
      data: { from: "open", to: "investigating" },
    });

    const listed = (await team.analyst.get(`${p}/tickets`)).json().tickets;
    expect(listed.map((t: { id: string }) => t.id)).toContain(ticket.id);

    const summary = (await team.analyst.get(`${p}/summary`)).json();
    expect(summary.ticketsByStatus.investigating).toBe(1);
    expect(summary.sapSystems).toBe(1);
  });
});

describe("tickets", () => {
  it("numbers tickets per project without gaps, also when created at the same moment", async () => {
    const other = await createProjectWithTeam(ctx, "NUMS");
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        other.analyst.post(`/projects/${other.project.id}/tickets`, { title: `Ticket ${i}` }),
      ),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = results.map((r) => r.json().ticket.number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("rejects invalid input with the field that is wrong", async () => {
    const noTitle = await team.analyst.post(`${p}/tickets`, { title: "   " });
    expect(noTitle.statusCode).toBe(400);
    expect(noTitle.json().error.details[0].field).toBe("title");

    const badWarehouse = await team.analyst.post(`${p}/tickets`, {
      title: "x",
      warehouse: "TOO-LONG",
    });
    expect(badWarehouse.statusCode).toBe(400);
    expect(badWarehouse.json().error.details[0].field).toBe("warehouse");

    const badStatus = await team.consultant.post(
      `${p}/tickets/${"00000000-0000-4000-8000-000000000000"}/status`,
      {
        status: "deleted",
      },
    );
    expect(badStatus.statusCode).toBe(400);
  });

  it("filters the list by status", async () => {
    const t = (await team.analyst.post(`${p}/tickets`, { title: "To be closed" })).json().ticket;
    await team.consultant.post(`${p}/tickets/${t.id}/status`, { status: "closed" });
    const closed = (await team.analyst.get(`${p}/tickets?status=closed`)).json().tickets;
    expect(closed.map((x: { id: string }) => x.id)).toEqual([t.id]);
    const detail = (await team.analyst.get(`${p}/tickets/${t.id}`)).json().ticket;
    expect(detail.closedAt).not.toBeNull();
  });

  it("refuses to set the status a ticket already has", async () => {
    const t = (await team.analyst.post(`${p}/tickets`, { title: "Same status" })).json().ticket;
    const res = await team.consultant.post(`${p}/tickets/${t.id}/status`, { status: "open" });
    expect(res.statusCode).toBe(400);
  });
});

describe("SAP system records", () => {
  it("refuses to register a real SAP connection before the connector exists", async () => {
    const res = await team.admin.post(`${p}/sap-systems`, {
      name: "Client production",
      sid: "PRD",
      client: "100",
      environment: "PROD",
      adapter: "sap",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("Customer SAP systems cannot be connected yet");
    const listed = (await team.admin.get(`${p}/sap-systems`)).json().sapSystems;
    expect(listed.every((s: { adapter: string }) => s.adapter === "simulated")).toBe(true);
  });

  it("refuses the same system ID and client twice in one project", async () => {
    const body = { name: "QA", sid: "S4Q", client: "200", environment: "QAS" };
    expect((await team.admin.post(`${p}/sap-systems`, body)).statusCode).toBe(201);
    expect((await team.admin.post(`${p}/sap-systems`, body)).statusCode).toBe(409);
  });

  it("gives every new project the three environments, with production the strictest", async () => {
    const detail = (await team.admin.get(p)).json();
    expect(detail.environments.map((e: { kind: string }) => e.kind)).toEqual([
      "DEV",
      "QAS",
      "PROD",
    ]);
    const prod = detail.environments.find((e: { kind: string }) => e.kind === "PROD");
    expect(prod).toMatchObject({ requiresChangeReference: true, maxAutoToolLevel: 0 });
  });
});
