/**
 * How each tool reads from SAP's released OData APIs for warehouse management.
 *
 * Source of every service path, entity set and property name in this file: SAP's own published
 * API clients (npm packages @sap/cloud-sdk-vdm-*-service, version 2.1.0), extracted into
 * reference/sap-api-metadata.json. Nothing here was written from memory.
 *
 * These definitions date from 2022. SAP may since have changed or replaced a service; the
 * connection test (probe.ts) compares them with what the connected system reports about itself.
 */
import { AdapterError } from "../adapter";
import type { ToolInput, ToolName, ToolOutput } from "../contracts";
import {
  and,
  dateTime,
  equals,
  flag,
  number,
  scalars,
  status,
  text,
  type ODataClient,
  type ODataRow,
  type ODataService,
} from "./client";

export const SERVICES = {
  outboundDeliveryOrder: {
    id: "API_WHSE_OUTB_DLV_ORDER",
    title: "Warehouse Outbound Delivery Order",
    path: "/sap/opu/odata/sap/API_WHSE_OUTB_DLV_ORDER",
    version: "v2",
  },
  inboundDelivery: {
    id: "API_WHSE_INBOUND_DELIVERY",
    title: "Warehouse Inbound Delivery",
    path: "/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY",
    version: "v2",
  },
  orderTask: {
    id: "API_WAREHOUSE_ORDER_TASK",
    title: "Warehouse Order and Task",
    path: "/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK",
    version: "v2",
  },
  handlingUnit: {
    id: "API_HANDLING_UNIT",
    title: "Handling Unit",
    path: "/sap/opu/odata/sap/API_HANDLING_UNIT",
    version: "v2",
  },
  availableStock: {
    id: "api_whse_availablestock",
    title: "Warehouse Available Stock",
    path: "/sap/opu/odata4/sap/api_whse_availablestock/srvd_a2x/sap/warehouseavailablestock/0001",
    version: "v4",
  },
  storageBin: {
    id: "API_WAREHOUSE_STORAGE_BIN",
    title: "Warehouse Storage Bin",
    path: "/sap/opu/odata/sap/API_WAREHOUSE_STORAGE_BIN",
    version: "v2",
  },
} as const satisfies Record<string, ODataService>;

export type ServiceKey = keyof typeof SERVICES;

/**
 * What each binding needs from a service: the entity sets it reads and the properties it filters
 * on. The connection test checks these against the system's $metadata.
 */
export const SERVICE_USAGE: Record<ServiceKey, { tools: ToolName[]; entitySets: Record<string, string[]> }> = {
  outboundDeliveryOrder: {
    tools: ["get_delivery"],
    entitySets: { WhseOutboundDeliveryOrderHead: ["OutboundDeliveryOrder"], WhseOutboundDeliveryOrderItem: ["OutboundDeliveryOrder"] },
  },
  inboundDelivery: {
    tools: ["get_delivery"],
    entitySets: { WhseInboundDeliveryHead: ["InboundDelivery"], WhseInboundDeliveryItem: ["InboundDelivery"] },
  },
  orderTask: {
    tools: ["get_warehouse_tasks", "get_warehouse_order"],
    entitySets: {
      WarehouseTask: ["Warehouse", "WarehouseTask", "WarehouseOrder", "Delivery", "SourceHandlingUnit", "DestinationHandlingUnit"],
      WarehouseOrder: ["Warehouse", "WarehouseOrder"],
    },
  },
  handlingUnit: { tools: ["get_handling_unit"], entitySets: { HandlingUnit: ["HandlingUnitExternalID", "Warehouse"] } },
  availableStock: {
    tools: ["get_stock"],
    entitySets: { WarehouseAvailableStock: ["EWMWarehouse", "Product", "EWMStorageType", "EWMStorageBin", "Batch"] },
  },
  storageBin: { tools: ["get_storage_bin"], entitySets: { WarehouseStorageBin: ["Warehouse", "StorageBin"] } },
};

type Binding<N extends ToolName> = (client: ODataClient, input: ToolInput<N>, signal: AbortSignal) => Promise<ToolOutput<N>>;

const rowsOf = (value: unknown): ODataRow[] => (Array.isArray(value) ? (value as ODataRow[]) : []);

// ------------------------------------------------------------------ get_delivery

const getDelivery: Binding<"get_delivery"> = async (client, input, signal) => {
  const outbound = input.direction === "outbound";
  const service = outbound ? SERVICES.outboundDeliveryOrder : SERVICES.inboundDelivery;
  const key = outbound ? "OutboundDeliveryOrder" : "InboundDelivery";
  const headSet = outbound ? "WhseOutboundDeliveryOrderHead" : "WhseInboundDeliveryHead";
  const itemSet = outbound ? "WhseOutboundDeliveryOrderItem" : "WhseInboundDeliveryItem";
  const itemNav = `to_${itemSet}`;

  const [head] = await client.read(service, headSet, { filter: equals(key, input.delivery), expand: [itemNav], top: 1 }, signal);
  if (!head) return { found: false, delivery: null };

  // If the service ignored $expand, read the items on their own.
  const items = Array.isArray(head[itemNav])
    ? rowsOf(head[itemNav])
    : await client.read(service, itemSet, { filter: equals(key, input.delivery), top: 200 }, signal);

  return {
    found: true,
    delivery: {
      direction: input.direction,
      number: text(head[key]) ?? input.delivery,
      warehouse: text(head.Warehouse),
      deliveryType: text(head.DeliveryType),
      partner: outbound
        ? { role: "ship_to", id: text(head.ShipToParty), name: text(head.ShipToPartyName) }
        : { role: "ship_from", id: text(head.ShipFromParty), name: text(head.ShipFromPartyName) },
      plannedDeliveryAt: dateTime(head.PlannedDeliveryUTCDateTime),
      lastChangedAt: dateTime(head.LastChangeDateTime),
      items: items.map((item) => ({
        item: text(item[`${key}Item`]) ?? "",
        itemType: text(outbound ? item.OutboundDeliveryOrderItemType : item.InboundDeliveryItemType),
        itemCategory: text(outbound ? item.OutbDeliveryOrderItemCategory : item.DeliveryItemCategory),
        product: text(item.Product),
        batch: text(item.ProductBatch),
        quantity: number(item.ProductQuantity),
        unit: text(item.QuantityUnit),
        warehouseProcessType: text(item.WarehouseProcessType),
        statuses: {
          goodsMovement: status(outbound ? item.GoodsIssueStatus : item.GoodsReceiptStatus),
          planning: status(outbound ? item.PlannedPickingStatus : item.PlanningPutawayStatus),
          execution: status(outbound ? item.PickingStatus : item.PutawayStatus),
          completion: status(item.CompletionStatus),
        },
        stagingArea: text(item.StagingArea),
        goodsMovementBin: text(item.GoodsMovementBin),
        reference: {
          salesOrder: text(item.SalesOrder),
          purchasingDocument: text(item.PurchasingDocument),
          manufacturingOrder: text(item.ManufacturingOrder),
        },
        sapFields: scalars(item),
      })),
      sapFields: scalars(head),
    },
  };
};

// ------------------------------------------------------------------ warehouse tasks and orders

function mapTask(row: ODataRow): ToolOutput<"get_warehouse_tasks">["tasks"][number] {
  return {
    warehouseTask: text(row.WarehouseTask) ?? "",
    item: text(row.WarehouseTaskItem),
    warehouseOrder: text(row.WarehouseOrder),
    status: status(row.WarehouseTaskStatus, row.WarehouseTaskStatusName),
    processType: { code: text(row.WarehouseProcessType), name: text(row.WarehouseProcessTypeName) },
    product: text(row.ProductName),
    batch: text(row.Batch),
    stockType: text(row.StockType),
    quantity: {
      target: number(row.TargetQuantityInBaseUnit),
      actual: number(row.ActualQuantityInBaseUnit),
      difference: number(row.DifferenceQuantityInBaseUnit),
      unit: text(row.BaseUnit),
    },
    source: {
      storageType: text(row.SourceStorageType),
      storageSection: text(row.SourceStorageSection),
      storageBin: text(row.SourceStorageBin),
      handlingUnit: text(row.SourceHandlingUnit),
    },
    destination: {
      storageType: text(row.DestinationStorageType),
      storageSection: text(row.DestinationStorageSection),
      storageBin: text(row.DestinationStorageBin),
      handlingUnit: text(row.DestinationHandlingUnit),
    },
    delivery: text(row.Delivery),
    deliveryItem: text(row.DeliveryItem),
    activityArea: text(row.ActivityArea),
    exceptionCode: text(row.WarehouseTaskExceptionCode),
    executingResource: text(row.ExecutingResource),
    createdAt: dateTime(row.CreationDateTime),
    confirmedAt: dateTime(row.ConfirmationUTCDateTime),
    sapFields: scalars(row),
  };
}

const getWarehouseTasks: Binding<"get_warehouse_tasks"> = async (client, input, signal) => {
  const filter = and(
    equals("Warehouse", input.warehouse),
    input.delivery && equals("Delivery", input.delivery),
    input.warehouseTask && equals("WarehouseTask", input.warehouseTask),
    input.warehouseOrder && equals("WarehouseOrder", input.warehouseOrder),
    input.handlingUnit &&
      `(${equals("SourceHandlingUnit", input.handlingUnit)} or ${equals("DestinationHandlingUnit", input.handlingUnit)})`,
  );
  const rows = await client.read(SERVICES.orderTask, "WarehouseTask", { filter, top: input.limit + 1 }, signal);
  const tasks = rows.slice(0, input.limit).map(mapTask);
  return { count: tasks.length, truncated: rows.length > input.limit, tasks };
};

const getWarehouseOrder: Binding<"get_warehouse_order"> = async (client, input, signal) => {
  const filter = and(equals("Warehouse", input.warehouse), equals("WarehouseOrder", input.warehouseOrder));
  const [order] = await client.read(SERVICES.orderTask, "WarehouseOrder", { filter, expand: ["to_WarehouseTask"], top: 1 }, signal);
  if (!order) return { found: false, warehouseOrder: null };
  const tasks = Array.isArray(order.to_WarehouseTask)
    ? rowsOf(order.to_WarehouseTask)
    : await client.read(SERVICES.orderTask, "WarehouseTask", { filter, top: 200 }, signal);
  return {
    found: true,
    warehouseOrder: {
      warehouseOrder: text(order.WarehouseOrder) ?? input.warehouseOrder,
      warehouse: text(order.Warehouse),
      status: status(order.WarehouseOrderStatus, order.WarehouseOrderStatusName),
      creationRule: null,
      queue: null,
      executingResource: text(order.ExecutingResource),
      createdAt: dateTime(order.CreationDateTime),
      startedAt: dateTime(order.WarehouseOrderStartDateTime),
      confirmedAt: dateTime(order.WhseOrderConfirmedDateTime),
      latestStartAt: dateTime(order.WhseOrderLatestStartDateTime),
      tasks: tasks.map(mapTask),
      sapFields: scalars(order),
    },
  };
};

// ------------------------------------------------------------------ handling unit, stock, bin

const getHandlingUnit: Binding<"get_handling_unit"> = async (client, input, signal) => {
  const filter = and(equals("HandlingUnitExternalID", input.handlingUnit), equals("Warehouse", input.warehouse));
  const [hu] = await client.read(SERVICES.handlingUnit, "HandlingUnit", { filter, expand: ["to_HandlingUnitItem"], top: 1 }, signal);
  if (!hu) return { found: false, handlingUnit: null };
  return {
    found: true,
    handlingUnit: {
      handlingUnit: text(hu.HandlingUnitExternalID) ?? input.handlingUnit,
      warehouse: text(hu.Warehouse),
      packagingMaterial: text(hu.PackagingMaterial),
      status: status(hu.HandlingUnitProcessStatus),
      parentHandlingUnit: text(hu.ParentHandlingUnitNumber),
      location: {
        storageType: text(hu.StorageType),
        storageSection: text(hu.StorageSection),
        storageBin: text(hu.StorageBin),
      },
      referenceDocument: text(hu.HandlingUnitReferenceDocument),
      grossWeight: number(hu.GrossWeight),
      weightUnit: text(hu.WeightUnit),
      items: rowsOf(hu.to_HandlingUnitItem).map((item) => ({
        item: text(item.HandlingUnitItem),
        product: text(item.Material),
        quantity: number(item.HandlingUnitQuantity),
        unit: text(item.HandlingUnitQuantityUnit),
        referenceDocument: text(item.HandlingUnitReferenceDocument),
        referenceItem: text(item.HandlingUnitRefDocumentItem),
        sapFields: scalars(item),
      })),
      sapFields: scalars(hu),
    },
  };
};

const getStock: Binding<"get_stock"> = async (client, input, signal) => {
  const filter = and(
    equals("EWMWarehouse", input.warehouse),
    equals("Product", input.product),
    input.storageType && equals("EWMStorageType", input.storageType),
    input.storageBin && equals("EWMStorageBin", input.storageBin),
    input.batch && equals("Batch", input.batch),
  );
  const rows = await client.read(SERVICES.availableStock, "WarehouseAvailableStock", { filter, top: input.limit + 1 }, signal);
  const mapped = rows.slice(0, input.limit).map((row) => ({
    product: text(row.Product) ?? input.product,
    batch: text(row.Batch),
    stockType: text(row.EWMStockType),
    stockTypeText: null,
    storageType: text(row.EWMStorageType),
    storageBin: text(row.EWMStorageBin),
    handlingUnit: text(row.HandlingUnitExternalID),
    // This SAP service reports available stock only.
    physicalQuantity: null,
    availableQuantity: number(row.AvailableEWMStockQty),
    unit: text(row.EWMStockQuantityBaseUnit),
    owner: text(row.EWMStockOwner),
    blockedForInventory: flag(row.EWMStockIsBlockedForInventory),
    goodsReceiptAt: dateTime(row.GoodsReceiptUTCDateTime),
    shelfLifeExpiration: text(row.ShelfLifeExpirationDate),
    sapFields: scalars(row),
  }));
  return { basis: "available_only", count: mapped.length, truncated: rows.length > input.limit, rows: mapped };
};

const getStorageBin: Binding<"get_storage_bin"> = async (client, input, signal) => {
  const filter = and(equals("Warehouse", input.warehouse), equals("StorageBin", input.storageBin));
  const [bin] = await client.read(SERVICES.storageBin, "WarehouseStorageBin", { filter, top: 1 }, signal);
  if (!bin) return { found: false, storageBin: null };
  return {
    found: true,
    storageBin: {
      storageBin: text(bin.StorageBin) ?? input.storageBin,
      warehouse: text(bin.Warehouse),
      storageType: text(bin.StorageType),
      isEmpty: flag(bin.StorageBinIsEmpty),
      isFull: flag(bin.StorageBinIsFull),
      blockedForRemoval: flag(bin.StorageBinIsBlockedForRemoval),
      blockedForPutaway: flag(bin.StorageBinIsBlockedForPutaway),
      blockedByPhysicalInventory: flag(bin.StorageBinIsBlockedDueToPInv),
      fixedBinType: text(bin.EWMStorageBinFixedBinType),
      capacity: {
        maxWeight: number(bin.LoadCapacityOfStorageBin),
        usedWeight: number(bin.WeightOfMaterialsInStorageBin),
        weightUnit: text(bin.WeightUnit),
        maxVolume: number(bin.StorageBinMaxVolume),
        usedVolume: number(bin.StorageBinOccupiedVolume),
        volumeUnit: text(bin.VolumeUnit),
        handlingUnits: number(bin.EWMStorBinNumberOfHndlgUnits),
        maxHandlingUnits: number(bin.EWMStorBinMaxNmbrOfHndlgUnits),
      },
      lastWarehouseTask: text(bin.EWMStorageBinLastWarehouseTask),
      lastMovementAt: dateTime(bin.EWMStorageBinLastMvtDateTime),
      sapFields: scalars(bin),
    },
  };
};

export const BINDINGS: { [N in ToolName]?: Binding<N> } = {
  get_delivery: getDelivery,
  get_warehouse_tasks: getWarehouseTasks,
  get_warehouse_order: getWarehouseOrder,
  get_handling_unit: getHandlingUnit,
  get_stock: getStock,
  get_storage_bin: getStorageBin,
};

/** Tools SAP has released no API for. They need custom read-only ABAP services on the system. */
export const NO_RELEASED_API: Partial<Record<ToolName, string>> = {
  get_queue_status: "qRFC queues",
  get_application_log: "the application log",
  get_ppf_actions: "PPF actions",
  get_abap_dump: "ABAP short dumps",
  get_configuration: "customizing",
};

export function unsupportedReason(toolName: string): string | null {
  if (toolName in BINDINGS) return null;
  const what = NO_RELEASED_API[toolName as ToolName];
  if (!what) return `No tool called ${toolName} exists for this connection.`;
  return (
    `SAP has not released an API for ${what}, so this tool cannot run over the API sandbox. ` +
    "It needs the EWM Agent Connector (custom read-only ABAP services) on a customer system, planned for Milestone 6."
  );
}

export function requireBinding<N extends ToolName>(toolName: N): Binding<N> {
  const binding = BINDINGS[toolName] as Binding<N> | undefined;
  if (!binding) throw new AdapterError("not_supported", unsupportedReason(toolName) ?? "Not supported.");
  return binding;
}
