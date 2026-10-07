import { describe, expect, it } from "vitest";
import { PROJECT_ROLES } from "@ewm/shared";
import {
  effectiveRole,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  roleAllows,
  verifyPassword,
} from "./index";

const fast = { N: 2 ** 10, r: 8, p: 1 };

describe("passwords", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("warehouse-order-4711", fast);
    expect(stored.startsWith("scrypt$1024$8$1$")).toBe(true);
    expect(stored).not.toContain("warehouse-order-4711");
    expect(await verifyPassword("warehouse-order-4711", stored)).toBe(true);
    expect(await verifyPassword("warehouse-order-4712", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same-password-twice", fast)).not.toBe(
      await hashPassword("same-password-twice", fast),
    );
  });

  it("rejects malformed stored values instead of throwing", async () => {
    for (const bad of ["", "plain", "scrypt$x$8$1$aa$bb", "bcrypt$1$2$3$4$5"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});

describe("session tokens", () => {
  it("are long, random and stored only as a hash", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(a)).toBe(hashSessionToken(a));
  });
});

describe("permissions", () => {
  it("orders the roles analyst < consultant < admin", () => {
    expect(PROJECT_ROLES.map((r) => roleAllows(r, "ticket.create"))).toEqual([true, true, true]);
    expect(PROJECT_ROLES.map((r) => roleAllows(r, "ticket.change_status"))).toEqual([
      false,
      true,
      true,
    ]);
    expect(PROJECT_ROLES.map((r) => roleAllows(r, "audit.view"))).toEqual([false, true, true]);
    expect(PROJECT_ROLES.map((r) => roleAllows(r, "sap_system.manage"))).toEqual([
      false,
      false,
      true,
    ]);
    expect(PROJECT_ROLES.map((r) => roleAllows(r, "member.manage"))).toEqual([false, false, true]);
  });

  it("gives no role across organisations, even to an administrator", () => {
    expect(
      effectiveRole({ isOrgAdmin: true, sameOrganization: false, memberRole: "admin" }),
    ).toBeNull();
    expect(effectiveRole({ isOrgAdmin: true, sameOrganization: true, memberRole: null })).toBe(
      "admin",
    );
    expect(
      effectiveRole({ isOrgAdmin: false, sameOrganization: true, memberRole: null }),
    ).toBeNull();
    expect(
      effectiveRole({ isOrgAdmin: false, sameOrganization: true, memberRole: "analyst" }),
    ).toBe("analyst");
  });
});
