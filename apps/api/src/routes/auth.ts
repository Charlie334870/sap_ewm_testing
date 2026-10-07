import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "@ewm/auth";
import { changePasswordSchema, loginSchema } from "@ewm/shared";
import { parse, requireUser, type AppDeps } from "../context";
import * as auth from "../services/auth";

export function authRoutes(app: FastifyInstance, deps: AppDeps & { loginRateLimit: number }) {
  const { db, config } = deps;
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.cookieSecure,
  };

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: deps.loginRateLimit, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = parse(loginSchema, req.body);
      const result = await auth.login(db, input, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      reply.setCookie(SESSION_COOKIE, result.token, {
        ...cookieOptions,
        expires: result.expiresAt,
      });
      return { user: result.user };
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    if (req.user && req.sessionId) await auth.logout(db, req.user, req.sessionId, req.ip);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get("/auth/me", async (req) => ({ user: requireUser(req) }));

  app.post("/auth/change-password", async (req) => {
    const user = requireUser(req);
    const input = parse(changePasswordSchema, req.body);
    await auth.changePassword(db, user, req.sessionId!, input, {
      ip: req.ip,
      scryptN: deps.scryptN,
    });
    return { ok: true };
  });
}
