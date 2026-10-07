import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAudit, verifyAuditChain } from "@ewm/audit";
import { schema } from "@ewm/database";
import {
  createOrg,
  createProjectWithTeam,
  createTestContext,
  createUser,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const actionsOf = async (organizationId: string) =>
  (
    await ctx.database.db
      .select({ seq: schema.auditLogs.seq, action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, organizationId))
      .orderBy(schema.auditLogs.seq)
  ).map((r) => r.action);

describe("audit log", () => {
  it("records every state-changing request, in order", async () => {
    const team = await createProjectWithTeam(ctx, "AUD");
    const p = `/projects/${team.project.id}`;
    const before = (await actionsOf(team.org.id)).length;

    const system = await team.admin.post(`${p}/sap-systems`, {
      name: "Dev",
      sid: "S4D",
      client: "100",
      environment: "DEV",
    });
    const ticket = (await team.analyst.post(`${p}/tickets`, { title: "Queue stuck" })).json()
      .ticket;
    await team.analyst.post(`${p}/tickets/${ticket.id}/comments`, { body: "Still stuck" });
    await team.consultant.post(`${p}/tickets/${ticket.id}/status`, { status: "investigating" });
    const extra = await createUser(ctx, team.org.id);
    await team.admin.put(`${p}/members`, { userId: extra.id, role: "analyst" });
    await team.admin.put(`${p}/members`, { userId: extra.id, role: "consultant" });
    await team.admin.delete(`${p}/members/${extra.id}`);
    await team.orgAdmin.post("/users", {
      email: `audited-${Date.now()}@example.test`,
      name: "Audited",
      password: "long-enough-password",
    });
    await team.analyst.post("/auth/logout");

    expect((await actionsOf(team.org.id)).slice(before)).toEqual([
      "sap_system.created",
      "ticket.created",
      "ticket.commented",
      "ticket.status_changed",
      "member.added",
      "member.role_changed",
      "member.removed",
      "user.created",
      "auth.logout",
    ]);

    const log = (await team.consultant.get(`${p}/audit-logs`)).json().entries;
    const created = log.find((e: { action: string }) => e.action === "ticket.created");
    expect(created).toMatchObject({
      actorName: "The analyst",
      entityType: "ticket",
      entityId: ticket.id,
      projectKey: "AUD",
      data: { reference: "AUD-1" },
    });
    const statusChange = log.find((e: { action: string }) => e.action === "ticket.status_changed");
    expect(statusChange.data).toEqual({ reference: "AUD-1", from: "open", to: "investigating" });
    expect(
      log.find((e: { action: string }) => e.action === "ticket.commented").data.reference,
    ).toBe("AUD-1");
    expect(system.statusCode).toBe(201);
  });

  it("writes nothing when the change itself fails", async () => {
    const team = await createProjectWithTeam(ctx, "FAIL");
    const p = `/projects/${team.project.id}`;
    const before = await actionsOf(team.org.id);

    expect(
      (await team.orgAdmin.post("/projects", { key: "FAIL", name: "Duplicate key" })).statusCode,
    ).toBe(409);
    expect((await team.analyst.post(`${p}/tickets`, { title: "" })).statusCode).toBe(400);
    expect(
      (
        await team.analyst.post(`${p}/sap-systems`, {
          name: "x",
          sid: "S4D",
          client: "100",
          environment: "DEV",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await team.admin.post(`${p}/sap-systems`, {
          name: "x",
          sid: "PRD",
          client: "100",
          environment: "PROD",
          adapter: "sap",
        })
      ).statusCode,
    ).toBe(400);

    expect(await actionsOf(team.org.id)).toEqual(before);
  });

  it("never stores a password or session token", async () => {
    const team = await createProjectWithTeam(ctx, "SEC");
    await team.orgAdmin.post("/users", {
      email: `secret-${Date.now()}@example.test`,
      name: "Secret",
      password: "super-secret-password-123",
    });
    const rows = await ctx.database.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, team.org.id));
    const text = JSON.stringify(rows);
    expect(text).not.toContain("super-secret-password-123");
    expect(text).not.toContain("scrypt$");
    expect(text).not.toContain(team.orgAdmin.cookie.split("=")[1]);
  });

  it("pages through entries newest first", async () => {
    const team = await createProjectWithTeam(ctx, "PAGE");
    const p = `/projects/${team.project.id}`;
    for (let i = 0; i < 5; i++) await team.analyst.post(`${p}/tickets`, { title: `T${i}` });
    const first = (await team.consultant.get(`${p}/audit-logs?limit=3`)).json();
    expect(first.entries).toHaveLength(3);
    expect(first.nextBefore).toBe(first.entries[2].seq);
    const second = (
      await team.consultant.get(`${p}/audit-logs?limit=3&before=${first.nextBefore}`)
    ).json();
    const seqs = [...first.entries, ...second.entries].map((e: { seq: number }) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => y - x));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("audit log integrity", () => {
  it("verifies an untouched chain", async () => {
    const team = await createProjectWithTeam(ctx, "OK");
    const res = await team.orgAdmin.get("/audit-logs/verify");
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().entries).toBeGreaterThan(5);
  });

  it("keeps sequence numbers gap-free when many changes arrive together", async () => {
    const org = await createOrg(ctx);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        ctx.database.db.transaction((tx) =>
          appendAudit(tx, {
            organizationId: org.id,
            actorType: "system",
            action: "test.parallel",
            entityType: "test",
            data: { i },
          }),
        ),
      ),
    );
    const result = await verifyAuditChain(ctx.database.db, org.id);
    expect(result).toEqual({ ok: true, entries: 25 });
  });

  it("rejects UPDATE, DELETE and TRUNCATE on the audit table", async () => {
    const org = await createOrg(ctx);
    await ctx.database.db.transaction((tx) =>
      appendAudit(tx, {
        organizationId: org.id,
        actorType: "system",
        action: "test.entry",
        entityType: "test",
      }),
    );
    const { db } = ctx.database;
    await expect(
      db.execute(sql`update audit_logs set action = 'changed' where organization_id = ${org.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from audit_logs where organization_id = ${org.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`truncate audit_logs`)).rejects.toThrow();
    expect(await actionsOf(org.id)).toEqual(["test.entry"]);
  });

  it("detects an entry that was altered by someone who bypassed the trigger", async () => {
    const org = await createOrg(ctx);
    for (const action of ["test.one", "test.two", "test.three"]) {
      await ctx.database.db.transaction((tx) =>
        appendAudit(tx, {
          organizationId: org.id,
          actorType: "system",
          action,
          entityType: "test",
          data: { amount: 1 },
        }),
      );
    }
    expect((await verifyAuditChain(ctx.database.db, org.id)).ok).toBe(true);

    // What a database administrator with full rights could do.
    await ctx.database.db.transaction(async (tx) => {
      await tx.execute(sql`alter table audit_logs disable trigger audit_logs_no_update_delete`);
      await tx.execute(
        sql`update audit_logs set data = '{"amount": 999}' where organization_id = ${org.id} and seq = 2`,
      );
      await tx.execute(sql`alter table audit_logs enable trigger audit_logs_no_update_delete`);
    });

    const result = await verifyAuditChain(ctx.database.db, org.id);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it("detects a removed entry", async () => {
    const org = await createOrg(ctx);
    for (const action of ["test.one", "test.two", "test.three"]) {
      await ctx.database.db.transaction((tx) =>
        appendAudit(tx, {
          organizationId: org.id,
          actorType: "system",
          action,
          entityType: "test",
        }),
      );
    }
    await ctx.database.db.transaction(async (tx) => {
      await tx.execute(sql`alter table audit_logs disable trigger audit_logs_no_update_delete`);
      await tx.execute(sql`delete from audit_logs where organization_id = ${org.id} and seq = 2`);
      await tx.execute(sql`alter table audit_logs enable trigger audit_logs_no_update_delete`);
    });
    const result = await verifyAuditChain(ctx.database.db, org.id);
    expect(result).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });
});
