import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addMemberSchema,
  changeTicketStatusSchema,
  commentSchema,
  createProjectSchema,
  createSapSystemSchema,
  createTicketSchema,
  pageQuerySchema,
  TICKET_STATUSES,
} from "@ewm/shared";
import { isUuid, requireOrgAdmin, requireProjectAccess } from "../access";
import { parse, requireUser, type AppDeps } from "../context";
import { notFound } from "../errors";
import { listAuditLogs } from "../services/audit-logs";
import * as projects from "../services/projects";
import * as sapSystems from "../services/sap-systems";
import * as tickets from "../services/tickets";

type P = { Params: { projectId: string } };
type PT = { Params: { projectId: string; ticketId: string } };
type PU = { Params: { projectId: string; userId: string } };

const ticketFilterSchema = z.object({ status: z.enum(TICKET_STATUSES).optional() });

export function projectRoutes(app: FastifyInstance, { db }: AppDeps) {
  // ------------------------------------------------------------ projects
  app.get("/projects", async (req) => ({
    projects: await projects.listProjects(db, requireUser(req)),
  }));

  app.post("/projects", async (req, reply) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    const input = parse(createProjectSchema, req.body);
    const project = await projects.createProject(db, user, input, { ip: req.ip });
    return reply.code(201).send({ project });
  });

  app.get<P>("/projects/:projectId", async (req) => {
    const { project, role } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    const [environments, members] = await Promise.all([
      projects.listEnvironments(db, project.id),
      projects.listMembers(db, project.id),
    ]);
    return {
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        role,
      },
      environments,
      members,
    };
  });

  app.get<P>("/projects/:projectId/summary", async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    return projects.projectSummary(db, project.id);
  });

  // ------------------------------------------------------------ members
  app.get<P>("/projects/:projectId/member-candidates", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(db, user, req.params.projectId, "member.manage");
    return { users: await projects.listMemberCandidates(db, user.organizationId, project.id) };
  });

  app.put<P>("/projects/:projectId/members", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(db, user, req.params.projectId, "member.manage");
    const input = parse(addMemberSchema, req.body);
    return { member: await projects.setMember(db, user, project.id, input, { ip: req.ip }) };
  });

  app.delete<PU>("/projects/:projectId/members/:userId", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(db, user, req.params.projectId, "member.manage");
    if (!isUuid(req.params.userId)) throw notFound("Member");
    await projects.removeMember(db, user, project.id, req.params.userId, { ip: req.ip });
    return { ok: true };
  });

  // ------------------------------------------------------------ SAP systems
  app.get<P>("/projects/:projectId/sap-systems", async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    return { sapSystems: await sapSystems.listSapSystems(db, project.id) };
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
    const sapSystem = await sapSystems.createSapSystem(db, user, project.id, input, { ip: req.ip });
    return reply.code(201).send({ sapSystem });
  });

  // ------------------------------------------------------------ tickets
  app.get<P>("/projects/:projectId/tickets", async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    const filter = parse(ticketFilterSchema, req.query);
    return { tickets: await tickets.listTickets(db, project.id, filter) };
  });

  app.post<P>("/projects/:projectId/tickets", async (req, reply) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(db, user, req.params.projectId, "ticket.create");
    const input = parse(createTicketSchema, req.body);
    const ticket = await tickets.createTicket(db, user, project.id, input, { ip: req.ip });
    return reply.code(201).send({ ticket });
  });

  app.get<PT>("/projects/:projectId/tickets/:ticketId", async (req) => {
    const { project } = await requireProjectAccess(
      db,
      requireUser(req),
      req.params.projectId,
      "project.view",
    );
    if (!isUuid(req.params.ticketId)) throw notFound("Ticket");
    const ticket = await tickets.getTicket(db, project.id, req.params.ticketId);
    return { ticket: { ...ticket, reference: `${project.key}-${ticket.number}` } };
  });

  app.post<PT>("/projects/:projectId/tickets/:ticketId/comments", async (req, reply) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "ticket.comment",
    );
    if (!isUuid(req.params.ticketId)) throw notFound("Ticket");
    const input = parse(commentSchema, req.body);
    const event = await tickets.addComment(db, user, project.id, req.params.ticketId, input.body, {
      ip: req.ip,
    });
    return reply.code(201).send({ event });
  });

  app.post<PT>("/projects/:projectId/tickets/:ticketId/status", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(
      db,
      user,
      req.params.projectId,
      "ticket.change_status",
    );
    if (!isUuid(req.params.ticketId)) throw notFound("Ticket");
    const input = parse(changeTicketStatusSchema, req.body);
    return {
      ticket: await tickets.changeStatus(db, user, project.id, req.params.ticketId, input, {
        ip: req.ip,
      }),
    };
  });

  // ------------------------------------------------------------ audit log of one project
  app.get<P>("/projects/:projectId/audit-logs", async (req) => {
    const user = requireUser(req);
    const { project } = await requireProjectAccess(db, user, req.params.projectId, "audit.view");
    const page = parse(pageQuerySchema, req.query);
    return listAuditLogs(db, { organizationId: user.organizationId, projectId: project.id }, page);
  });
}
