import type { FastifyInstance } from "fastify";
import { verifyAuditChain } from "@ewm/audit";
import { pageQuerySchema } from "@ewm/shared";
import { requireOrgAdmin } from "../access";
import { parse, requireUser, type AppDeps } from "../context";
import { listAuditLogs } from "../services/audit-logs";

/** Organisation-wide audit views. Project-scoped audit lives with the project routes. */
export function auditRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get("/audit-logs", async (req) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    const page = parse(pageQuerySchema, req.query);
    return listAuditLogs(db, { organizationId: user.organizationId }, page);
  });

  app.get("/audit-logs/verify", async (req) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    return verifyAuditChain(db, user.organizationId);
  });
}
