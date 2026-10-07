import { config, deliveryItem, log, S, stock, task, type WorldData } from "../world";

/**
 * The healthy part of the simulated warehouse MUHW: customizing and a few documents that work.
 * It is there so that a failing document can be compared with one that went through.
 */
export const WAREHOUSE = "MUHW";
const W = WAREHOUSE;

export const baseline: Partial<WorldData> = {
  configuration: [
    // Warehouse process type determination
    config("wpt_determination", W, {
      documentType: "OUTB",
      itemType: "ODLV",
      deliveryPriority: "",
      processIndicator: "",
      warehouseProcessType: "2010",
      description: "Outbound delivery order, standard item: stock removal",
    }),
    config("wpt_determination", W, {
      documentType: "INB",
      itemType: "IDLV",
      deliveryPriority: "",
      processIndicator: "",
      warehouseProcessType: "1011",
      description: "Inbound delivery, standard item: putaway",
    }),
    // Stock removal: where picking looks for stock, in this order
    config("storage_type_search_sequence", W, {
      searchSequence: "PICK",
      usedByProcessType: "2010",
      position: 1,
      storageType: "0050",
      removalRule: "FIFO",
    }),
    config("storage_type_search_sequence", W, {
      searchSequence: "PICK",
      usedByProcessType: "2010",
      position: 2,
      storageType: "0020",
      removalRule: "FIFO",
    }),
    config("storage_types", W, { storageType: "0020", description: "Rack storage", role: "Standard storage" }),
    config("storage_types", W, { storageType: "0050", description: "Fixed bin picking", role: "Standard storage" }),
    config("storage_types", W, { storageType: "9010", description: "Goods receipt zone", role: "Staging area" }),
    config("storage_types", W, { storageType: "9020", description: "Goods issue zone", role: "Staging area" }),
    config("stock_types", W, { stockType: "F1", description: "Unrestricted use in putaway", availableForPicking: false }),
    config("stock_types", W, { stockType: "F2", description: "Unrestricted use in warehouse", availableForPicking: true }),
    config("stock_types", W, { stockType: "Q3", description: "Quality inspection in putaway", availableForPicking: false }),
    config("stock_types", W, { stockType: "Q4", description: "Quality inspection in warehouse", availableForPicking: false }),
    config("stock_types", W, { stockType: "B5", description: "Blocked in putaway", availableForPicking: false }),
    config("stock_types", W, { stockType: "B6", description: "Blocked in warehouse", availableForPicking: false }),
    config("warehouse_order_creation_rules", W, {
      rule: "PICK01",
      description: "Picking by activity area",
      activityArea: "A020",
      maxItemsPerOrder: 20,
      itemFilter: "",
    }),
  ],

  deliveries: [
    {
      direction: "outbound",
      number: "80000990",
      warehouse: W,
      deliveryType: "OUTB",
      partner: { role: "ship_to", id: "17100001", name: "Customer 17100001" },
      plannedDeliveryAt: "2026-10-02T10:00:00.000Z",
      lastChangedAt: "2026-10-02T09:41:00.000Z",
      items: [
        deliveryItem("10", "P-2000", 24, {
          statuses: { goodsMovement: S.completed, planning: S.completed, execution: S.completed, completion: S.completed },
          goodsMovementBin: "GI-ZONE-01",
          reference: { salesOrder: "4500990", purchasingDocument: null, manufacturingOrder: null },
        }),
      ],
    },
  ],

  orders: [
    {
      warehouseOrder: "2000990",
      warehouse: W,
      status: S.confirmed,
      creationRule: "PICK01",
      queue: "PICK-A020",
      executingResource: "RF-07",
      createdAt: "2026-10-02T08:02:00.000Z",
      startedAt: "2026-10-02T08:30:00.000Z",
      confirmedAt: "2026-10-02T08:44:00.000Z",
      latestStartAt: "2026-10-02T09:00:00.000Z",
    },
  ],

  tasks: [
    task("100000990", {
      warehouseOrder: "2000990",
      status: S.confirmed,
      product: "P-2000",
      delivery: "80000990",
      deliveryItem: "10",
      quantity: { target: 24, actual: 24, difference: 0, unit: "EA" },
      source: { storageType: "0020", storageSection: "0001", storageBin: "0020-02-05-B", handlingUnit: null },
      destination: { storageType: "9020", storageSection: "0001", storageBin: "GI-ZONE-01", handlingUnit: null },
      activityArea: "A020",
      executingResource: "RF-07",
      createdAt: "2026-10-02T08:02:00.000Z",
      confirmedAt: "2026-10-02T08:44:00.000Z",
    }),
  ],

  stock: [
    stock(W, "P-2000", {
      stockType: "F2",
      stockTypeText: "Unrestricted use in warehouse",
      storageType: "0020",
      storageBin: "0020-02-05-B",
      physicalQuantity: 176,
      goodsReceiptAt: "2026-09-21T06:15:00.000Z",
    }),
    stock(W, "P-1002", {
      stockType: "F2",
      stockTypeText: "Unrestricted use in warehouse",
      storageType: "0020",
      storageBin: "0020-01-04-A",
      physicalQuantity: 60,
      goodsReceiptAt: "2026-09-25T11:00:00.000Z",
    }),
  ],

  bins: [
    {
      storageBin: "0020-02-05-B",
      warehouse: W,
      storageType: "0020",
      isEmpty: false,
      isFull: false,
      blockedForRemoval: false,
      blockedForPutaway: false,
      blockedByPhysicalInventory: false,
      fixedBinType: null,
      capacity: {
        maxWeight: 1000,
        usedWeight: 352,
        weightUnit: "KG",
        maxVolume: null,
        usedVolume: null,
        volumeUnit: null,
        handlingUnits: null,
        maxHandlingUnits: null,
      },
      lastWarehouseTask: "100000990",
      lastMovementAt: "2026-10-02T08:44:00.000Z",
    },
  ],

  queues: [
    {
      name: "DLWSS4DCLNT1000080000990",
      direction: "inbound",
      status: "Processed",
      entries: 0,
      destination: null,
      errorText: null,
      firstEntryAt: null,
      document: "80000990",
    },
  ],

  logs: [
    log("2026-10-02T08:02:00.000Z", "success", "80000990", "Warehouse task 100000990 created for item 10."),
    log("2026-10-02T09:41:00.000Z", "success", "80000990", "Goods issue posted for outbound delivery order 80000990."),
  ],
};
