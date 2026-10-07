/** Shared vocabularies. The database enums are generated from these lists. */

export const PROJECT_ROLES = ["analyst", "consultant", "admin"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ENVIRONMENT_KINDS = ["DEV", "QAS", "PROD"] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

/** How the platform reaches a system. Only "simulated" can be created until Milestone 6. */
export const SAP_ADAPTERS = ["simulated", "sap"] as const;
export type SapAdapter = (typeof SAP_ADAPTERS)[number];

export const EWM_DEPLOYMENTS = ["embedded", "decentralized"] as const;
export type EwmDeployment = (typeof EWM_DEPLOYMENTS)[number];

export const TICKET_STATUSES = [
  "open",
  "investigating",
  "awaiting_approval",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** EWM process areas a ticket can be filed under. "unknown" until someone classifies it. */
export const EWM_PROCESSES = [
  "unknown",
  "inbound",
  "outbound",
  "internal",
  "physical_inventory",
  "integration",
  "master_data",
  "configuration",
  "custom_development",
] as const;
export type EwmProcess = (typeof EWM_PROCESSES)[number];

export const ACTOR_TYPES = ["user", "agent", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Tool authorisation levels from the master prompt, section 4. */
export const AUTH_LEVELS = { READ: 0, LOW_RISK: 1, CHANGE: 2, PRODUCTION: 3 } as const;

export const INVESTIGATION_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "stopped",
  "failed",
] as const;

export const TOOL_CALL_STATUSES = ["ok", "error", "timeout", "rejected"] as const;
export const DATA_SOURCES = ["SIMULATED", "SAP"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const EVIDENCE_KINDS = ["tool_result", "document", "lead"] as const;
export const HYPOTHESIS_STATUSES = ["open", "supported", "rejected", "confirmed"] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const EVIDENCE_RELATIONS = ["supports", "contradicts"] as const;
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export const EXECUTION_STATUSES = ["pending", "running", "succeeded", "failed", "partial"] as const;
export const VERIFICATION_STATUSES = ["pass", "fail"] as const;
export const KNOWLEDGE_SOURCE_KINDS = ["upload", "ticket_history", "sap_extract"] as const;
