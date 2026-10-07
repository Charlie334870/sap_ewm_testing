/** The few calls the MCP server makes to the EWM Agent platform, all with the agent access token. */
export interface AgentContext {
  project: { id: string; key: string; name: string };
  actingFor: { name: string; role: string };
  sapSystems: Array<{
    id: string;
    name: string;
    sid: string;
    client: string;
    environment: string;
    source: "SIMULATED" | "SAP_SANDBOX" | "SAP";
    toolsAvailable: string[];
  }>;
  tools: Array<{
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  openTickets: Array<{
    id: string;
    reference: string;
    title: string;
    status: string;
    priority: string;
  }>;
}

export interface ToolEnvelope {
  toolCallId: string;
  tool: string;
  status: "ok" | "error" | "timeout" | "rejected";
  source: "SIMULATED" | "SAP_SANDBOX" | "SAP";
  system: { sid: string; client: string; environment: string; name: string };
  retrievedAt: string;
  data?: unknown;
  error?: { code: string; message: string };
}

export class PlatformError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PlatformApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/api/v1${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw new PlatformError(
        0,
        `The EWM Agent platform at ${this.baseUrl} is not reachable: ${(err as Error).message}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      throw new PlatformError(
        response.status,
        payload?.error?.message ?? `The platform answered HTTP ${response.status}.`,
      );
    }
    return payload as T;
  }

  context = () => this.request<AgentContext>("/agent/context");

  tickets = (projectId: string) =>
    this.request<{ tickets: Array<Record<string, unknown>> }>(`/projects/${projectId}/tickets`);

  ticket = (projectId: string, ticketId: string) =>
    this.request<{ ticket: Record<string, unknown> }>(`/projects/${projectId}/tickets/${ticketId}`);

  runTool = (
    projectId: string,
    systemId: string,
    tool: string,
    input: unknown,
    ticketId?: string,
  ) =>
    this.request<{ result: ToolEnvelope }>(
      `/projects/${projectId}/sap-systems/${systemId}/tools/${tool}`,
      {
        method: "POST",
        body: { input, ...(ticketId ? { ticketId } : {}) },
      },
    );
}
