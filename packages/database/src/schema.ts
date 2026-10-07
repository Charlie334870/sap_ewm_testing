/**
 * Database schema (architecture document, section 9).
 *
 * Rules that hold across the schema:
 *  - Every project-scoped table carries project_id. Queries must filter on it.
 *  - audit_logs is append-only; a trigger rejects UPDATE, DELETE and TRUNCATE.
 *  - Tables for investigations, solutions, executions and knowledge exist from Milestone 1 so
 *    later milestones add behaviour, not structure. Nothing writes to them yet.
 *  - The embedding and full-text columns on document_chunks arrive with Milestone 4, when the
 *    embedding model (and so the vector size) is chosen.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACTOR_TYPES,
  APPROVAL_DECISIONS,
  CONFIDENCE_LEVELS,
  DATA_SOURCES,
  ENVIRONMENT_KINDS,
  EVIDENCE_KINDS,
  EVIDENCE_RELATIONS,
  EWM_DEPLOYMENTS,
  EWM_PROCESSES,
  EXECUTION_STATUSES,
  HYPOTHESIS_STATUSES,
  INVESTIGATION_STATUSES,
  KNOWLEDGE_SOURCE_KINDS,
  PROJECT_ROLES,
  SAP_ADAPTERS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TOOL_CALL_STATUSES,
  VERIFICATION_STATUSES,
} from "@ewm/shared";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const projectRole = pgEnum("project_role", PROJECT_ROLES);
export const environmentKind = pgEnum("environment_kind", ENVIRONMENT_KINDS);
export const sapAdapter = pgEnum("sap_adapter", SAP_ADAPTERS);
export const ewmDeployment = pgEnum("ewm_deployment", EWM_DEPLOYMENTS);
export const ticketStatus = pgEnum("ticket_status", TICKET_STATUSES);
export const ticketPriority = pgEnum("ticket_priority", TICKET_PRIORITIES);
export const ewmProcess = pgEnum("ewm_process", EWM_PROCESSES);
export const actorType = pgEnum("actor_type", ACTOR_TYPES);
export const investigationStatus = pgEnum("investigation_status", INVESTIGATION_STATUSES);
export const toolCallStatus = pgEnum("tool_call_status", TOOL_CALL_STATUSES);
export const dataSource = pgEnum("data_source", DATA_SOURCES);
export const evidenceKind = pgEnum("evidence_kind", EVIDENCE_KINDS);
export const hypothesisStatus = pgEnum("hypothesis_status", HYPOTHESIS_STATUSES);
export const confidenceLevel = pgEnum("confidence_level", CONFIDENCE_LEVELS);
export const evidenceRelation = pgEnum("evidence_relation", EVIDENCE_RELATIONS);
export const approvalDecision = pgEnum("approval_decision", APPROVAL_DECISIONS);
export const executionStatus = pgEnum("execution_status", EXECUTION_STATUSES);
export const verificationStatus = pgEnum("verification_status", VERIFICATION_STATUSES);
export const knowledgeSourceKind = pgEnum("knowledge_source_kind", KNOWLEDGE_SOURCE_KINDS);

// ---------------------------------------------------------------- tenancy and access

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isOrgAdmin: boolean("is_org_admin").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_org_idx").on(t.organizationId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token. The token itself is only ever in the user's cookie. */
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Short code used in ticket references, e.g. MUHW-12. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    ticketSeq: integer("ticket_seq").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    archivedAt: ts("archived_at"),
  },
  (t) => [uniqueIndex("projects_org_key_unique").on(t.organizationId, t.key)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------- SAP landscape

export const environments = pgTable(
  "environments",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: environmentKind("kind").notNull(),
    /** Highest tool authorisation level that may run without a human approval. */
    maxAutoToolLevel: integer("max_auto_tool_level").notNull().default(0),
    /** Production-style control: a change needs a reference to the client's change record. */
    requiresChangeReference: boolean("requires_change_reference").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("environments_project_kind_unique").on(t.projectId, t.kind),
    check("environments_auto_level_range", sql`${t.maxAutoToolLevel} between 0 and 1`),
  ],
);

export const sapSystems = pgTable(
  "sap_systems",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id),
    name: text("name").notNull(),
    sid: text("sid").notNull(),
    client: text("client").notNull(),
    deployment: ewmDeployment("deployment").notNull().default("embedded"),
    adapter: sapAdapter("adapter").notNull().default("simulated"),
    baseUrl: text("base_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sap_systems_project_sid_client_unique").on(t.projectId, t.sid, t.client)],
);

// ---------------------------------------------------------------- tickets

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: ticketStatus("status").notNull().default("open"),
    priority: ticketPriority("priority").notNull().default("medium"),
    process: ewmProcess("process").notNull().default("unknown"),
    warehouse: text("warehouse"),
    sapSystemId: uuid("sap_system_id").references(() => sapSystems.id),
    reportedBy: uuid("reported_by")
      .notNull()
      .references(() => users.id),
    assigneeId: uuid("assignee_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("tickets_project_number_unique").on(t.projectId, t.number),
    index("tickets_project_status_idx").on(t.projectId, t.status),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** created | comment | status_changed, more as later milestones add them. */
    type: text("type").notNull(),
    actorType: actorType("actor_type").notNull().default("user"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    body: text("body").notNull().default(""),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_events_ticket_idx").on(t.ticketId, t.createdAt)],
);

// ---------------------------------------------------------------- investigation (from Milestone 3)

export const investigations = pgTable(
  "investigations",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    status: investigationStatus("status").notNull().default("queued"),
    /** Structured investigation state (master prompt, section 10). */
    state: jsonb("state").notNull().default({}),
    /** True as soon as any evidence came from the simulated adapter. */
    isSimulated: boolean("is_simulated").notNull().default(false),
    stopReason: text("stop_reason"),
    startedBy: uuid("started_by").references(() => users.id),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("investigations_ticket_idx").on(t.ticketId)],
);

export const investigationSteps = pgTable(
  "investigation_steps",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    /** Short reasoning summary. Hidden chain-of-thought is never stored. */
    summary: text("summary").notNull().default(""),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("investigation_steps_seq_unique").on(t.investigationId, t.seq)],
);

export const sapToolCalls = pgTable(
  "sap_tool_calls",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id").references(() => investigations.id, {
      onDelete: "cascade",
    }),
    stepId: uuid("step_id").references(() => investigationSteps.id, { onDelete: "set null" }),
    sapSystemId: uuid("sap_system_id")
      .notNull()
      .references(() => sapSystems.id),
    toolName: text("tool_name").notNull(),
    authLevel: integer("auth_level").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    status: toolCallStatus("status").notNull(),
    error: text("error"),
    source: dataSource("source").notNull(),
    durationMs: integer("duration_ms"),
    calledByUserId: uuid("called_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("sap_tool_calls_investigation_idx").on(t.investigationId),
    check("sap_tool_calls_auth_level_range", sql`${t.authLevel} between 0 and 3`),
  ],
);

// ---------------------------------------------------------------- knowledge (from Milestone 4)

export const knowledgeSources = pgTable("knowledge_sources", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: knowledgeSourceKind("kind").notNull(),
  createdAt: createdAt(),
});

export const documents = pgTable(
  "documents",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    knowledgeSourceId: uuid("knowledge_source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    docType: text("doc_type").notNull().default("other"),
    version: integer("version").notNull().default(1),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sha256: text("sha256"),
    storagePath: text("storage_path"),
    metadata: jsonb("metadata").notNull().default({}),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    supersededBy: uuid("superseded_by"),
    createdAt: createdAt(),
  },
  (t) => [index("documents_project_idx").on(t.projectId)],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("document_chunks_seq_unique").on(t.documentId, t.seq)],
);

export const sapObjects = pgTable(
  "sap_objects",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sapSystemId: uuid("sap_system_id").references(() => sapSystems.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("sap_objects_lookup_idx").on(t.projectId, t.objectType, t.name)],
);

// ---------------------------------------------------------------- evidence and hypotheses

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    kind: evidenceKind("kind").notNull(),
    toolCallId: uuid("tool_call_id").references(() => sapToolCalls.id),
    documentChunkId: uuid("document_chunk_id").references(() => documentChunks.id),
    summary: text("summary").notNull(),
    sapObject: text("sap_object"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_investigation_idx").on(t.investigationId),
    // Evidence must point at something that was actually retrieved. No source, no evidence.
    check(
      "evidence_has_source",
      sql`${t.toolCallId} is not null or ${t.documentChunkId} is not null`,
    ),
  ],
);

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    status: hypothesisStatus("status").notNull().default("open"),
    confidence: confidenceLevel("confidence"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("hypotheses_investigation_idx").on(t.investigationId)],
);

export const hypothesisEvidence = pgTable(
  "hypothesis_evidence",
  {
    hypothesisId: uuid("hypothesis_id")
      .notNull()
      .references(() => hypotheses.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    relation: evidenceRelation("relation").notNull(),
  },
  (t) => [primaryKey({ columns: [t.hypothesisId, t.evidenceId] })],
);

// ---------------------------------------------------------------- outcome (from Milestone 5)

export const solutions = pgTable(
  "solutions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    /** The solution in the format of master prompt section 13. */
    content: jsonb("content").notNull(),
    /** SHA-256 of the content. An approval is valid only for this exact hash. */
    contentHash: text("content_hash").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("solutions_version_unique").on(t.investigationId, t.version)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    solutionId: uuid("solution_id")
      .notNull()
      .references(() => solutions.id, { onDelete: "cascade" }),
    solutionHash: text("solution_hash").notNull(),
    decision: approvalDecision("decision").notNull(),
    level: integer("level").notNull(),
    approverId: uuid("approver_id")
      .notNull()
      .references(() => users.id),
    comment: text("comment").notNull().default(""),
    changeReference: text("change_reference"),
    createdAt: createdAt(),
  },
  (t) => [check("approvals_level_range", sql`${t.level} between 0 and 3`)],
);

export const executions = pgTable("executions", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  solutionId: uuid("solution_id")
    .notNull()
    .references(() => solutions.id),
  approvalId: uuid("approval_id")
    .notNull()
    .references(() => approvals.id),
  sapSystemId: uuid("sap_system_id")
    .notNull()
    .references(() => sapSystems.id),
  status: executionStatus("status").notNull().default("pending"),
  result: jsonb("result").notNull().default({}),
  createdAt: createdAt(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
});

export const verificationResults = pgTable("verification_results", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  investigationId: uuid("investigation_id")
    .notNull()
    .references(() => investigations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").references(() => executions.id),
  expected: text("expected").notNull(),
  actual: text("actual").notNull(),
  status: verificationStatus("status").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- audit

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Position in the organisation's chain, starting at 1 with no gaps. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** Dotted name of what happened, e.g. ticket.created. */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").notNull().default({}),
    ip: text("ip"),
    createdAt: ts("created_at").notNull(),
    /** Hash of the previous entry in the chain ("" for the first). */
    prevHash: text("prev_hash").notNull(),
    /** SHA-256 over prev_hash and this entry's content. */
    hash: text("hash").notNull(),
  },
  (t) => [
    uniqueIndex("audit_logs_org_seq_unique").on(t.organizationId, t.seq),
    index("audit_logs_project_idx").on(t.projectId, t.seq),
  ],
);
