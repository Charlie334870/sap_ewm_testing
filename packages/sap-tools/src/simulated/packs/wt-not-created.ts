import { deliveryItem, log, S, stock, type ScenarioPack } from "../world";
import { WAREHOUSE as W } from "./baseline";

/** Use case 1: an outbound delivery order for which no warehouse task is created. */
export const wtNotCreated: ScenarioPack = {
  id: "wt-not-created",
  useCase: 1,
  title: "Warehouse task not created for an outbound delivery",
  ticket: {
    title: "Warehouse task is not being created for delivery 80001001 in warehouse MUHW",
    description:
      "Outbound delivery order 80001001 was released this morning. Other deliveries in the same wave got their " +
      "picking tasks, this one did not. The picker has nothing to pick and the truck leaves at 14:00.",
    priority: "high",
    process: "outbound",
  },
  data: {
    deliveries: [
      {
        direction: "outbound",
        number: "80001001",
        warehouse: W,
        deliveryType: "OUTB",
        partner: { role: "ship_to", id: "17100002", name: "Customer 17100002" },
        plannedDeliveryAt: "2026-10-06T14:00:00.000Z",
        lastChangedAt: "2026-10-06T06:10:00.000Z",
        items: [
          deliveryItem("10", "P-1001", 10, {
            reference: {
              salesOrder: "4501001",
              purchasingDocument: null,
              manufacturingOrder: null,
            },
          }),
        ],
      },
      {
        direction: "inbound",
        number: "180000450",
        warehouse: W,
        deliveryType: "INB",
        partner: { role: "ship_from", id: "17300001", name: "Supplier 17300001" },
        plannedDeliveryAt: "2026-10-04T08:00:00.000Z",
        lastChangedAt: "2026-10-04T09:30:00.000Z",
        items: [
          deliveryItem("10", "P-1001", 40, {
            itemType: "IDLV",
            warehouseProcessType: "1011",
            statuses: {
              goodsMovement: S.completed,
              planning: S.completed,
              execution: S.completed,
              completion: S.completed,
            },
            reference: {
              salesOrder: null,
              purchasingDocument: "4500007731",
              manufacturingOrder: null,
            },
          }),
        ],
      },
    ],
    stock: [
      stock(W, "P-1001", {
        stockType: "Q4",
        stockTypeText: "Quality inspection in warehouse",
        storageType: "0020",
        storageBin: "0020-01-03-A",
        physicalQuantity: 40,
        goodsReceiptAt: "2026-10-04T09:05:00.000Z",
      }),
    ],
    logs: [
      log(
        "2026-10-04T09:05:00.000Z",
        "success",
        "180000450",
        "Goods receipt posted for inbound delivery 180000450.",
      ),
      log(
        "2026-10-04T09:05:00.000Z",
        "info",
        "180000450",
        "Inspection document created for item 10, product P-1001, quantity 40 EA. Stock posted to quality inspection.",
      ),
      log(
        "2026-10-04T09:30:00.000Z",
        "success",
        "180000450",
        "Putaway confirmed to bin 0020-01-03-A.",
      ),
      log(
        "2026-10-06T06:10:00.000Z",
        "error",
        "80001001",
        "No warehouse task created for item 10: requested quantity 10 EA of product P-1001 could not be found.",
      ),
    ],
  },
};
