import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findTool, SCENARIO_PACKS, SimulatedSapAdapter } from "@ewm/sap-tools";
import { ANSWER_KEYS } from "./answer-keys";

const adapter = new SimulatedSapAdapter({ id: "sys", sid: "S4D", client: "100", baseUrl: null });

function at(value: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], value);
}

describe("scenario packs", () => {
  it("each have exactly one answer key", () => {
    expect(ANSWER_KEYS.map((k) => k.packId).sort()).toEqual(SCENARIO_PACKS.map((p) => p.id).sort());
  });

  for (const key of ANSWER_KEYS) {
    describe(key.packId, () => {
      for (const evidence of key.evidence) {
        it(`can be solved with the tools: ${evidence.shows}`, async () => {
          const tool = findTool(evidence.tool)!;
          const result = tool.output.parse(
            await adapter.execute(
              tool.name,
              tool.input.parse(evidence.input),
              new AbortController().signal,
            ),
          );
          for (const [where, expected] of Object.entries(evidence.expect)) {
            expect(at(result, where), `${evidence.tool} ${where}`).toEqual(expected);
          }
        });
      }

      it("has a ticket that states the symptom and does not give the cause away", () => {
        const pack = SCENARIO_PACKS.find((p) => p.id === key.packId)!;
        const ticket = `${pack.ticket.title} ${pack.ticket.description}`.toLowerCase();
        for (const giveaway of [
          "q4",
          "quality inspection",
          "posting period",
          "zsmp",
          "item type",
          "determination",
          "queue",
        ]) {
          expect(ticket, giveaway).not.toContain(giveaway);
        }
      });
    });
  }
});

describe("answer keys stay out of the running system", () => {
  it("no app or package imports them", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", "dist", ".git"].includes(name)) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          /\.(ts|tsx|mjs|json)$/.test(name) &&
          /(from|import\(|require\()\s*["'][^"']*(answer-keys|tests\/scenarios)/.test(
            readFileSync(full, "utf8"),
          )
        )
          offenders.push(full);
      }
    };
    walk(path.join(root, "apps"));
    walk(path.join(root, "packages"));
    expect(offenders).toEqual([]);
  });
});
