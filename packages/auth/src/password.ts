import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt from the Node.js standard library (no native add-ons to build).
 * Stored format: scrypt$N$r$p$<salt b64>$<hash b64>. The parameters travel with the hash, so
 * they can be raised later without invalidating existing passwords.
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** OWASP password storage guidance lists N=2^15, r=8, p=3 as an acceptable scrypt setting. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(
  password: string,
  params = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const actual = await derive(password, salt, { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
