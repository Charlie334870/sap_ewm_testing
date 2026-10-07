import { AdapterError, type SapAdapter, type SystemRef } from "../adapter";
import type { LogMessage, ToolInput, ToolName, ToolOutput } from "../contracts";
import { baseline, SCENARIO_PACKS } from "./packs";
import { mergeWorld, type WorldData } from "./world";

const SEVERITY_RANK: Record<LogMessage["severity"], number> = {
  success: 0,
  info: 1,
  warning: 2,
  error: 3,
};

const eq = (a: string | null | undefined, b: string | undefined) =>
  b === undefined || (a ?? "").toUpperCase() === b.toUpperCase();

const inWindow = (timestamp: string, from?: string, to?: string) =>
  (!from || timestamp >= new Date(from).toISOString()) &&
  (!to || timestamp <= new Date(to).toISOString());

function page<T>(rows: T[], limit: number) {
  return {
    count: Math.min(rows.length, limit),
    truncated: rows.length > limit,
    rows: rows.slice(0, limit),
  };
}

/** The whole simulated warehouse: the healthy baseline plus every scenario pack. */
export function buildSimulatedWorld(): WorldData {
  return mergeWorld([baseline, ...SCENARIO_PACKS.map((p) => p.data)]);
}

/**
 * Stand-in for an SAP system. It answers the same tools with the same shapes as a real
 * connection, from scenario packs held in memory. Every result is labelled SIMULATED by the
 * gateway. Nothing here reads from or writes to SAP.
 */
export class SimulatedSapAdapter implements SapAdapter {
  readonly source = "SIMULATED" as const;
  private readonly handlers: { [N in ToolName]: (input: ToolInput<N>) => ToolOutput<N> };

  constructor(
    private readonly system: SystemRef,
    private readonly world: WorldData = buildSimulatedWorld(),
  ) {
    const w = this.world;
    this.handlers = {
      get_delivery: (i) => {
        const delivery =
          w.deliveries.find((d) => d.direction === i.direction && d.number === i.delivery) ?? null;
        return { found: delivery !== null, delivery };
      },

      get_warehouse_tasks: (i) => {
        const matches = w.tasks.filter(
          (t) =>
            this.inWarehouse(t.delivery, t.warehouseOrder, i.warehouse) &&
            eq(t.delivery, i.delivery) &&
            eq(t.warehouseTask, i.warehouseTask) &&
            eq(t.warehouseOrder, i.warehouseOrder) &&
            (i.handlingUnit === undefined ||
              eq(t.source.handlingUnit, i.handlingUnit) ||
              eq(t.destination.handlingUnit, i.handlingUnit)),
        );
        const { rows, ...rest } = page(matches, i.limit);
        return { ...rest, tasks: rows };
      },

      get_warehouse_order: (i) => {
        const order = w.orders.find(
          (o) => o.warehouseOrder === i.warehouseOrder && eq(o.warehouse, i.warehouse),
        );
        if (!order) return { found: false, warehouseOrder: null };
        return {
          found: true,
          warehouseOrder: {
            ...order,
            tasks: w.tasks.filter((t) => t.warehouseOrder === order.warehouseOrder),
          },
        };
      },

      get_handling_unit: (i) => {
        const hu =
          w.handlingUnits.find(
            (h) => h.handlingUnit === i.handlingUnit && eq(h.warehouse, i.warehouse),
          ) ?? null;
        return { found: hu !== null, handlingUnit: hu };
      },

      get_stock: (i) => {
        const matches = w.stock
          .filter(
            (s) =>
              eq(s.warehouse, i.warehouse) &&
              eq(s.product, i.product) &&
              eq(s.storageType, i.storageType) &&
              eq(s.storageBin, i.storageBin) &&
              eq(s.batch, i.batch),
          )
          .map(({ warehouse: _warehouse, ...row }) => row);
        const { rows, ...rest } = page(matches, i.limit);
        return { basis: "physical_and_available", ...rest, rows };
      },

      get_storage_bin: (i) => {
        const bin =
          w.bins.find((b) => eq(b.storageBin, i.storageBin) && eq(b.warehouse, i.warehouse)) ??
          null;
        return { found: bin !== null, storageBin: bin };
      },

      get_queue_status: (i) => {
        const failed = (status: string) =>
          !["processed", "ready", "running"].includes(status.toLowerCase());
        const matches = w.queues.filter(
          (q) =>
            (i.direction === "both" || q.direction === i.direction) &&
            eq(q.document, i.document) &&
            (!i.nameContains || q.name.toUpperCase().includes(i.nameContains.toUpperCase())) &&
            (!i.onlyFailed || failed(q.status)),
        );
        const { rows, ...rest } = page(matches, i.limit);
        return { ...rest, queues: rows };
      },

      get_application_log: (i) => {
        const minimum = i.severity ? SEVERITY_RANK[i.severity] : 0;
        const matches = w.logs
          .filter(
            (m) =>
              eq(m.externalId, i.externalId) &&
              eq(m.object, i.object) &&
              SEVERITY_RANK[m.severity] >= minimum &&
              inWindow(m.timestamp, i.from, i.to),
          )
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const { rows, ...rest } = page(matches, i.limit);
        return { ...rest, messages: rows };
      },

      get_ppf_actions: (i) => {
        const actions = w.ppfActions.filter((a) => a.document === i.document);
        return { count: actions.length, actions };
      },

      get_abap_dump: (i) => {
        const matches = w.dumps.filter(
          (d) =>
            inWindow(d.timestamp, i.from, i.to) &&
            eq(d.user, i.user) &&
            (!i.program || (d.program ?? "").toUpperCase().includes(i.program.toUpperCase())),
        );
        const { rows, ...rest } = page(matches, i.limit);
        return { ...rest, dumps: rows };
      },

      get_configuration: (i) => {
        const entries = w.configuration
          .filter((c) => c.area === i.area && eq(c.warehouse, i.warehouse))
          .map((c) => c.entry)
          .filter((entry) =>
            Object.entries(i.filters ?? {}).every(([field, value]) =>
              eq(String(entry[field] ?? ""), value),
            ),
          );
        return { area: i.area, warehouse: i.warehouse, count: entries.length, entries };
      },
    };
  }

  unsupportedReason(toolName: string): string | null {
    return toolName in this.handlers
      ? null
      : `The simulated system has no tool called ${toolName}.`;
  }

  /** The simulator answers as whatever system it was registered as. */
  async identify() {
    return { sid: this.system.sid, client: this.system.client };
  }

  async execute(toolName: string, input: unknown, _signal?: AbortSignal): Promise<unknown> {
    const handler = this.handlers[toolName as ToolName] as
      ((input: unknown) => unknown) | undefined;
    if (!handler)
      throw new AdapterError(
        "not_supported",
        `The simulated system has no tool called ${toolName}.`,
      );
    // Hand out copies so a caller can never alter the scenario data.
    return structuredClone(handler(input));
  }

  /** A task belongs to a warehouse through its delivery or its warehouse order. */
  private inWarehouse(delivery: string | null, order: string | null, warehouse: string): boolean {
    const w = this.world;
    const viaDelivery = delivery
      ? w.deliveries.find((d) => d.number === delivery)?.warehouse
      : undefined;
    const viaOrder = order
      ? w.orders.find((o) => o.warehouseOrder === order)?.warehouse
      : undefined;
    const known = viaDelivery ?? viaOrder;
    return known === undefined || known === null || known.toUpperCase() === warehouse.toUpperCase();
  }
}
