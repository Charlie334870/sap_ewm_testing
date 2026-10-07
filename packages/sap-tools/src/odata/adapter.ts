import type { SapAdapter } from "../adapter";
import type { ToolName } from "../contracts";
import { requireBinding, unsupportedReason } from "./bindings";
import { ODataClient, type ODataConnection } from "./client";

/** Hosts a sandbox connection may point at. Anything else is refused before a request is made. */
export const SANDBOX_HOSTS = ["sandbox.api.sap.com"];

export function assertSandboxUrl(
  baseUrl: string,
  allowedHosts: readonly string[] = SANDBOX_HOSTS,
): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("The address is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("The address must start with https://.");
  if (!allowedHosts.includes(url.hostname)) {
    throw new Error(
      `Only SAP's API sandbox can be connected in this build (${allowedHosts.join(", ")}).`,
    );
  }
  return url;
}

/**
 * Real connection to SAP's public API sandbox (SAP Business Accelerator Hub).
 *
 * The responses come from SAP software and SAP's demo data. It is not a customer system: there
 * is no system ID to check, the data cannot be changed, and only APIs that SAP has released are
 * reachable. Results are labelled SAP_SANDBOX.
 */
export class SapApiSandboxAdapter implements SapAdapter {
  readonly source = "SAP_SANDBOX" as const;
  readonly client: ODataClient;

  constructor(connection: ODataConnection) {
    this.client = new ODataClient(connection);
  }

  unsupportedReason(toolName: string): string | null {
    return unsupportedReason(toolName);
  }

  /** The sandbox has no way of saying which system it is. */
  async identify() {
    return null;
  }

  async execute(toolName: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const binding = requireBinding(toolName as ToolName) as (
      c: ODataClient,
      i: unknown,
      s: AbortSignal,
    ) => Promise<unknown>;
    return binding(this.client, input, signal);
  }
}

/** How the sandbox expects the key: one header named APIKey. */
export const sandboxHeaders = (apiKey: string) => ({ APIKey: apiKey });
