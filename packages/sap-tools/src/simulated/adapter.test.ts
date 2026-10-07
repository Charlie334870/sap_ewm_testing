import { describe, expect, it } from "vitest";
import { findTool, TOOLS, type ToolName } from "../contracts";
import { SimulatedSapAdapter } from "./adapter";
import { SCENARIO_PACKS } from "./packs";

const adapter = new SimulatedSapAdapter({ id: "sys", sid: "S4D", client: "100", baseUrl: null });
const signal = new AbortController().signal;

async function run<T = Record<string, never>>(name: ToolName, input: object): Promise<T> {
  const tool = findTool(name)!;
  const raw = await adapter.execute(name, tool.input.parse(input), signal);
  return tool.output.parse(raw) as T; // every answer must satisfy the tool's own contract
}

describe("simulated SAP adapter", () => {
  it("answers every tool in the shape its contract promises", async () => {
    const inputs: Record<ToolName, object> = {
      get_delivery: { direction: "outbound", delivery: "80000990" },
      get_warehouse_tasks: { warehouse: "MUHW", delivery: "80000990" },
      get_warehouse_order: { warehouse: "MUHW", warehouseOrder: "2000990" },
      get_handling_unit: { warehouse: "MUHW", handlingUnit: "1" },
      get_stock: { warehouse: "MUHW", product: "P-2000" },
      get_storage_bin: { warehouse: "MUHW", storageBin: "0020-02-05-B" },
      get_queue_status: {},
      get_application_log: { externalId: "80000990" },
      get_ppf_actions: { document: "80000990" },
      get_abap_dump: {},
      get_configuration: { area: "wpt_determination", warehouse: "MUHW" },
    };
    for (const tool of TOOLS) {
      expect(adapter.unsupportedReason(tool.name), tool.name).toBeNull();
      await run(tool.name, inputs[tool.name]);
    }
  });

  it("identifies itself as the system it was registered as", async () => {
    expect(await adapter.identify()).toEqual({ sid: "S4D", client: "100" });
  });

  it("returns 'not found' for documents that do not exist, never an invented one", async () => {
    expect(await run("get_delivery", { direction: "outbound", delivery: "99999999" })).toEqual({ found: false, delivery: null });
    expect(await run("get_delivery", { direction: "inbound", delivery: "80000990" })).toEqual({ found: false, delivery: null });
    expect(await run("get_warehouse_order", { warehouse: "MUHW", warehouseOrder: "1" })).toMatchObject({ found: false });
    expect(await run("get_warehouse_tasks", { warehouse: "MUHW", delivery: "99999999" })).toMatchObject({ count: 0, tasks: [] });
  });

  it("keeps warehouses apart", async () => {
    expect(await run("get_stock", { warehouse: "OTHR", product: "P-2000" })).toMatchObject({ count: 0 });
    expect(await run("get_warehouse_tasks", { warehouse: "OTHR", delivery: "80000990" })).toMatchObject({ count: 0 });
    expect(await run("get_configuration", { area: "stock_types", warehouse: "OTHR" })).toMatchObject({ count: 0 });
  });

  it("filters logs by severity and time, and queues by failure", async () => {
    const errors = await run<{ messages: Array<{ severity: string }> }>("get_application_log", { externalId: "80001001", severity: "error" });
    expect(errors.messages.map((m) => m.severity)).toEqual(["error"]);
    const early = await run<{ count: number }>("get_application_log", { externalId: "180000450", to: "2026-10-04T09:10:00Z" });
    expect(early.count).toBe(2);
    const failed = await run<{ queues: Array<{ status: string }> }>("get_queue_status", { onlyFailed: true });
    expect(failed.queues.map((q) => q.status)).toEqual(["SYSFAIL"]);
  });

  it("applies the limit and says when rows were cut off", async () => {
    const result = await run<{ count: number; truncated: boolean }>("get_configuration", { area: "stock_types", warehouse: "MUHW" });
    expect(result.count).toBe(6);
    const limited = await run<{ count: number; truncated: boolean }>("get_application_log", { externalId: "180000450", limit: 1 });
    expect(limited).toMatchObject({ count: 1, truncated: true });
  });

  it("hands out copies, so a caller cannot alter the scenario", async () => {
    const first = await run<{ delivery: { items: Array<{ quantity: number }> } }>("get_delivery", { direction: "outbound", delivery: "80001001" });
    first.delivery.items[0]!.quantity = 999;
    const second = await run<{ delivery: { items: Array<{ quantity: number }> } }>("get_delivery", { direction: "outbound", delivery: "80001001" });
    expect(second.delivery.items[0]!.quantity).toBe(10);
  });

  it("never states a root cause or an SAP message number in scenario data", () => {
    const text = JSON.stringify(SCENARIO_PACKS).toLowerCase();
    for (const word of ["root cause", "rootcause", "answer", "the fix", "solution"]) expect(text).not.toContain(word);
    const logs = SCENARIO_PACKS.flatMap((p) => p.data.logs ?? []);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((m) => m.messageId === null)).toBe(true);
  });
});
