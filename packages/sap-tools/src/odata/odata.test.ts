import { describe, expect, it } from "vitest";
import { AdapterError } from "../adapter";
import { findTool, TOOLS, type ToolName } from "../contracts";
import { SapApiSandboxAdapter, assertSandboxUrl, sandboxHeaders } from "./adapter";
import { BINDINGS, SERVICES, SERVICE_USAGE } from "./bindings";
import { and, dateTime, equals, number, ODataClient, quote, status, text } from "./client";
import { createFakeSap, FAKE_API_KEY, FAKE_BASE_URL, type FakeSapOptions } from "./fake-sap";
import { checkConnection, parseMetadata } from "./probe";
import reference from "./reference/sap-api-metadata.json" with { type: "json" };

const signal = () => AbortSignal.timeout(5000);

function connect(options: FakeSapOptions = {}, apiKey = FAKE_API_KEY) {
  const sap = createFakeSap(options);
  const adapter = new SapApiSandboxAdapter({ baseUrl: FAKE_BASE_URL, headers: sandboxHeaders(apiKey), fetchImpl: sap.fetch });
  const run = async <T>(name: ToolName, input: object): Promise<T> => {
    const tool = findTool(name)!;
    return tool.output.parse(await adapter.execute(name, tool.input.parse(input), signal())) as T;
  };
  return { sap, adapter, run };
}

const DATA: FakeSapOptions["data"] = {
  WhseOutboundDeliveryOrderHead: [
    { OutboundDeliveryOrder: "80000123", Warehouse: "1750", DeliveryType: "OUTB", ShipToParty: "17100001", ShipToPartyName: "Domestic Customer 1", PlannedDeliveryUTCDateTime: "/Date(1759740000000+0000)/" },
    { OutboundDeliveryOrder: "80000124", Warehouse: "1750" },
  ],
  WhseOutboundDeliveryOrderItem: [
    { OutboundDeliveryOrder: "80000123", OutboundDeliveryOrderItem: "10", Product: "EWMS4-01", ProductQuantity: "5.000", QuantityUnit: "EA", WarehouseProcessType: "2010", GoodsIssueStatus: "1", PickingStatus: "9", PlannedPickingStatus: "9", OutboundDeliveryOrderItemType: "ODLV", SalesOrder: "4711" },
    { OutboundDeliveryOrder: "80000123", OutboundDeliveryOrderItem: "20", Product: "EWMS4-02", ProductQuantity: "1.000" },
    { OutboundDeliveryOrder: "80000124", OutboundDeliveryOrderItem: "10", Product: "EWMS4-03" },
  ],
  WhseInboundDeliveryHead: [{ InboundDelivery: "180000001", Warehouse: "1750", ShipFromParty: "17300001", ShipFromPartyName: "Supplier 1" }],
  WhseInboundDeliveryItem: [{ InboundDelivery: "180000001", InboundDeliveryItem: "10", Product: "EWMS4-01", ProductQuantity: "40.000", GoodsReceiptStatus: "9", PutawayStatus: "1", InboundDeliveryItemType: "IDLV", PurchasingDocument: "4500000001" }],
  WarehouseOrder: [{ Warehouse: "1750", WarehouseOrder: "2000001", WarehouseOrderStatus: "C", WarehouseOrderStatusName: "Confirmed", ExecutingResource: "RES1" }],
  WarehouseTask: [
    { Warehouse: "1750", WarehouseTask: "100000001", WarehouseTaskItem: "0", WarehouseOrder: "2000001", Delivery: "80000123", DeliveryItem: "10", WarehouseTaskStatus: "C", WarehouseTaskStatusName: "Confirmed", WarehouseProcessType: "2010", ProductName: "EWMS4-01", TargetQuantityInBaseUnit: "5.000", ActualQuantityInBaseUnit: "5.000", BaseUnit: "EA", SourceStorageType: "0020", SourceStorageBin: "0020-01-01-A", DestinationStorageBin: "GI-ZONE", SourceHandlingUnit: "112345678000000017" },
    { Warehouse: "1750", WarehouseTask: "100000002", WarehouseOrder: "2000002", Delivery: "80000999", DestinationHandlingUnit: "112345678000000017" },
    { Warehouse: "1710", WarehouseTask: "100000003", Delivery: "80000123" },
  ],
  HandlingUnit: [{ HandlingUnitExternalID: "112345678000000017", Warehouse: "1750", PackagingMaterial: "EWMS4-PAL00", StorageType: "0020", StorageBin: "0020-01-01-A", GrossWeight: "120.500", WeightUnit: "KG", HandlingUnitProcessStatus: "A" }],
  HandlingUnitItem: [{ HandlingUnitExternalID: "112345678000000017", Warehouse: "1750", StockItemUUID: "00000000-0000-0000-0000-00000000000a", Material: "EWMS4-01", HandlingUnitQuantity: "5.000", HandlingUnitQuantityUnit: "EA" }],
  WarehouseAvailableStock: [
    { EWMWarehouse: "1750", Product: "EWMS4-01", EWMStockType: "F2", EWMStorageType: "0020", EWMStorageBin: "0020-01-01-A", AvailableEWMStockQty: 95, EWMStockQuantityBaseUnit: "EA", EWMStockIsBlockedForInventory: false, GoodsReceiptUTCDateTime: "2026-09-01T10:00:00Z" },
    { EWMWarehouse: "1750", Product: "EWMS4-01", EWMStockType: "Q4", EWMStorageType: "0020", EWMStorageBin: "0020-01-02-A", AvailableEWMStockQty: 40, EWMStockQuantityBaseUnit: "EA" },
    { EWMWarehouse: "1750", Product: "EWMS4-02", EWMStockType: "F2", AvailableEWMStockQty: 7 },
  ],
  WarehouseStorageBin: [{ Warehouse: "1750", StorageBin: "0020-01-01-A", StorageType: "0020", StorageBinIsEmpty: false, StorageBinIsBlockedForRemoval: true, LoadCapacityOfStorageBin: "1000.000", WeightUnit: "KG" }],
};

describe("OData client helpers", () => {
  it("quotes filter values so a quote in a value cannot change the filter", () => {
    expect(quote("O'Brien")).toBe("'O''Brien'");
    expect(equals("Delivery", "1' or '1' eq '1")).toBe("Delivery eq '1'' or ''1'' eq ''1'");
    expect(and("A eq 'x'", undefined, false, "B eq 'y'")).toBe("A eq 'x' and B eq 'y'");
  });

  it("converts SAP value formats without guessing", () => {
    expect(dateTime("/Date(1759740000000+0000)/")).toBe("2025-10-06T08:40:00.000Z");
    expect(dateTime("2026-09-01T10:00:00Z")).toBe("2026-09-01T10:00:00.000Z");
    expect(dateTime("not a date")).toBeNull();
    expect(number("5.000")).toBe(5);
    expect(number("")).toBeNull();
    expect(text("  ")).toBeNull();
    expect(status("9")).toEqual({ code: "9", text: null }); // the code is passed on, not interpreted
    expect(status("", "")).toBeNull();
  });

  it("only allows SAP's sandbox host over https", () => {
    expect(assertSandboxUrl("https://sandbox.api.sap.com/s4hanacloud").hostname).toBe("sandbox.api.sap.com");
    for (const bad of ["http://sandbox.api.sap.com/x", "https://evil.example/s4hanacloud", "https://sandbox.api.sap.com.evil.example", "https://localhost:4000", "not a url"]) {
      expect(() => assertSandboxUrl(bad), bad).toThrow();
    }
  });
});

describe("bindings follow SAP's published definitions", () => {
  it("only use services, entity sets and properties that exist in the reference", () => {
    const services = reference as unknown as Record<string, { servicePath: string; odataVersion: string; entities: Record<string, { fields: Array<{ name: string }> }> }>;
    for (const [key, service] of Object.entries(SERVICES)) {
      const published = services[service.id];
      expect(published, service.id).toBeDefined();
      expect(published!.servicePath).toBe(service.path);
      expect(published!.odataVersion).toBe(service.version);
      for (const [entitySet, properties] of Object.entries(SERVICE_USAGE[key as keyof typeof SERVICES].entitySets)) {
        const names = published!.entities[entitySet]?.fields.map((f) => f.name);
        expect(names, `${service.id}.${entitySet}`).toBeDefined();
        for (const property of properties) expect(names, `${entitySet}.${property}`).toContain(property);
      }
    }
  });

  it("has a binding or a stated reason for every tool", () => {
    const { adapter } = connect();
    for (const tool of TOOLS) {
      const reason = adapter.unsupportedReason(tool.name);
      if (tool.name in BINDINGS) expect(reason, tool.name).toBeNull();
      else expect(reason, tool.name).toMatch(/SAP has not released an API/);
    }
  });
});

describe("SAP API sandbox adapter", () => {
  it("sends only GET requests with the API key header", async () => {
    const { sap, run } = connect({ data: DATA });
    await run("get_delivery", { direction: "outbound", delivery: "80000123" });
    await run("get_stock", { warehouse: "1750", product: "EWMS4-01" });
    expect(sap.requests.length).toBeGreaterThan(0);
    for (const request of sap.requests) {
      expect(request.method).toBe("GET");
      expect(request.headers.apikey).toBe(FAKE_API_KEY);
      expect(request.url.startsWith(FAKE_BASE_URL)).toBe(true);
    }
  });

  it("reads an outbound delivery order with its items and passes status codes through unchanged", async () => {
    const { run } = connect({ data: DATA });
    const result = await run<{ found: boolean; delivery: any }>("get_delivery", { direction: "outbound", delivery: "80000123" });
    expect(result.found).toBe(true);
    expect(result.delivery).toMatchObject({
      number: "80000123",
      warehouse: "1750",
      deliveryType: "OUTB",
      partner: { role: "ship_to", id: "17100001", name: "Domestic Customer 1" },
      plannedDeliveryAt: "2025-10-06T08:40:00.000Z",
    });
    expect(result.delivery.items).toHaveLength(2);
    expect(result.delivery.items[0]).toMatchObject({
      item: "10",
      itemType: "ODLV",
      product: "EWMS4-01",
      quantity: 5,
      unit: "EA",
      warehouseProcessType: "2010",
      statuses: { goodsMovement: { code: "1", text: null }, execution: { code: "9", text: null } },
      reference: { salesOrder: "4711" },
    });
    // The original SAP fields travel along untouched.
    expect(result.delivery.items[0].sapFields.GoodsIssueStatus).toBe("1");
    expect(result.delivery.sapFields.__metadata).toBeUndefined();
  });

  it("reads an inbound delivery through the inbound service", async () => {
    const { sap, run } = connect({ data: DATA });
    const result = await run<{ delivery: any }>("get_delivery", { direction: "inbound", delivery: "180000001" });
    expect(result.delivery).toMatchObject({ direction: "inbound", partner: { role: "ship_from", id: "17300001" } });
    expect(result.delivery.items[0]).toMatchObject({ itemType: "IDLV", statuses: { goodsMovement: { code: "9" }, execution: { code: "1" } }, reference: { purchasingDocument: "4500000001" } });
    expect(sap.requests.every((r) => r.url.includes("API_WHSE_INBOUND_DELIVERY"))).toBe(true);
  });

  it("says 'not found' when SAP has no such document", async () => {
    const { run } = connect({ data: DATA });
    expect(await run("get_delivery", { direction: "outbound", delivery: "1" })).toEqual({ found: false, delivery: null });
    expect(await run("get_handling_unit", { warehouse: "1750", handlingUnit: "1" })).toEqual({ found: false, handlingUnit: null });
    expect(await run("get_storage_bin", { warehouse: "1750", storageBin: "X" })).toEqual({ found: false, storageBin: null });
  });

  it("filters warehouse tasks by warehouse and by delivery, order or handling unit", async () => {
    const { run } = connect({ data: DATA });
    const byDelivery = await run<{ tasks: any[] }>("get_warehouse_tasks", { warehouse: "1750", delivery: "80000123" });
    expect(byDelivery.tasks.map((t) => t.warehouseTask)).toEqual(["100000001"]); // not the task of warehouse 1710
    expect(byDelivery.tasks[0]).toMatchObject({
      status: { code: "C", text: "Confirmed" },
      processType: { code: "2010" },
      product: "EWMS4-01",
      quantity: { target: 5, actual: 5, unit: "EA" },
      source: { storageType: "0020", storageBin: "0020-01-01-A", handlingUnit: "112345678000000017" },
      destination: { storageBin: "GI-ZONE" },
    });
    const byHu = await run<{ tasks: any[] }>("get_warehouse_tasks", { warehouse: "1750", handlingUnit: "112345678000000017" });
    expect(byHu.tasks.map((t) => t.warehouseTask).sort()).toEqual(["100000001", "100000002"]);
    const limited = await run<{ count: number; truncated: boolean }>("get_warehouse_tasks", { warehouse: "1750", handlingUnit: "112345678000000017", limit: 1 });
    expect(limited).toMatchObject({ count: 1, truncated: true });
  });

  it("reads a warehouse order with its tasks, and leaves fields SAP does not expose as null", async () => {
    const { run } = connect({ data: DATA });
    const result = await run<{ warehouseOrder: any }>("get_warehouse_order", { warehouse: "1750", warehouseOrder: "2000001" });
    expect(result.warehouseOrder).toMatchObject({ status: { code: "C", text: "Confirmed" }, executingResource: "RES1", creationRule: null, queue: null });
    expect(result.warehouseOrder.tasks.map((t: any) => t.warehouseTask)).toEqual(["100000001"]);
  });

  it("reads a handling unit with contents and a storage bin with its blocks", async () => {
    const { run } = connect({ data: DATA });
    const hu = await run<{ handlingUnit: any }>("get_handling_unit", { warehouse: "1750", handlingUnit: "112345678000000017" });
    expect(hu.handlingUnit).toMatchObject({ packagingMaterial: "EWMS4-PAL00", grossWeight: 120.5, location: { storageBin: "0020-01-01-A" }, status: { code: "A" } });
    expect(hu.handlingUnit.items).toEqual([expect.objectContaining({ product: "EWMS4-01", quantity: 5, unit: "EA" })]);
    const bin = await run<{ storageBin: any }>("get_storage_bin", { warehouse: "1750", storageBin: "0020-01-01-A" });
    expect(bin.storageBin).toMatchObject({ storageType: "0020", isEmpty: false, blockedForRemoval: true, capacity: { maxWeight: 1000, weightUnit: "KG" } });
  });

  it("reports stock as available quantity only, by stock type", async () => {
    const { run } = connect({ data: DATA });
    const stock = await run<{ basis: string; rows: any[] }>("get_stock", { warehouse: "1750", product: "EWMS4-01" });
    expect(stock.basis).toBe("available_only");
    expect(stock.rows.map((r) => [r.stockType, r.availableQuantity, r.physicalQuantity])).toEqual([["F2", 95, null], ["Q4", 40, null]]);
    const narrowed = await run<{ rows: any[] }>("get_stock", { warehouse: "1750", product: "EWMS4-01", storageBin: "0020-01-02-A" });
    expect(narrowed.rows.map((r) => r.stockType)).toEqual(["Q4"]);
  });

  it("turns SAP's refusals and failures into clear errors, with no data", async () => {
    const wrongKey = connect({ data: DATA }, "wrong-key");
    await expect(wrongKey.run("get_stock", { warehouse: "1750", product: "X" })).rejects.toMatchObject({ code: "authentication_failed", transient: false });

    const removed = connect({ data: DATA, removedServices: ["api_whse_availablestock"] });
    await expect(removed.run("get_stock", { warehouse: "1750", product: "X" })).rejects.toMatchObject({ code: "service_unavailable" });

    const busy = connect({ failWith: 503 });
    await expect(busy.run("get_stock", { warehouse: "1750", product: "X" })).rejects.toMatchObject({ code: "sap_error", transient: true });

    const changed = connect({ data: DATA, removedProperties: { WarehouseTask: ["Delivery"] } });
    const error = await changed.run("get_warehouse_tasks", { warehouse: "1750", delivery: "80000123" }).catch((e) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error.message).toContain("Property Delivery is not defined");

    const offline = new ODataClient({ baseUrl: FAKE_BASE_URL, headers: {}, fetchImpl: (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch });
    await expect(offline.read(SERVICES.storageBin, "WarehouseStorageBin", {}, signal())).rejects.toMatchObject({ code: "network", transient: true });
  });

  it("refuses tools SAP has released no API for, and says what would be needed", async () => {
    const { adapter } = connect();
    for (const name of ["get_queue_status", "get_application_log", "get_ppf_actions", "get_abap_dump", "get_configuration"]) {
      expect(adapter.unsupportedReason(name)).toMatch(/EWM Agent Connector/);
      await expect(adapter.execute(name, {}, signal())).rejects.toMatchObject({ code: "not_supported" });
    }
    expect(await adapter.identify()).toBeNull();
  });
});

describe("connection test", () => {
  it("parses entity sets and properties from $metadata", () => {
    const xml = `<Schema Namespace="X"><EntityType Name="AType"><Key/><Property Name="P1" Type="Edm.String"/><Property Name="P2" Nullable="false" Type="Edm.String"/></EntityType><EntityContainer><EntitySet Name="A" EntityType="X.AType"/></EntityContainer></Schema>`;
    expect(parseMetadata(xml)).toEqual({ A: ["P1", "P2"] });
  });

  it("confirms every service and gives real example values to try", async () => {
    const { adapter } = connect({ data: DATA });
    const check = await checkConnection(adapter.client);
    expect(check.reachable).toBe(true);
    const used = check.services.filter((s) => s.usedByTools.length > 0);
    expect(used.map((s) => s.state)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(used.find((s) => s.id === "API_WAREHOUSE_ORDER_TASK")!.example).toMatchObject({ Warehouse: "1750", WarehouseTask: "100000001", Delivery: "80000123" });
    expect(check.tools.filter((t) => t.available).map((t) => t.name)).toEqual(["get_delivery", "get_warehouse_tasks", "get_warehouse_order", "get_handling_unit", "get_stock", "get_storage_bin"]);
    expect(check.summary).toContain("6 of 6 SAP services");
    // The unconfirmed successor service is reported as missing, and no tool depends on it.
    expect(check.services.find((s) => s.id === "api_warehouse_order_task_2")).toMatchObject({ state: "not_found", usedByTools: [] });
  });

  it("reports a wrong key, a removed service and a changed service, each for what it is", async () => {
    const refused = await checkConnection(connect({ data: DATA }, "wrong").adapter.client);
    expect(refused.reachable).toBe(false);
    expect(refused.summary).toContain("refused the API key");

    const partial = await checkConnection(
      connect({ data: DATA, removedServices: ["API_HANDLING_UNIT"], removedProperties: { WarehouseTask: ["Delivery"] } }).adapter.client,
    );
    const byId = Object.fromEntries(partial.services.map((s) => [s.id, s]));
    expect(byId.API_HANDLING_UNIT!.state).toBe("not_found");
    expect(byId.API_WAREHOUSE_ORDER_TASK!.state).toBe("changed");
    expect(byId.API_WAREHOUSE_ORDER_TASK!.entitySets.find((e) => e.name === "WarehouseTask")!.missingProperties).toEqual(["Delivery"]);
    const available = partial.tools.filter((t) => t.available).map((t) => t.name);
    expect(available).not.toContain("get_handling_unit");
    expect(available).not.toContain("get_warehouse_tasks");
    expect(available).toContain("get_stock");

    const empty = await checkConnection(connect({ data: {} }).adapter.client);
    expect(empty.services[0]).toMatchObject({ state: "ok", example: null, detail: "The service answered but holds no data." });
  });

  it("records what an unconfirmed successor service exposes, without using it", async () => {
    const { adapter } = connect({
      data: DATA,
      extraServices: { "/sap/opu/odata4/sap/api_warehouse_order_task_2/srvd_a2x/sap/warehouseorder/0001": { WarehouseTask: ["EWMWarehouse", "WarehouseTask"] } },
    });
    const check = await checkConnection(adapter.client);
    expect(check.services.find((s) => s.id === "api_warehouse_order_task_2")).toMatchObject({
      state: "ok",
      usedByTools: [],
      exposes: { WarehouseTask: ["EWMWarehouse", "WarehouseTask"] },
    });
  });
});
