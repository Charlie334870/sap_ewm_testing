import { describe, expect, it } from "vitest";
import { auditHash, canonicalJson, type AuditContent } from "./canonical";

const entry: AuditContent = {
  organizationId: "org",
  seq: 1,
  projectId: null,
  actorType: "user",
  actorUserId: "u1",
  action: "ticket.created",
  entityType: "ticket",
  entityId: "t1",
  data: { b: 2, a: { z: 1, y: [3, { k: "v", j: null }] } },
  ip: null,
  createdAt: new Date("2026-10-07T12:00:00.000Z"),
};

describe("canonical JSON", () => {
  it("does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});

describe("audit hash", () => {
  it("is stable when the data keys are reordered, as PostgreSQL jsonb does", () => {
    const reordered = { ...entry, data: { a: { y: [3, { j: null, k: "v" }], z: 1 }, b: 2 } };
    expect(auditHash("", reordered)).toBe(auditHash("", entry));
  });

  it("ignores properties that are not part of the entry content", () => {
    const row = { ...entry, id: "row-id", hash: "h", prevHash: "p" };
    expect(auditHash("", row)).toBe(auditHash("", entry));
  });

  it("changes when any field or the previous hash changes", () => {
    const base = auditHash("prev", entry);
    expect(auditHash("other", entry)).not.toBe(base);
    expect(auditHash("prev", { ...entry, action: "ticket.deleted" })).not.toBe(base);
    expect(auditHash("prev", { ...entry, data: { b: 3 } })).not.toBe(base);
    expect(auditHash("prev", { ...entry, seq: 2 })).not.toBe(base);
    expect(
      auditHash("prev", { ...entry, createdAt: new Date("2026-10-07T12:00:00.001Z") }),
    ).not.toBe(base);
  });
});
