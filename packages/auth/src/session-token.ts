import { createHash, randomBytes } from "node:crypto";

/** A new random session token. It goes into the user's cookie and is never stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores: a hash, so a leaked database does not leak usable sessions. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const SESSION_COOKIE = "ewm_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
