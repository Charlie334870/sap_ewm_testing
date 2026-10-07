import { deliveryItem, log, S, stock, task, type ScenarioPack } from "../world";
import { WAREHOUSE as W } from "./baseline";

/** Use case 9: no warehouse process type is determined for a delivery item. */
export const wptNotDetermined: ScenarioPack = {
  id: "wpt-not-determined",
  useCase: 9,
  title: "One delivery item gets no warehouse task while the other item does",
  ticket: {
    title: "Item 20 of delivery 80001003 gets no warehouse task in warehouse MUHW",
    description:
      "Outbound delivery order 80001003 has two items. Item 10 was picked normally. Item 20 is a free sample for " +
      "the same customer and no picking task appears for it, although stock is in the bin.",
    priority: "medium",
    process: "outbound",
  },
  data: {
    deliveries: [
      {
        direction: "outbound",
        number: "80001003",
        warehouse: W,
        deliveryType: "OUTB",
        partner: { role: "ship_to", id: "17100004", name: "Customer 17100004" },
        plannedDeliveryAt: "2026-10-06T16:00:00.000Z",
        lastChangedAt: "2026-10-06T07:45:00.000Z",
        items: [
          deliveryItem("10", "P-2000", 6, {
            statuses: {
              goodsMovement: S.notStarted,
              planning: S.completed,
              execution: S.completed,
              completion: S.partial,
            },
            reference: {
              salesOrder: "4501003",
              purchasingDocument: null,
              manufacturingOrder: null,
            },
          }),
          deliveryItem("20", "P-3000", 1, {
            itemType: "ZSMP",
            warehouseProcessType: null,
            reference: {
              salesOrder: "4501003",
              purchasingDocument: null,
              manufacturingOrder: null,
            },
          }),
        ],
      },
    ],
    tasks: [
      task("100001003", {
        warehouseOrder: "2001003",
        status: S.confirmed,
        product: "P-2000",
        delivery: "80001003",
        deliveryItem: "10",
        quantity: { target: 6, actual: 6, difference: 0, unit: "EA" },
        source: {
          storageType: "0020",
          storageSection: "0001",
          storageBin: "0020-02-05-B",
          handlingUnit: null,
        },
        destination: {
          storageType: "9020",
          storageSection: "0001",
          storageBin: "GI-ZONE-01",
          handlingUnit: null,
        },
        activityArea: "A020",
        executingResource: "RF-07",
        createdAt: "2026-10-06T07:10:00.000Z",
        confirmedAt: "2026-10-06T07:45:00.000Z",
      }),
    ],
    orders: [
      {
        warehouseOrder: "2001003",
        warehouse: W,
        status: S.confirmed,
        creationRule: "PICK01",
        queue: "PICK-A020",
        executingResource: "RF-07",
        createdAt: "2026-10-06T07:10:00.000Z",
        startedAt: "2026-10-06T07:30:00.000Z",
        confirmedAt: "2026-10-06T07:45:00.000Z",
        latestStartAt: "2026-10-06T08:00:00.000Z",
      },
    ],
    stock: [
      stock(W, "P-3000", {
        stockType: "F2",
        stockTypeText: "Unrestricted use in warehouse",
        storageType: "0050",
        storageBin: "0050-01-01-A",
        physicalQuantity: 25,
        goodsReceiptAt: "2026-09-12T10:00:00.000Z",
      }),
    ],
    logs: [
      log(
        "2026-10-06T07:10:00.000Z",
        "success",
        "80001003",
        "Warehouse task 100001003 created for item 10.",
      ),
      log(
        "2026-10-06T07:10:00.000Z",
        "error",
        "80001003",
        "No warehouse task created for item 20: warehouse process type could not be determined.",
      ),
    ],
  },
};
