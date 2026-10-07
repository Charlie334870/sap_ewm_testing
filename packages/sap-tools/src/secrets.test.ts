import { describe, expect, it } from "vitest";
import { createSecretBox } from "./secrets";

const KEY = "0123456789abcdef".repeat(4);

describe("secret box", () => {
  it("encrypts so the secret is not readable and decrypts it again", () => {
    const box = createSecretBox(KEY);
    const stored = box.encrypt("my-sap-api-key-123");
    expect(stored).not.toContain("my-sap-api-key-123");
    expect(box.decrypt(stored)).toBe("my-sap-api-key-123");
    expect(box.encrypt("my-sap-api-key-123")).not.toBe(stored); // fresh nonce every time
  });

  it("refuses a value that was altered or encrypted with another key", () => {
    const stored = createSecretBox(KEY).encrypt("secret");
    const [iv, tag, data] = stored.split(".");
    const flipped = Buffer.from(data!, "base64");
    flipped[0]! ^= 1;
    expect(() => createSecretBox(KEY).decrypt([iv, tag, flipped.toString("base64")].join("."))).toThrow();
    expect(() => createSecretBox("f".repeat(64)).decrypt(stored)).toThrow();
  });

  it("refuses a key of the wrong size", () => {
    expect(() => createSecretBox("abc")).toThrow(/64 hexadecimal/);
  });
});
