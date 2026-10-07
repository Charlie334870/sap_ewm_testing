import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOrg,
  createProjectWithTeam,
  createTestContext,
  createUser,
  signIn,
  type Client,
  type TestContext,
} from "./helpers";

/**
 * Master prompt, section 26: knowledge and data of Project A must never reach Project B.
 * Three kinds of outsider are tried against Project A:
 *   - a colleague in the same organisation with no membership,
 *   - a member of a different project in the same organisation,
 *   - an administrator of a different organisation.
 */
let ctx: TestContext;
let a: Awaited<ReturnType<typeof createProjectWithTeam>>;
let ticketA: string;
let systemA: string;
let colleague: Client;
let memberOfB: Client;
let projectB: { id: string };
let foreignAdmin: Client;

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createProjectWithTeam(ctx, "ALPHA");
  ticketA = (
    await a.analyst.post(`/projects/${a.project.id}/tickets`, {
      title: "Confidential issue at client A",
    })
  ).json().ticket.id;
  systemA = (
    await a.admin.post(`/projects/${a.project.id}/sap-systems`, {
      name: "A Dev",
      sid: "A4D",
      client: "100",
      environment: "DEV",
    })
  ).json().sapSystem.id;

  colleague = await signIn(ctx, await createUser(ctx, a.org.id));

  projectB = (await a.orgAdmin.post("/projects", { key: "BETA", name: "Project B" })).json()
    .project;
  const bUser = await createUser(ctx, a.org.id);
  await a.orgAdmin.put(`/projects/${projectB.id}/members`, { userId: bUser.id, role: "admin" });
  memberOfB = await signIn(ctx, bUser);

  const otherOrg = await createOrg(ctx, "Competitor");
  foreignAdmin = await signIn(ctx, await createUser(ctx, otherOrg.id, { isOrgAdmin: true }));
});
afterAll(() => ctx.close());

describe("project isolation", () => {
  it("answers 'not found' for every route of a project the user cannot see", async () => {
    const p = `/projects/${a.project.id}`;
    const outsiders: Array<[string, Client]> = [
      ["colleague without membership", colleague],
      ["member of another project", memberOfB],
      ["administrator of another organisation", foreignAdmin],
    ];
    for (const [who, client] of outsiders) {
      const attempts = [
        await client.get(p),
        await client.get(`${p}/summary`),
        await client.get(`${p}/tickets`),
        await client.get(`${p}/tickets/${ticketA}`),
        await client.get(`${p}/sap-systems`),
        await client.get(`${p}/audit-logs`),
        await client.get(`${p}/member-candidates`),
        await client.post(`${p}/tickets`, { title: "Injected ticket" }),
        await client.post(`${p}/tickets/${ticketA}/comments`, { body: "Injected comment" }),
        await client.post(`${p}/tickets/${ticketA}/status`, { status: "closed" }),
        await client.post(`${p}/sap-systems`, {
          name: "X",
          sid: "X4D",
          client: "100",
          environment: "DEV",
        }),
        await client.put(`${p}/members`, { userId: client.userId, role: "admin" }),
        await client.delete(`${p}/members/${a.analyst.userId}`),
      ];
      for (const res of attempts) {
        expect(res.statusCode, `${who}: ${res.raw.req?.url ?? ""}`).toBe(404);
        expect(res.body, who).not.toContain("Confidential");
      }
    }
  });

  it("looks exactly the same as a project that does not exist", async () => {
    const hidden = await colleague.get(`/projects/${a.project.id}`);
    const missing = await colleague.get("/projects/00000000-0000-4000-8000-000000000000");
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  });

  it("lists only the projects the user belongs to", async () => {
    expect((await colleague.get("/projects")).json().projects).toEqual([]);
    expect((await foreignAdmin.get("/projects")).json().projects).toEqual([]);
    const forB = (await memberOfB.get("/projects"))
      .json()
      .projects.map((p: { id: string }) => p.id);
    expect(forB).toEqual([projectB.id]);
    const forAnalyst = (await a.analyst.get("/projects"))
      .json()
      .projects.map((p: { id: string }) => p.id);
    expect(forAnalyst).toEqual([a.project.id]);
  });

  it("does not serve a ticket of Project A through the address of Project B", async () => {
    const res = await memberOfB.get(`/projects/${projectB.id}/tickets/${ticketA}`);
    expect(res.statusCode).toBe(404);
    const comment = await memberOfB.post(`/projects/${projectB.id}/tickets/${ticketA}/comments`, {
      body: "Hello",
    });
    expect(comment.statusCode).toBe(404);
    const status = await memberOfB.post(`/projects/${projectB.id}/tickets/${ticketA}/status`, {
      status: "closed",
    });
    expect(status.statusCode).toBe(404);
  });

  it("does not let a ticket in Project B point at an SAP system of Project A", async () => {
    const res = await memberOfB.post(`/projects/${projectB.id}/tickets`, {
      title: "Cross link",
      sapSystemId: systemA,
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not add a person from another organisation to a project", async () => {
    const res = await a.orgAdmin.put(`/projects/${a.project.id}/members`, {
      userId: foreignAdmin.userId,
      role: "analyst",
    });
    expect(res.statusCode).toBe(404);
  });

  it("keeps the audit log of each project and each organisation separate", async () => {
    const forB = (await memberOfB.get(`/projects/${projectB.id}/audit-logs`)).json().entries;
    expect(forB.length).toBeGreaterThan(0);
    expect(forB.every((e: { projectId: string }) => e.projectId === projectB.id)).toBe(true);

    const foreign = (await foreignAdmin.get("/audit-logs")).json().entries;
    expect(JSON.stringify(foreign)).not.toContain("ALPHA");
    expect(JSON.stringify(foreign)).not.toContain("Confidential");
  });

  it("lets two organisations use the same project key", async () => {
    const res = await foreignAdmin.post("/projects", { key: "ALPHA", name: "Their own Alpha" });
    expect(res.statusCode).toBe(201);
    const again = await a.orgAdmin.post("/projects", { key: "ALPHA", name: "Duplicate" });
    expect(again.statusCode).toBe(409);
  });

  it("removing a member ends their access immediately", async () => {
    const user = await createUser(ctx, a.org.id);
    await a.orgAdmin.put(`/projects/${a.project.id}/members`, {
      userId: user.id,
      role: "consultant",
    });
    const client = await signIn(ctx, user);
    expect((await client.get(`/projects/${a.project.id}/tickets/${ticketA}`)).statusCode).toBe(200);
    await a.orgAdmin.delete(`/projects/${a.project.id}/members/${user.id}`);
    expect((await client.get(`/projects/${a.project.id}/tickets/${ticketA}`)).statusCode).toBe(404);
  });
});
