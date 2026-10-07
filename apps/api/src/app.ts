import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { SESSION_COOKIE } from "@ewm/auth";
import type { AppDeps } from "./context";
import { AppError, forbidden } from "./errors";
import { auditRoutes } from "./routes/audit";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { userRoutes } from "./routes/users";
import { resolveSession } from "./services/auth";

export interface BuildOptions extends AppDeps {
  /** Login attempts allowed per minute per address. */
  loginRateLimit?: number;
  trustProxy?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { db, config } = opts;
  const app = Fastify({
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 1024 * 1024,
    logger: {
      level: config.logLevel,
      // Secrets must never reach the logs.
      redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
    },
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);

  app.addHook("onRequest", async (req) => {
    // A browser sends Origin on state-changing requests. Refuse those from other sites.
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && !config.webOrigins.includes(origin)) {
      throw forbidden("This request came from a site that is not allowed.");
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const session = await resolveSession(db, token);
      if (session) {
        req.user = session.user;
        req.sessionId = session.sessionId;
      }
    }
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code = status === 429 ? "too_many_requests" : "bad_request";
      const message =
        status === 429 ? "Too many attempts. Wait a minute and try again." : err.message;
      return reply.code(status).send({ error: { code, message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply
      .code(500)
      .send({ error: { code: "internal_error", message: "Something went wrong on the server." } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "This address does not exist." } }),
  );

  app.get("/health", { logLevel: "warn" }, async () => {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  });

  await app.register(
    async (api) => {
      authRoutes(api, { ...opts, loginRateLimit: opts.loginRateLimit ?? 10 });
      userRoutes(api, opts);
      projectRoutes(api, opts);
      auditRoutes(api, opts);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
