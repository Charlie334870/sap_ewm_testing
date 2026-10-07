import type { FastifyInstance } from "fastify";
import { describeTools, findTool } from "@ewm/sap-tools";
import {
  createApiTokenSchema,
  createSapSystemSchema,
  runToolSchema,
  toolCallListQuerySchema,
  updateSapCredentialSchema,
} from "@ewm/shared";
import { isUuid, requireProjectAccess } from "../access";
import { parse, requireUser, type AppDeps } from "../context";
import { forbidden, notFound } from "../errors";
import * as apiTokens from "../services/api-tokens";
import * as sapSystems from "../services/sap-systems";
import * as tickets from "../services/tickets";
import * as tools from "../services/tools";

type P = { Params: { projectId: string } };
type PS = { Params: { projectId: string; systemId: string } };
type PST = { Params: { projectId: string; systemId: string; toolName: string } };
type PI = { Params: { projectId: string; id: string } };

const token = { config: { tokenAllowed: true } };

/** SAP systems, the tools that read from them, and access for outside agents. */
export function sapRoutes(app: FastifyInstance, deps: AppDeps & { toolRateLimit: number }) {
  const { db } = deps;

  // ------------------------------------------------------------ tool catalogue
  app.get("/tools", token, async (req) => {
    requireUser(req);
    return { tools: describeTools() };
  });

  // ------------------------------------------------------------ SAP systems
  app.get<P>("/projects/:projectId/sap-systems", token, async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    return {
      sapSystems: await sapSystems.listSapSystems(db, project.id),
      canStoreSecrets: deps.secrets !== null,
    };
  });

  app.post<P>("/projects/:projectId/sap-systems", async (req, reply) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "sap_system.manage",
    );
    const input = parse(createSapSystemSchema, req.body);
    const sapSystem = await sapSystems.createSapSystem(deps, user, project.id, input, {
      ip: req.ip,
    });
    return reply.code(201).send({ sapSystem });
  });

  app.get<PS>("/projects/:projectId/sap-systems/:systemId", token, async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    if (!isUuid(req.params.systemId)) throw notFound("SAP system");
    return { sapSystem: await sapSystems.getSapSystem(deps, project.id, req.params.systemId) };
  });

  app.put<PS>("/projects/:projectId/sap-systems/:systemId/credential", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "sap_system.manage",
    );
    if (!isUuid(req.params.systemId)) throw notFound("SAP system");
    const input = parse(updateSapCredentialSchema, req.body);
    await sapSystems.updateCredential(deps, user, project.id, req.params.systemId, input.apiKey, {
      ip: req.ip,
    });
    return { ok: true };
  });

  app.post<PS>("/projects/:projectId/sap-systems/:systemId/test", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(db, user, req.params.projectId, "tool.execute");
    if (!isUuid(req.params.systemId)) throw notFound("SAP system");
    return {
      check: await sapSystems.testConnection(deps, user, project.id, req.params.systemId, {
        ip: req.ip,
      }),
    };
  });

  app.post<PS>("/projects/:projectId/sap-systems/:systemId/sample-tickets", async (req, reply) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "sap_system.manage",
    );
    if (!isUuid(req.params.systemId)) throw notFound("SAP system");
    return reply.code(201).send(
      await sapSystems.createSampleTickets(deps, user, project.id, req.params.systemId, {
        ip: req.ip,
      }),
    );
  });

  // ------------------------------------------------------------ running tools
  app.post<PST>(
    "/projects/:projectId/sap-systems/:systemId/tools/:toolName",
    {
      config: {
        tokenAllowed: true,
        rateLimit: {
          max: deps.toolRateLimit,
          timeWindow: "1 minute",
          keyGenerator: (req) => `tool:${req.user?.id ?? req.ip}`,
        },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { project } = await requireProjectAccess(
        db,
        user,
        req.params.projectId,
        "tool.execute",
      );
      if (!isUuid(req.params.systemId)) throw notFound("SAP system");
      if (!findTool(req.params.toolName)) throw notFound("Tool");
      const body = parse(runToolSchema, req.body ?? {});
      return {
        result: await tools.runTool(
          deps,
          user,
          project.id,
          req.params.systemId,
          req.params.toolName,
          body,
        ),
      };
    },
  );

  app.get<P>("/projects/:projectId/tool-calls", async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "tool_call.view",
    );
    const filter = parse(toolCallListQuerySchema, req.query);
    return { toolCalls: await tools.listToolCalls(db, project.id, filter) };
  });

  app.get<PI>("/projects/:projectId/tool-calls/:id", async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "tool_call.view",
    );
    if (!isUuid(req.params.id)) throw notFound("Tool call");
    return { toolCall: await tools.getToolCall(db, project.id, req.params.id) };
  });

  // ------------------------------------------------------------ agent access tokens
  app.get<P>("/projects/:projectId/api-tokens", async (req) => {
    const user = requireUser(req);
    const { project, role } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "api_token.manage",
    );
    return {
      tokens: await apiTokens.listApiTokens(db, project.id, {
        id: user.id,
        seesAll: role === "admin",
      }),
    };
  });

  app.post<P>("/projects/:projectId/api-tokens", async (req, reply) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "api_token.manage",
    );
    const input = parse(createApiTokenSchema, req.body);
    return reply
      .code(201)
      .send({ token: await apiTokens.createApiToken(db, user, project.id, input, { ip: req.ip }) });
  });

  app.delete<PI>("/projects/:projectId/api-tokens/:id", async (req) => {
    const user = requireUser(req);
    const { project, role } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "api_token.manage",
    );
    if (!isUuid(req.params.id)) throw notFound("Token");
    await apiTokens.revokeApiToken(db, user, project.id, req.params.id, {
      ip: req.ip,
      mayRevokeOthers: role === "admin",
    });
    return { ok: true };
  });

  // ------------------------------------------------------------ what an agent can see
  /**
   * Everything an outside agent needs to start: the project its token belongs to, the systems
   * it can read, the tools, and the open tickets. Only reachable with an agent access token.
   */
  app.get("/agent/context", token, async (req) => {
    const user = requireUser(req);
    if (!user.token) throw forbidden("This address is for agent access tokens.");
    const { project, role } = await requireProjectAccess(
      db,
      user,
      user.token.projectId,
      "tool.execute",
    );
    const systems = await sapSystems.listSapSystems(db, project.id);
    return {
      project: { id: project.id, key: project.key, name: project.name },
      actingFor: { name: user.name, role },
      sapSystems: await Promise.all(
        systems.map(async (s) => {
          const detail = await sapSystems.getSapSystem(deps, project.id, s.id);
          return {
            id: s.id,
            name: s.name,
            sid: s.sid,
            client: s.client,
            environment: s.environment,
            source: s.source,
            toolsAvailable: detail.tools.filter((t) => t.available).map((t) => t.name),
          };
        }),
      ),
      tools: describeTools(),
      openTickets: (await tickets.listTickets(db, project.id))
        .filter((t) => t.status !== "closed" && t.status !== "resolved")
        .map((t) => ({
          id: t.id,
          reference: `${project.key}-${t.number}`,
          title: t.title,
          status: t.status,
          priority: t.priority,
        })),
    };
  });
}
