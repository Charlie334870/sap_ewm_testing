import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import type { Database } from "@ewm/database";
import type { Config } from "./config";
import { badRequest, unauthorized } from "./errors";

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  isOrgAdmin: boolean;
}

export interface AppDeps {
  db: Database;
  config: Config;
  /** Cost of password hashing. Tests lower it to stay fast. */
  scryptN?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user, or null. Set by the session hook on every request. */
    user: AuthUser | null;
    sessionId: string | null;
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Validates input against a schema and returns the typed result, or throws a 400. */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      "Some fields are not valid.",
      result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
