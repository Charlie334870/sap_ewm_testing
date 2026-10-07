import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts connection secrets (such as an SAP API key) before they are stored.
 *
 * AES-256-GCM with a key that lives outside the database, in the SECRETS_KEY setting. Someone
 * who obtains only the database cannot read the secrets. Stored form: iv.tag.ciphertext, each
 * part base64.
 */
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}

export function createSecretBox(keyHex: string): SecretBox {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("SECRETS_KEY must be 64 hexadecimal characters (32 random bytes).");
  }
  const key = Buffer.from(keyHex, "hex");
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(".");
    },
    decrypt(stored) {
      const [iv, tag, data] = stored.split(".").map((part) => Buffer.from(part, "base64"));
      if (!iv || !tag || !data) throw new Error("Stored secret is not in the expected format.");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}
