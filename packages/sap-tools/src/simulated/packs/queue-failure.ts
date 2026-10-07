import { deliveryItem, log, S, task, type ScenarioPack } from "../world";
import { WAREHOUSE as W } from "./baseline";

/** Use case 5: a follow-on posting is stuck in a qRFC queue. */
export const queueFailure: ScenarioPack = {
  id: "queue-failure",
  useCase: 5,
  title: "Goods issue posted in the warehouse but not in the ERP delivery",
  ticket: {
    title: "Goods issue for delivery 80001002 is posted in EWM but the ERP delivery is not updated",
    description:
      "The warehouse posted goods issue for outbound delivery order 80001002 yesterday afternoon. In the ERP " +
      "delivery the goods issue is still open, so billing cannot invoice the customer.",
    priority: "high",
    process: "integration",
  },
  data: {
    deliveries: [
      {
        direction: "outbound",
        number: "80001002",
        warehouse: W,
        deliveryType: "OUTB",
        partner: { role: "ship_to", id: "17100003", name: "Customer 17100003" },
        plannedDeliveryAt: "2026-10-05T15:00:00.000Z",
        lastChangedAt: "2026-10-05T15:12:00.000Z",
        items: [
          deliveryItem("10", "P-2000", 12, {
            statuses: {
              goodsMovement: S.completed,
              planning: S.completed,
              execution: S.completed,
              completion: S.completed,
            },
            goodsMovementBin: "GI-ZONE-01",
            reference: {
              salesOrder: "4501002",
              purchasingDocument: null,
              manufacturingOrder: null,
            },
          }),
        ],
      },
    ],
    orders: [
      {
        warehouseOrder: "2001002",
        warehouse: W,
        status: S.confirmed,
        creationRule: "PICK01",
        queue: "PICK-A020",
        executingResource: "RF-03",
        createdAt: "2026-10-05T13:20:00.000Z",
        startedAt: "2026-10-05T14:01:00.000Z",
        confirmedAt: "2026-10-05T14:19:00.000Z",
        latestStartAt: "2026-10-05T14:30:00.000Z",
      },
    ],
    tasks: [
      task("100001002", {
        warehouseOrder: "2001002",
        status: S.confirmed,
        product: "P-2000",
        delivery: "80001002",
        deliveryItem: "10",
        quantity: { target: 12, actual: 12, difference: 0, unit: "EA" },
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
        executingResource: "RF-03",
        createdAt: "2026-10-05T13:20:00.000Z",
        confirmedAt: "2026-10-05T14:19:00.000Z",
      }),
    ],
    queues: [
      {
        name: "DLWSS4DCLNT1000080001002",
        direction: "inbound",
        status: "SYSFAIL",
        entries: 1,
        destination: null,
        errorText: "Posting only possible in periods 2026/09 and 2026/08 in company code 1710",
        firstEntryAt: "2026-10-05T15:12:04.000Z",
        document: "80001002",
      },
    ],
    logs: [
      log(
        "2026-10-05T13:20:00.000Z",
        "success",
        "80001002",
        "Warehouse task 100001002 created for item 10.",
      ),
      log(
        "2026-10-05T15:12:00.000Z",
        "success",
        "80001002",
        "Goods issue posted for outbound delivery order 80001002.",
      ),
      log(
        "2026-10-05T15:12:02.000Z",
        "info",
        "80001002",
        "Goods issue message for the ERP delivery handed over to the queue.",
      ),
    ],
  },
};
