import { describe, expect, it } from "vitest";
import { describeTools, findTool, TOOLS } from "./contracts";

describe("tool contracts", () => {
  it("offers only read-only tools at authorisation level 0", () => {
    expect(TOOLS.length).toBe(11);
    for (const tool of TOOLS) {
      expect(tool.access, tool.name).toBe("read");
      expect(tool.authLevel, tool.name).toBe(0);
      expect(tool.timeoutMs, tool.name).toBeGreaterThan(0);
      expect(tool.name).toMatch(/^get_[a-z_]+$/);
    }
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("describes every tool with a JSON schema an agent can read", () => {
    for (const tool of describeTools()) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(Object.keys(tool.inputSchema.properties as object).length, tool.name).toBeGreaterThan(
        0,
      );
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it("normalises and validates input", () => {
    const tasks = findTool("get_warehouse_tasks")!;
    expect(tasks.input.parse({ warehouse: " muhw ", delivery: "80001001" })).toMatchObject({
      warehouse: "MUHW",
      limit: 50,
    });
    expect(tasks.input.safeParse({ warehouse: "MUHW" }).success).toBe(false); // nothing to select by
    expect(tasks.input.safeParse({ warehouse: "TOO-LONG", delivery: "1" }).success).toBe(false);
    expect(tasks.input.safeParse({ warehouse: "MUHW", delivery: "1", limit: 5000 }).success).toBe(
      false,
    );

    const config = findTool("get_configuration")!;
    expect(config.input.safeParse({ area: "any_table_i_like", warehouse: "MUHW" }).success).toBe(
      false,
    );
    expect(findTool("drop_table")).toBeUndefined();
  });
});
