import type {
  EnvironmentKind,
  EwmProcess,
  ProjectRole,
  SapAdapter,
  TicketPriority,
  TicketStatus,
} from "@ewm/shared";

export interface User {
  id: string;
  email: string;
  name: string;
  isOrgAdmin: boolean;
}
export interface ProjectListItem {
  id: string;
  key: string;
  name: string;
  description: string;
  createdAt: string;
  role: ProjectRole;
}
export interface Member {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  role: ProjectRole;
  addedAt: string;
}
export interface Environment {
  id: string;
  kind: EnvironmentKind;
  maxAutoToolLevel: number;
  requiresChangeReference: boolean;
}
export type DataSource = "SIMULATED" | "SAP_SANDBOX" | "SAP";

export interface SapSystem {
  id: string;
  name: string;
  sid: string;
  client: string;
  deployment: "embedded" | "decentralized";
  adapter: SapAdapter;
  source: DataSource;
  baseUrl: string | null;
  isActive: boolean;
  environment: EnvironmentKind;
  lastCheck: ConnectionCheck | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface SapSystemDetail extends SapSystem {
  tools: Array<{ name: string; available: boolean; reason: string | null }>;
  scenarios: Array<{ id: string; useCase: number; title: string; ticketTitle: string }>;
}

export interface ServiceCheck {
  id: string;
  title: string;
  path: string;
  version: "v2" | "v4";
  usedByTools: string[];
  state: "ok" | "changed" | "not_found" | "refused" | "error";
  detail: string | null;
  entitySets: Array<{ name: string; present: boolean; missingProperties: string[] }>;
  example: Record<string, string> | null;
  exposes?: Record<string, string[]>;
}

export interface ConnectionCheck {
  checkedAt: string;
  reachable: boolean;
  summary: string;
  services: ServiceCheck[];
  tools: Array<{ name: string; available: boolean; reason: string | null }>;
}

export interface JsonSchemaProperty {
  type?: "string" | "integer" | "number" | "boolean" | "object";
  enum?: string[];
  description?: string;
  default?: unknown;
  maxLength?: number;
}

export interface ToolDescription {
  name: string;
  title: string;
  description: string;
  authLevel: number;
  consultantEquivalent: string;
  inputSchema: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
}

export interface ToolEnvelope {
  toolCallId: string;
  tool: string;
  status: "ok" | "error" | "timeout" | "rejected";
  source: DataSource;
  system: { id: string; name: string; sid: string; client: string; environment: EnvironmentKind };
  retrievedAt: string;
  durationMs: number;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface ToolCall {
  id: string;
  createdAt: string;
  toolName: string;
  status: ToolEnvelope["status"];
  source: DataSource;
  durationMs: number | null;
  error: string | null;
  input: Record<string, unknown>;
  sapSystemId: string;
  sapSystemSid: string;
  calledByName: string | null;
  viaToken: string | null;
  ticketNumber: number | null;
}

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  userId: string;
  userName: string;
}

export interface TicketListItem {
  id: string;
  number: number;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  process: EwmProcess;
  warehouse: string | null;
  createdAt: string;
  updatedAt: string;
  reportedByName: string;
  sapSystemSid: string | null;
  sapSystemAdapter: SapAdapter | null;
}
export interface TicketEvent {
  id: string;
  type: string;
  actorType: "user" | "agent" | "system";
  actorName: string | null;
  body: string;
  data: Record<string, string>;
  createdAt: string;
}
export interface TicketDetail extends TicketListItem {
  reference: string;
  description: string;
  closedAt: string | null;
  sapSystemId: string | null;
  sapSystemName: string | null;
  sapSystemClient: string | null;
  sapSystemEnvironment: EnvironmentKind | null;
  events: TicketEvent[];
}
export interface AuditEntry {
  seq: number;
  createdAt: string;
  action: string;
  actorType: string;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  hash: string;
  projectId: string | null;
  projectKey: string | null;
}
export interface Summary {
  ticketsByStatus: Partial<Record<TicketStatus, number>>;
  sapSystems: number;
  members: number;
  recentActivity: Array<{
    id: string;
    type: string;
    body: string;
    data: Record<string, string>;
    createdAt: string;
    ticketId: string;
    ticketNumber: number;
    ticketTitle: string;
    actorName: string | null;
  }>;
}
