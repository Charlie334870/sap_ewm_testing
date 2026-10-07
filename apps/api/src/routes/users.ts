import type { FastifyInstance } from "fastify";
import { createUserSchema, resetPasswordSchema, updateUserSchema } from "@ewm/shared";
import { isUuid, requireOrgAdmin } from "../access";
import { parse, requireUser, type AppDeps } from "../context";
import { notFound } from "../errors";
import * as users from "../services/users";

export function userRoutes(app: FastifyInstance, { db, scryptN }: AppDeps) {
  app.get("/users", async (req) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    return { users: await users.listUsers(db, user.organizationId) };
  });

  app.post("/users", async (req, reply) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    const input = parse(createUserSchema, req.body);
    const created = await users.createUser(db, user, input, { ip: req.ip, scryptN });
    return reply.code(201).send({ user: created });
  });

  app.patch<{ Params: { userId: string } }>("/users/:userId", async (req) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    if (!isUuid(req.params.userId)) throw notFound("User");
    const input = parse(updateUserSchema, req.body);
    return {
      user: await users.setUserActive(db, user, req.params.userId, input.isActive, { ip: req.ip }),
    };
  });

  app.post<{ Params: { userId: string } }>("/users/:userId/reset-password", async (req) => {
    const user = requireUser(req);
    requireOrgAdmin(user);
    if (!isUuid(req.params.userId)) throw notFound("User");
    const input = parse(resetPasswordSchema, req.body);
    await users.resetPassword(db, user, req.params.userId, input.password, { ip: req.ip, scryptN });
    return { ok: true };
  });
}
