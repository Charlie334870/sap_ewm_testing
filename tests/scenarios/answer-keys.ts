/**
 * Answer keys for the scenario packs of the simulated SAP system.
 *
 * NOTHING at run time may read this file: not the API, not a tool, not the agent. It is used
 * only by tests and, from Milestone 3, by the evaluation harness that scores an investigation
 * after it has finished. A test below fails if any package or app imports it.
 *
 * Each key says what the planted root cause is, and which tool results are the evidence a
 * correct investigation has to find. Every path/value pair is checked against the simulator.
 */
export interface EvidenceCheck {
  /** Why this result matters to the diagnosis. */
  shows: string;
  tool: string;
  input: Record<string, unknown>;
  /** Dotted paths into the tool result and the value expected there. */
  expect: Record<string, unknown>;
}

export interface AnswerKey {
  packId: string;
  symptom: string;
  cause: string;
  rootCause: string;
  /** What category of fix is right, and at which authorisation level it sits. */
  fix: { summary: string; level: 2 | 3; kind: "business_decision" | "customizing" | "period_or_master_data" };
  evidence: EvidenceCheck[];
  /** Plausible wrong conclusions. An investigation that lands on one of these has failed. */
  wrongConclusions: string[];
}

export const ANSWER_KEYS: AnswerKey[] = [
  {
    packId: "wt-not-created",
    symptom: "No warehouse task is created for item 10 of outbound delivery order 80001001.",
    cause: "Stock removal finds no stock of product P-1001 that is available for picking.",
    rootCause:
      "All 40 EA of P-1001 are in stock type Q4 (quality inspection in warehouse) since the goods receipt of inbound " +
      "delivery 180000450 on 4 October. The inspection has no usage decision yet, so no unrestricted (F2) stock exists.",
    fix: {
      summary:
        "Quality management records the usage decision for the inspection of inbound delivery 180000450, which posts the " +
        "stock from Q4 to F2. Then warehouse task creation for delivery 80001001 is repeated. Customizing is correct and must not be changed.",
      level: 2,
      kind: "business_decision",
    },
    evidence: [
      {
        shows: "The delivery item exists, has process type 2010 and no task was planned.",
        tool: "get_delivery",
        input: { direction: "outbound", delivery: "80001001" },
        expect: { "delivery.items.0.warehouseProcessType": "2010", "delivery.items.0.statuses.planning.text": "Not started" },
      },
      {
        shows: "No warehouse task exists for the delivery.",
        tool: "get_warehouse_tasks",
        input: { warehouse: "MUHW", delivery: "80001001" },
        expect: { count: 0 },
      },
      {
        shows: "The only stock of the product is in quality inspection.",
        tool: "get_stock",
        input: { warehouse: "MUHW", product: "P-1001" },
        expect: { count: 1, "rows.0.stockType": "Q4", "rows.0.physicalQuantity": 40 },
      },
      {
        shows: "Stock type Q4 is not available for picking.",
        tool: "get_configuration",
        input: { area: "stock_types", warehouse: "MUHW", filters: { stockType: "Q4" } },
        expect: { "entries.0.availableForPicking": false },
      },
      {
        shows: "The stock went to quality inspection at goods receipt of inbound delivery 180000450.",
        tool: "get_application_log",
        input: { externalId: "180000450" },
        expect: { "messages.1.text": "Inspection document created for item 10, product P-1001, quantity 40 EA. Stock posted to quality inspection." },
      },
    ],
    wrongConclusions: [
      "The warehouse process type determination is missing (it is not: 2010 was determined).",
      "The storage type search sequence is wrong (storage type 0020 is in sequence PICK).",
      "There is no stock of the product at all (there are 40 EA, in the wrong stock type).",
    ],
  },
  {
    packId: "queue-failure",
    symptom: "Goods issue of outbound delivery order 80001002 is posted in EWM, but the ERP delivery shows it as open.",
    cause: "The goods issue message to the ERP delivery is stuck in a qRFC queue with status SYSFAIL.",
    rootCause:
      "The ERP posting failed because the posting period for October 2026 is not open in company code 1710: only 2026/09 " +
      "and 2026/08 allow postings. The warehouse side is complete and correct.",
    fix: {
      summary:
        "Finance or materials management opens the current posting period in the ERP system for company code 1710. " +
        "Then the failed queue entry is reprocessed. Nothing is changed in the warehouse.",
      level: 2,
      kind: "period_or_master_data",
    },
    evidence: [
      {
        shows: "The warehouse document is complete: goods issue is posted.",
        tool: "get_delivery",
        input: { direction: "outbound", delivery: "80001002" },
        expect: { "delivery.items.0.statuses.goodsMovement.text": "Completed" },
      },
      {
        shows: "A queue for this delivery is in error.",
        tool: "get_queue_status",
        input: { document: "80001002" },
        expect: { "queues.0.status": "SYSFAIL", "queues.0.errorText": "Posting only possible in periods 2026/09 and 2026/08 in company code 1710" },
      },
      {
        shows: "It is the only failed queue, so this is not a general interface outage.",
        tool: "get_queue_status",
        input: { onlyFailed: true },
        expect: { count: 1 },
      },
    ],
    wrongConclusions: [
      "The goods issue was not posted in the warehouse (it was).",
      "The interface between EWM and ERP is down (other queues are processed).",
      "The delivery must be reversed and posted again in the warehouse.",
    ],
  },
  {
    packId: "wpt-not-determined",
    symptom: "Item 20 of outbound delivery order 80001003 gets no warehouse task; item 10 was picked normally.",
    cause: "No warehouse process type is determined for item 20.",
    rootCause:
      "Item 20 has the custom item type ZSMP. The warehouse process type determination for warehouse MUHW has an entry " +
      "for document type OUTB with item type ODLV only; there is no entry for item type ZSMP.",
    fix: {
      summary:
        "Add a determination entry for document type OUTB and item type ZSMP with the appropriate warehouse process type " +
        "(customizing, transported from DEV). Then redetermine the process type for item 20 and create its task.",
      level: 2,
      kind: "customizing",
    },
    evidence: [
      {
        shows: "Item 20 has item type ZSMP and no warehouse process type; item 10 has ODLV and 2010.",
        tool: "get_delivery",
        input: { direction: "outbound", delivery: "80001003" },
        expect: {
          "delivery.items.0.itemType": "ODLV",
          "delivery.items.0.warehouseProcessType": "2010",
          "delivery.items.1.itemType": "ZSMP",
          "delivery.items.1.warehouseProcessType": null,
        },
      },
      {
        shows: "No determination entry exists for item type ZSMP.",
        tool: "get_configuration",
        input: { area: "wpt_determination", warehouse: "MUHW", filters: { itemType: "ZSMP" } },
        expect: { count: 0 },
      },
      {
        shows: "An entry does exist for the standard item type, so the gap is specific to ZSMP.",
        tool: "get_configuration",
        input: { area: "wpt_determination", warehouse: "MUHW", filters: { documentType: "OUTB", itemType: "ODLV" } },
        expect: { count: 1, "entries.0.warehouseProcessType": "2010" },
      },
      {
        shows: "Stock is not the problem: unrestricted stock of the sample product exists.",
        tool: "get_stock",
        input: { warehouse: "MUHW", product: "P-3000" },
        expect: { "rows.0.stockType": "F2", "rows.0.availableQuantity": 25 },
      },
    ],
    wrongConclusions: [
      "There is no stock of the sample product (25 EA of unrestricted stock exist).",
      "The whole delivery is blocked (item 10 was processed).",
    ],
  },
];
