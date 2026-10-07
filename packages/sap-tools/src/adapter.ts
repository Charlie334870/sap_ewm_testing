import type { DataSource } from "@ewm/shared";

/** What an adapter is told about the system it should reach. Never contains a secret. */
export interface SystemRef {
  id: string;
  sid: string;
  client: string;
  baseUrl: string | null;
}

/**
 * One way of reaching a system. The gateway is the only caller.
 *
 * An adapter returns plain data for a tool or throws an AdapterError. It does not validate its
 * own output, decide authorisation, retry or write audit records; the gateway does all of that
 * the same way for every adapter.
 */
export interface SapAdapter {
  readonly source: DataSource;
  /** null when the tool is available; otherwise the reason it is not, for the person to read. */
  unsupportedReason(toolName: string): string | null;
  /**
   * The system's own statement of which system it is, used to check that the registered system
   * ID and client are really the ones answering. null when the connection has no way to tell.
   */
  identify(signal: AbortSignal): Promise<{ sid: string; client: string } | null>;
  execute(toolName: string, input: unknown, signal: AbortSignal): Promise<unknown>;
}

export type AdapterErrorCode =
  | "authentication_failed"
  | "service_unavailable"
  | "not_supported"
  | "network"
  | "sap_error"
  | "unexpected_data";

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    /** True when trying again could help (network trouble, server busy). */
    public readonly transient = false,
  ) {
    super(message);
  }
}
