/**
 * Tool contracts: the only ways the agent can look at an SAP system.
 *
 * Every tool here is read-only (authorisation level 0). Each has one input schema and one output
 * schema that every adapter must satisfy, so the agent sees the same shape whether the data came
 * from the simulator or from SAP. A result that does not match its output schema is treated as
 * unexpected data and is never passed on.
 *
 * Status values are given as { code, text }. The real connector fills `code` with whatever SAP
 * returns and never interprets it. The simulator fills `text` only, because SAP's internal codes
 * are not reproduced from memory.
 */
import { z } from "zod";
import { ENVIRONMENT_KINDS, type EnvironmentKind } from "@ewm/shared";

// ------------------------------------------------------------------ shared pieces

const warehouse = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,4}$/, "A warehouse number is up to 4 letters or digits")
  .describe("EWM warehouse number, for example MUHW");

const documentNumber = z.string().trim().min(1).max(40);
const limit = z.coerce.number().int().min(1).max(200).default(50).describe("Maximum number of rows to return");

const status = z.object({ code: z.string().nullable(), text: z.string().nullable() }).nullable();
export type Status = z.infer<typeof status>;

/** Fields exactly as SAP returned them, under their original SAP names. Real connections only. */
const sapFields = z.record(z.string(), z.unknown()).optional();

const isoDateTime = z.string().nullable();
const quantity = z.number().nullable();

// ------------------------------------------------------------------ get_delivery

const deliveryItem = z.object({
  item: z.string(),
  itemType: z.string().nullable(),
  itemCategory: z.string().nullable(),
  product: z.string().nullable(),
  batch: z.string().nullable(),
  quantity,
  unit: z.string().nullable(),
  warehouseProcessType: z.string().nullable(),
  statuses: z.object({
    /** Goods issue (outbound) or goods receipt (inbound). */
    goodsMovement: status,
    /** Planned picking (outbound) or planned putaway (inbound): have warehouse tasks been created? */
    planning: status,
    /** Picking (outbound) or putaway (inbound): have the warehouse tasks been confirmed? */
    execution: status,
    completion: status,
  }),
  stagingArea: z.string().nullable(),
  goodsMovementBin: z.string().nullable(),
  reference: z.object({
    salesOrder: z.string().nullable(),
    purchasingDocument: z.string().nullable(),
    manufacturingOrder: z.string().nullable(),
  }),
  sapFields,
});

const delivery = z.object({
  direction: z.enum(["outbound", "inbound"]),
  number: z.string(),
  warehouse: z.string().nullable(),
  deliveryType: z.string().nullable(),
  partner: z.object({ role: z.enum(["ship_to", "ship_from"]), id: z.string().nullable(), name: z.string().nullable() }),
  plannedDeliveryAt: isoDateTime,
  lastChangedAt: isoDateTime,
  items: z.array(deliveryItem),
  sapFields,
});
export type Delivery = z.infer<typeof delivery>;

// ------------------------------------------------------------------ get_warehouse_tasks

const location = z.object({
  storageType: z.string().nullable(),
  storageSection: z.string().nullable(),
  storageBin: z.string().nullable(),
  handlingUnit: z.string().nullable(),
});

const warehouseTask = z.object({
  warehouseTask: z.string(),
  item: z.string().nullable(),
  warehouseOrder: z.string().nullable(),
  status,
  processType: z.object({ code: z.string().nullable(), name: z.string().nullable() }),
  product: z.string().nullable(),
  batch: z.string().nullable(),
  stockType: z.string().nullable(),
  quantity: z.object({ target: quantity, actual: quantity, difference: quantity, unit: z.string().nullable() }),
  source: location,
  destination: location,
  delivery: z.string().nullable(),
  deliveryItem: z.string().nullable(),
  activityArea: z.string().nullable(),
  exceptionCode: z.string().nullable(),
  executingResource: z.string().nullable(),
  createdAt: isoDateTime,
  confirmedAt: isoDateTime,
  sapFields,
});
export type WarehouseTask = z.infer<typeof warehouseTask>;

// ------------------------------------------------------------------ get_warehouse_order

const warehouseOrder = z.object({
  warehouseOrder: z.string(),
  warehouse: z.string().nullable(),
  status,
  /** Rule that built the order. Not exposed by SAP's released API, so null on real connections. */
  creationRule: z.string().nullable(),
  queue: z.string().nullable(),
  executingResource: z.string().nullable(),
  createdAt: isoDateTime,
  startedAt: isoDateTime,
  confirmedAt: isoDateTime,
  latestStartAt: isoDateTime,
  tasks: z.array(warehouseTask),
  sapFields,
});
export type WarehouseOrder = z.infer<typeof warehouseOrder>;

// ------------------------------------------------------------------ get_handling_unit

const handlingUnit = z.object({
  handlingUnit: z.string(),
  warehouse: z.string().nullable(),
  packagingMaterial: z.string().nullable(),
  status,
  parentHandlingUnit: z.string().nullable(),
  location: z.object({
    storageType: z.string().nullable(),
    storageSection: z.string().nullable(),
    storageBin: z.string().nullable(),
  }),
  referenceDocument: z.string().nullable(),
  grossWeight: quantity,
  weightUnit: z.string().nullable(),
  items: z.array(
    z.object({
      item: z.string().nullable(),
      product: z.string().nullable(),
      quantity,
      unit: z.string().nullable(),
      referenceDocument: z.string().nullable(),
      referenceItem: z.string().nullable(),
      sapFields,
    }),
  ),
  sapFields,
});
export type HandlingUnit = z.infer<typeof handlingUnit>;

// ------------------------------------------------------------------ get_stock

const stockRow = z.object({
  product: z.string(),
  batch: z.string().nullable(),
  stockType: z.string().nullable(),
  stockTypeText: z.string().nullable(),
  storageType: z.string().nullable(),
  storageBin: z.string().nullable(),
  handlingUnit: z.string().nullable(),
  /** Quantity physically in the bin. Null where the connection only reports available stock. */
  physicalQuantity: quantity,
  /** Quantity not yet reserved by open warehouse tasks. */
  availableQuantity: quantity,
  unit: z.string().nullable(),
  owner: z.string().nullable(),
  blockedForInventory: z.boolean().nullable(),
  goodsReceiptAt: isoDateTime,
  shelfLifeExpiration: z.string().nullable(),
  sapFields,
});
export type StockRow = z.infer<typeof stockRow>;

// ------------------------------------------------------------------ get_storage_bin

const storageBin = z.object({
  storageBin: z.string(),
  warehouse: z.string().nullable(),
  storageType: z.string().nullable(),
  isEmpty: z.boolean().nullable(),
  isFull: z.boolean().nullable(),
  blockedForRemoval: z.boolean().nullable(),
  blockedForPutaway: z.boolean().nullable(),
  blockedByPhysicalInventory: z.boolean().nullable(),
  fixedBinType: z.string().nullable(),
  capacity: z.object({
    maxWeight: quantity,
    usedWeight: quantity,
    weightUnit: z.string().nullable(),
    maxVolume: quantity,
    usedVolume: quantity,
    volumeUnit: z.string().nullable(),
    handlingUnits: quantity,
    maxHandlingUnits: quantity,
  }),
  lastWarehouseTask: z.string().nullable(),
  lastMovementAt: isoDateTime,
  sapFields,
});
export type StorageBin = z.infer<typeof storageBin>;

// ------------------------------------------------------------------ technical monitors

const queue = z.object({
  name: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  status: z.string(),
  entries: z.number(),
  destination: z.string().nullable(),
  /** Error text of the first failed entry, exactly as the system reports it. */
  errorText: z.string().nullable(),
  firstEntryAt: isoDateTime,
  document: z.string().nullable(),
});
export type Queue = z.infer<typeof queue>;

const logMessage = z.object({
  timestamp: z.string(),
  severity: z.enum(["error", "warning", "info", "success"]),
  text: z.string(),
  /** Message class and number, when known. Never made up: null unless the system supplied it. */
  messageId: z.string().nullable(),
  object: z.string().nullable(),
  subobject: z.string().nullable(),
  externalId: z.string().nullable(),
  user: z.string().nullable(),
});
export type LogMessage = z.infer<typeof logMessage>;

const ppfAction = z.object({
  action: z.string(),
  description: z.string().nullable(),
  document: z.string(),
  status: z.string(),
  processingType: z.string().nullable(),
  processedAt: isoDateTime,
  /** Why the action was or was not scheduled, if the system says so. */
  determination: z.string().nullable(),
  messages: z.array(z.object({ severity: z.enum(["error", "warning", "info", "success"]), text: z.string() })),
});
export type PpfAction = z.infer<typeof ppfAction>;

const dump = z.object({
  timestamp: z.string(),
  user: z.string().nullable(),
  runtimeError: z.string(),
  exception: z.string().nullable(),
  program: z.string().nullable(),
  include: z.string().nullable(),
  line: z.number().nullable(),
  shortText: z.string(),
  callStack: z.array(z.string()),
});
export type Dump = z.infer<typeof dump>;

/** Named customizing areas. The tool reads these and nothing else; it is not a table reader. */
export const CONFIGURATION_AREAS = {
  wpt_determination: "Determination of the warehouse process type from document type, item type and indicators",
  storage_type_search_sequence: "Storage type search sequences for stock removal and the storage types in each",
  warehouse_order_creation_rules: "Warehouse order creation rules with their limits and filters",
  storage_types: "Storage types of the warehouse and their role",
  stock_types: "Stock types and whether each is available for picking",
} as const;
export type ConfigurationArea = keyof typeof CONFIGURATION_AREAS;

const configEntry = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type ConfigEntry = z.infer<typeof configEntry>;

// ------------------------------------------------------------------ the tools

export interface ToolDefinition<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
  N extends string = string,
> {
  name: N;
  title: string;
  /** Written for the agent: what the tool returns and when to use it. */
  description: string;
  /** Authorisation level, master prompt section 4. Everything here is 0 (READ). */
  authLevel: 0 | 1 | 2 | 3;
  access: "read" | "write";
  environments: readonly EnvironmentKind[];
  timeoutMs: number;
  /** Extra attempts after a transient failure. Only ever above zero for read tools. */
  retries: number;
  /** Where a consultant would look in SAP GUI. For orientation; not how the tool reads. */
  consultantEquivalent: string;
  input: I;
  output: O;
}

function defineTool<const N extends string, I extends z.ZodType, O extends z.ZodType>(
  tool: Pick<ToolDefinition<I, O, N>, "name" | "title" | "description" | "consultantEquivalent" | "input" | "output"> &
    Partial<Pick<ToolDefinition<I, O, N>, "timeoutMs" | "retries">>,
): ToolDefinition<I, O, N> {
  return {
    authLevel: 0,
    access: "read",
    environments: ENVIRONMENT_KINDS,
    timeoutMs: 15_000,
    retries: 2,
    ...tool,
  };
}

export const getDelivery = defineTool({
  name: "get_delivery",
  title: "Delivery",
  description:
    "Reads one warehouse delivery document: an outbound delivery order or an inbound delivery, with its items, " +
    "warehouse process types and statuses. Start here when a ticket names a delivery.",
  consultantEquivalent: "/SCWM/PRDO, /SCWM/PRDI",
  input: z.object({
    direction: z.enum(["outbound", "inbound"]).describe("outbound = outbound delivery order, inbound = inbound delivery"),
    delivery: documentNumber.describe("Delivery document number in the warehouse"),
  }),
  output: z.object({ found: z.boolean(), delivery: delivery.nullable() }),
});

export const getWarehouseTasks = defineTool({
  name: "get_warehouse_tasks",
  title: "Warehouse tasks",
  description:
    "Lists warehouse tasks for a delivery, a warehouse order, a handling unit or one task number, with status, " +
    "process type, quantities and source and destination bins. An empty list for a delivery means no task was created.",
  consultantEquivalent: "/SCWM/MON",
  input: z
    .object({
      warehouse,
      delivery: documentNumber.optional(),
      warehouseTask: documentNumber.optional(),
      warehouseOrder: documentNumber.optional(),
      handlingUnit: documentNumber.optional(),
      limit,
    })
    .refine((v) => v.delivery || v.warehouseTask || v.warehouseOrder || v.handlingUnit, {
      message: "Give at least one of delivery, warehouseTask, warehouseOrder or handlingUnit",
    }),
  output: z.object({ count: z.number(), truncated: z.boolean(), tasks: z.array(warehouseTask) }),
});

export const getWarehouseOrder = defineTool({
  name: "get_warehouse_order",
  title: "Warehouse order",
  description: "Reads one warehouse order with its status, timing, resource and the warehouse tasks it contains.",
  consultantEquivalent: "/SCWM/MON",
  input: z.object({ warehouse, warehouseOrder: documentNumber }),
  output: z.object({ found: z.boolean(), warehouseOrder: warehouseOrder.nullable() }),
});

export const getHandlingUnit = defineTool({
  name: "get_handling_unit",
  title: "Handling unit",
  description: "Reads one handling unit: packaging material, status, current storage bin and contents.",
  consultantEquivalent: "/SCWM/MON",
  input: z.object({ warehouse, handlingUnit: documentNumber }),
  output: z.object({ found: z.boolean(), handlingUnit: handlingUnit.nullable() }),
});

export const getStock = defineTool({
  name: "get_stock",
  title: "Stock",
  description:
    "Lists stock of a product in the warehouse by bin, stock type and batch. Use it to check whether stock exists, " +
    "where it is, and whether its stock type allows the movement that failed.",
  consultantEquivalent: "/SCWM/MON (physical stock, available stock)",
  input: z.object({
    warehouse,
    product: z.string().trim().min(1).max(40),
    storageType: z.string().trim().max(4).optional(),
    storageBin: z.string().trim().max(18).optional(),
    batch: z.string().trim().max(10).optional(),
    limit,
  }),
  output: z.object({
    /** What the quantities mean on this connection. */
    basis: z.enum(["physical_and_available", "available_only"]),
    count: z.number(),
    truncated: z.boolean(),
    rows: z.array(stockRow),
  }),
});

export const getStorageBin = defineTool({
  name: "get_storage_bin",
  title: "Storage bin",
  description: "Reads one storage bin: storage type, blocks for putaway and removal, capacity and last movement.",
  consultantEquivalent: "/SCWM/LS03",
  input: z.object({ warehouse, storageBin: z.string().trim().min(1).max(18) }),
  output: z.object({ found: z.boolean(), storageBin: storageBin.nullable() }),
});

export const getQueueStatus = defineTool({
  name: "get_queue_status",
  title: "qRFC queues",
  description:
    "Lists qRFC queues with status and the error text of failed entries. Use it when a document did not arrive in " +
    "the other system or a follow-on posting is missing.",
  consultantEquivalent: "SMQ1, SMQ2",
  input: z.object({
    direction: z.enum(["inbound", "outbound", "both"]).default("both"),
    document: documentNumber.optional().describe("Only queues that belong to this document number"),
    nameContains: z.string().trim().max(40).optional(),
    onlyFailed: z.boolean().default(false),
    limit,
  }),
  output: z.object({ count: z.number(), truncated: z.boolean(), queues: z.array(queue) }),
});

export const getApplicationLog = defineTool({
  name: "get_application_log",
  title: "Application log",
  description:
    "Reads application log messages for a document or log object in a time window. Error texts are returned exactly " +
    "as logged.",
  consultantEquivalent: "SLG1",
  input: z
    .object({
      externalId: documentNumber.optional().describe("Usually the document number the log was written for"),
      object: z.string().trim().max(20).optional(),
      severity: z.enum(["error", "warning", "info", "success"]).optional().describe("Minimum severity to return"),
      from: z.string().trim().optional().describe("ISO date-time, start of the window"),
      to: z.string().trim().optional().describe("ISO date-time, end of the window"),
      limit,
    })
    .refine((v) => v.externalId || v.object, { message: "Give an externalId or a log object" }),
  output: z.object({ count: z.number(), truncated: z.boolean(), messages: z.array(logMessage) }),
});

export const getPpfActions = defineTool({
  name: "get_ppf_actions",
  title: "PPF actions",
  description:
    "Lists the PPF actions of a document (printing, follow-on processing) with status and processing messages.",
  consultantEquivalent: "Actions on the document",
  input: z.object({ document: documentNumber }),
  output: z.object({ count: z.number(), actions: z.array(ppfAction) }),
});

export const getAbapDump = defineTool({
  name: "get_abap_dump",
  title: "ABAP short dumps",
  description:
    "Lists ABAP short dumps in a time window, optionally for one user or program, with the error, the program and " +
    "the source position.",
  consultantEquivalent: "ST22",
  input: z.object({
    from: z.string().trim().optional().describe("ISO date-time, start of the window"),
    to: z.string().trim().optional().describe("ISO date-time, end of the window"),
    user: z.string().trim().max(12).optional(),
    program: z.string().trim().max(40).optional(),
    limit,
  }),
  output: z.object({ count: z.number(), truncated: z.boolean(), dumps: z.array(dump) }),
});

export const getConfiguration = defineTool({
  name: "get_configuration",
  title: "Customizing",
  description:
    "Reads one named customizing area of a warehouse. Areas: " +
    Object.entries(CONFIGURATION_AREAS)
      .map(([name, text]) => `${name} (${text})`)
      .join("; ") +
    ". Use filters to narrow by field value, for example { itemType: 'ODLV' }.",
  consultantEquivalent: "SPRO views",
  input: z.object({
    area: z.enum(Object.keys(CONFIGURATION_AREAS) as [ConfigurationArea, ...ConfigurationArea[]]),
    warehouse,
    filters: z.record(z.string(), z.string()).optional(),
  }),
  output: z.object({
    area: z.string(),
    warehouse: z.string(),
    count: z.number(),
    entries: z.array(configEntry),
  }),
});

export const TOOLS = [
  getDelivery,
  getWarehouseTasks,
  getWarehouseOrder,
  getHandlingUnit,
  getStock,
  getStorageBin,
  getQueueStatus,
  getApplicationLog,
  getPpfActions,
  getAbapDump,
  getConfiguration,
] as const satisfies readonly ToolDefinition[];

export type ToolName = (typeof TOOLS)[number]["name"];
export type ToolInput<N extends ToolName> = z.output<Extract<(typeof TOOLS)[number], { name: N }>["input"]>;
export type ToolOutput<N extends ToolName> = z.output<Extract<(typeof TOOLS)[number], { name: N }>["output"]>;

const BY_NAME = new Map<string, ToolDefinition>(TOOLS.map((t) => [t.name, t]));
export const findTool = (name: string): ToolDefinition | undefined => BY_NAME.get(name);

/** The catalogue as plain data: what the web console and the MCP server show. */
export function describeTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    authLevel: t.authLevel,
    access: t.access,
    environments: [...t.environments],
    timeoutMs: t.timeoutMs,
    retries: t.retries,
    consultantEquivalent: t.consultantEquivalent,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>,
  }));
}
export type ToolDescription = ReturnType<typeof describeTools>[number];
