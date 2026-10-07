import type {
  ConfigEntry,
  ConfigurationArea,
  Delivery,
  Dump,
  HandlingUnit,
  LogMessage,
  PpfAction,
  Queue,
  StockRow,
  StorageBin,
  WarehouseOrder,
  WarehouseTask,
} from "../contracts";

/**
 * A scenario pack: one consistent piece of warehouse state built around a single failure.
 *
 * The pack holds only what a consultant could look up in the system. The planted root cause is
 * NOT in here; it lives in the answer key under /tests/scenarios, which no runtime code reads.
 *
 * All values are illustrative, written in the style of an SAP standard warehouse. Document types,
 * process types, stock types and queue names should be reviewed against real tickets
 * (TODO – verify). Log texts are plain-language stand-ins: no SAP message numbers are given,
 * because none were taken from a real system.
 */
export interface ScenarioPack {
  id: string;
  /** Which of the ten use cases (architecture document, section 12) this pack exercises. */
  useCase: number;
  title: string;
  /** The ticket a user would raise. It describes the symptom only. */
  ticket: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "critical";
    process: "inbound" | "outbound" | "integration" | "configuration" | "master_data";
  };
  data: Partial<WorldData>;
}

export interface WorldData {
  deliveries: Delivery[];
  tasks: WarehouseTask[];
  /** Orders without their tasks; tasks are joined in by warehouse order number. */
  orders: Array<Omit<WarehouseOrder, "tasks">>;
  handlingUnits: HandlingUnit[];
  /** Each row also says which warehouse it belongs to. */
  stock: Array<StockRow & { warehouse: string }>;
  bins: StorageBin[];
  queues: Queue[];
  logs: LogMessage[];
  ppfActions: PpfAction[];
  dumps: Dump[];
  configuration: Array<{ area: ConfigurationArea; warehouse: string; entry: ConfigEntry }>;
}

export const emptyWorld = (): WorldData => ({
  deliveries: [],
  tasks: [],
  orders: [],
  handlingUnits: [],
  stock: [],
  bins: [],
  queues: [],
  logs: [],
  ppfActions: [],
  dumps: [],
  configuration: [],
});

export function mergeWorld(parts: Array<Partial<WorldData>>): WorldData {
  const world = emptyWorld();
  for (const part of parts) {
    for (const key of Object.keys(world) as Array<keyof WorldData>) {
      (world[key] as unknown[]).push(...((part[key] as unknown[] | undefined) ?? []));
    }
  }
  return world;
}

// ------------------------------------------------------------------ builders used by the packs

const st = (text: string) => ({ code: null, text });

export const S = {
  notStarted: st("Not started"),
  partial: st("Partially completed"),
  completed: st("Completed"),
  notRelevant: st("Not relevant"),
  open: st("Open"),
  confirmed: st("Confirmed"),
};

export function deliveryItem(
  item: string,
  product: string,
  quantity: number,
  over: Partial<Delivery["items"][number]> = {},
): Delivery["items"][number] {
  return {
    item,
    itemType: "ODLV",
    itemCategory: "DLV",
    product,
    batch: null,
    quantity,
    unit: "EA",
    warehouseProcessType: "2010",
    statuses: {
      goodsMovement: S.notStarted,
      planning: S.notStarted,
      execution: S.notStarted,
      completion: S.notStarted,
    },
    stagingArea: null,
    goodsMovementBin: null,
    reference: { salesOrder: null, purchasingDocument: null, manufacturingOrder: null },
    ...over,
  };
}

export function task(
  warehouseTask: string,
  over: Partial<WarehouseTask> & Pick<WarehouseTask, "product" | "delivery" | "deliveryItem">,
): WarehouseTask {
  return {
    warehouseTask,
    item: "1",
    warehouseOrder: null,
    status: S.open,
    processType: { code: "2010", name: "Stock removal" },
    batch: null,
    stockType: "F2",
    quantity: { target: 0, actual: null, difference: null, unit: "EA" },
    source: { storageType: null, storageSection: null, storageBin: null, handlingUnit: null },
    destination: { storageType: null, storageSection: null, storageBin: null, handlingUnit: null },
    activityArea: null,
    exceptionCode: null,
    executingResource: null,
    createdAt: null,
    confirmedAt: null,
    ...over,
  };
}

export function stock(
  warehouse: string,
  product: string,
  over: Partial<StockRow> &
    Pick<StockRow, "stockType" | "storageType" | "storageBin" | "physicalQuantity">,
): StockRow & { warehouse: string } {
  return {
    warehouse,
    product,
    batch: null,
    stockTypeText: null,
    handlingUnit: null,
    availableQuantity: over.physicalQuantity,
    unit: "EA",
    owner: null,
    blockedForInventory: false,
    goodsReceiptAt: null,
    shelfLifeExpiration: null,
    ...over,
  };
}

export const log = (
  timestamp: string,
  severity: LogMessage["severity"],
  externalId: string,
  text: string,
  over: Partial<LogMessage> = {},
): LogMessage => ({
  timestamp,
  severity,
  text,
  messageId: null,
  object: null,
  subobject: null,
  externalId,
  user: null,
  ...over,
});

export const config = (area: ConfigurationArea, warehouse: string, entry: ConfigEntry) => ({
  area,
  warehouse,
  entry,
});
