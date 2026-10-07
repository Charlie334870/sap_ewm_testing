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
export interface SapSystem {
  id: string;
  name: string;
  sid: string;
  client: string;
  deployment: "embedded" | "decentralized";
  adapter: SapAdapter;
  isActive: boolean;
  environment: EnvironmentKind;
  createdAt: string;
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
