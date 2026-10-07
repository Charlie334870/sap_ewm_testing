// Generates docs/architecture/EWM-Agent-MVP-Architecture.docx
// Run: NODE_PATH=<global node_modules> node build.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, PageNumber, AlignmentType, HeadingLevel, WidthType, ShadingType,
  BorderStyle, LevelFormat, VerticalAlign, TableLayoutType,
} = require("docx");

const W = 9026; // A4 content width in DXA with 1-inch margins
const NAVY = "1F3864", BLUE = "2E75B6", GREY = "595959", AMBER = "C55A11";
const FONT = "Arial", MONO = "Consolas";

// ---------- inline text: **bold**, `code`, and automatic TODO flag ----------
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|TODO – verify)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t === "TODO – verify") out.push(new TextRun({ text: t, font: FONT, ...base, bold: true, color: AMBER }));
    else if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), font: FONT, ...base, bold: true }));
    else out.push(new TextRun({ text: t.slice(1, -1), ...base, font: MONO }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out;
}

const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: FONT })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: FONT })] });
const p = (t, opts = {}) => new Paragraph({ spacing: { after: 120, line: 288 }, ...opts, children: runs(t) });
const bullet = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60, line: 276 }, children: runs(t) });
const num = (t, ref = "numbers") => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60, line: 276 }, children: runs(t) });
const gap = (after = 120) => new Paragraph({ spacing: { after }, children: [] });

function note(label, text, fill = "FFF2CC", bar = "BF9000") {
  return new Paragraph({
    spacing: { before: 80, after: 160, line: 288 },
    shading: { type: ShadingType.CLEAR, fill },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: bar, space: 8 } },
    indent: { left: 160, right: 120 },
    children: [new TextRun({ text: label + "  ", bold: true, font: FONT }), ...runs(text)],
  });
}

function code(lines) {
  return lines.map((l, i) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: "1E1E1E" },
    spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 160 : 0, line: 260 },
    indent: { left: 120, right: 120 },
    children: [new TextRun({ text: l === "" ? " " : l, font: MONO, size: 17, color: "D4D4D4" })],
  }));
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function table(headers, rows, widths) {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum !== W) throw new Error(`widths sum ${sum} != ${W} for table ${headers[0]}`);
  const mk = (content, i, isHead, alt) => {
    const paras = (Array.isArray(content) ? content : [content]).map((t) =>
      new Paragraph({ spacing: { after: 40, line: 252 }, children: runs(String(t), { size: 18, ...(isHead ? { bold: true, color: "FFFFFF" } : {}) }) }));
    return new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.TOP,
      shading: { type: ShadingType.CLEAR, fill: isHead ? NAVY : alt ? "F2F6FC" : "FFFFFF" },
      margins: { top: 70, bottom: 50, left: 100, right: 100 },
      children: paras,
    });
  };
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => mk(h, i, true)) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => mk(c, i, false, ri % 2 === 1)) })),
    ],
  });
}

function image(file, wPx, hPx, caption) {
  const widthPt = 600; // px at 96 dpi ≈ 6.25 in
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: fs.readFileSync(path.join(__dirname, "diagrams", file)),
        transformation: { width: widthPt, height: Math.round(widthPt * hPx / wPx) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: caption, italics: true, size: 18, color: GREY, font: FONT })] }),
  ];
}

// =============================== CONTENT ===============================
const c = [];

// ---- Title block ----
c.push(new Paragraph({ spacing: { before: 600, after: 80 }, children: [new TextRun({ text: "AI SAP EWM Engineering and Support Agent", bold: true, size: 38, color: NAVY, font: FONT })] }));
c.push(new Paragraph({ spacing: { after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } },
  children: [new TextRun({ text: "MVP Architecture and Implementation Plan", size: 32, color: BLUE, font: FONT })] }));
c.push(table(["Item", "Detail"], [
  ["Version", "0.1, draft for review"],
  ["Date", "7 October 2026"],
  ["Product owner", "Kiran"],
  ["Scope", "SAP EWM only. Embedded EWM on S/4HANA on-premise is the first target. Read-only investigation; no write access to SAP."],
  ["Basis", "Master project prompt, section 37 (first task), adapted to the decision to spend nothing until the concept is proven."],
  ["Convention", "TODO – verify marks any SAP technical detail that has not been confirmed on a real system."],
], [2200, 6826]));
c.push(gap(200));

// ---- 1 ----
c.push(h1("1. Summary"));
c.push(p("The platform can be designed and built to a working diagnosis workflow at no cost, on a laptop, against a **simulated** SAP system. That proves the agent loop, the tool controls, the evidence rules, the user interface and the audit trail. It does not prove that the agent diagnoses a real EWM system correctly; that needs a real system and is the point where money is first required."));
c.push(h2("1.1 What is free and what is not"));
c.push(table(["Item", "Cost now", "Comment"], [
  ["Application stack: Node.js, Next.js, PostgreSQL, pgvector, Docker", "Free", "Runs on your laptop."],
  ["Private GitHub repository", "Free", "Holds the code and this document."],
  ["Document search (embeddings)", "Free", "A small open-source embedding model runs locally. Project documents are not sent anywhere to be indexed."],
  ["Simulated SAP system", "Free", "Built by us from scenario packs. Every result is labelled SIMULATED."],
  ["Claude API", "Paid per use", "Billed per token through the Anthropic Console, separately from the Claude app subscription. Not needed for Milestones 1 and 2. Needed from Milestone 3, when the agent starts reasoning."],
  ["Real SAP EWM system", "Not free", "Deferred until the decision gate after Milestone 5. See section 4.1."],
], [3300, 1400, 4326]));
c.push(gap(80));
c.push(h2("1.2 Key decisions"));
c.push(table(["#", "Decision", "Reason"], [
  ["1", "Build against a simulated SAP adapter first.", "No embedded EWM system is available at zero cost. Master prompt section 33 requires simulated responses to be clearly marked."],
  ["2", "Move real SAP connectivity (your Phase 2) to after the diagnosis workflow.", "It is the only phase that needs a real system. Everything before it can be built and tested without one."],
  ["3", "Modular monolith: one API process, one web application, one PostgreSQL database.", "Simplest thing that runs on a laptop and still has clean module boundaries (section 23)."],
  ["4", "The agent is a module inside the API process, not a separate application.", "Fewer moving parts. It stays a separate package, so it can be split out later without a rewrite."],
  ["5", "MCP is the boundary between the agent and the SAP tool server.", "When the product is sold, the tool server can sit inside the client network beside SAP, so SAP credentials never leave the client."],
  ["6", "HTTP-first SAP connectivity (OData and ADT). RFC only where nothing else works.", "No dependency on the SAP NetWeaver RFC SDK or its licence terms. TODO – verify on the first real system."],
  ["7", "No write tools exist in the MVP.", "Stronger than a permission flag: the agent cannot change SAP because no tool that changes SAP has been written."],
  ["8", "Confidence is shown as High, Medium or Low with reasons, not as a percentage.", "A percentage produced by a language model is not calibrated. A number can be added once evaluation data exists to calibrate it."],
], [500, 3900, 4626]));

// ---- 2 ----
c.push(h1("2. Repository status"));
c.push(p("The repository `Charlie334870/sap_ewm_automation` could not be inspected: GitHub is not yet linked to Claude for this account, so access was refused. From your screenshot it is a new private repository with only a README, so this plan assumes an empty repository and no existing architecture to preserve."));
c.push(p("Until GitHub is linked, the work is kept in the session workspace and delivered as files. Linking it is the first action in section 15."));

// ---- 3 ----
c.push(h1("3. MVP architecture"));
c.push(...image("architecture.png", 3000, 2020, "Figure 1. MVP architecture. Dashed boxes are designed for but not built until a real SAP system is available."));
c.push(h2("3.1 Repository structure"));
c.push(p("One repository with workspaces. This follows your proposed structure with one change: `apps/agent` becomes `packages/agent` and runs inside the API process (decision 4)."));
c.push(...code([
  "apps/",
  "  web/            Next.js user interface",
  "  api/            REST API, background worker, hosts the agent",
  "packages/",
  "  shared/         types and validation schemas used everywhere",
  "  database/       schema, migrations, data access with project scoping",
  "  sap-tools/      tool contracts, tool gateway, SAP adapters (simulated, real)",
  "  mcp/            MCP server and client wrapping the tool gateway",
  "  ai/             model provider abstraction, Claude client, scripted test model",
  "  agent/          investigation loop, state, evidence rules",
  "  knowledge/      document ingestion, chunking, embeddings, hybrid search",
  "  auth/           login, roles, permission checks",
  "  audit/          append-only audit log",
  "docs/            architecture, decisions, setup guide",
  "infrastructure/  Docker Compose for local development",
  "tests/           scenario packs and the evaluation harness",
]));
c.push(h2("3.2 Technology choices"));
c.push(table(["Area", "Choice", "Why"], [
  ["Language", "TypeScript everywhere", "One language for web, API, agent and tools."],
  ["Web", "Next.js and React", "As preferred in section 23."],
  ["API", "Node.js REST API with schema-validated requests", "Simple, typed, easy to test."],
  ["Database", "PostgreSQL with pgvector", "One database for business data, audit, full-text search and vectors."],
  ["Background jobs", "Job queue stored in PostgreSQL", "Investigations run for minutes; no extra queue server is needed."],
  ["Model access", "Claude API behind a `ModelProvider` interface", "Models can be changed in configuration (section 29)."],
  ["Local run", "Docker Compose", "One command starts the database and the applications."],
], [1800, 3200, 4026]));

// ---- 4 ----
c.push(h1("4. SAP integration strategy"));
c.push(h2("4.1 Getting an SAP system: options"));
c.push(p("No free option provides a real embedded EWM system. The options, in the order they become useful:"));
c.push(table(["Option", "Cost", "Real embedded EWM?", "Use"], [
  ["Simulated adapter (ours)", "Free", "No. Simulated behaviour only.", "**Now.** Milestones 2 to 5."],
  ["SAP Business Accelerator Hub sandbox (api.sap.com)", "Free with an SAP login such as your Universal ID", "No. Read-only test data for S/4HANA Cloud APIs. Whether the warehouse APIs return usable data: TODO – verify.", "Optional. Tests our OData client against real SAP response formats."],
  ["ABAP Cloud Developer Trial (Docker image)", "Free. 16 GB RAM minimum, 32 GB recommended, about 170 GB disk. Education and demo use only; licence renewed every three months.", "No. An ABAP platform; no EWM application content is documented.", "Later. Prototype the ABAP side of the connector and source-code reading."],
  ["S/4HANA Fully-Activated Appliance (SAP Cloud Appliance Library)", "SAP licence waived for 30 days. Cloud hosting about 3 to 4 USD per running hour.", "Yes, with EWM demo scenarios.", "**First real system**, at the decision gate."],
  ["Client DEV system", "None", "Yes", "Only with written client permission for AI tool access."],
], [2400, 2500, 2326, 1800]));
c.push(gap(80));
c.push(h2("4.2 Integration mechanisms"));
c.push(p("Section 8 of the master prompt requires the supported mechanism to be determined before each integration is built. The assessment below is the starting position; each row is confirmed on the first real system before any code depends on it."));
c.push(table(["Mechanism", "Intended use", "Position"], [
  ["Released SAP OData APIs for warehouse documents", "Deliveries, warehouse orders and tasks, where SAP has released an API for the system release.", "First choice where available. Availability for embedded EWM on-premise is unclear: an SAP Community answer states that `API_WAREHOUSE_ORDER_TASK_2` was intended for S/4HANA Cloud only, while SAP Help lists a Warehouse Order and Task API in the on-premise documentation. TODO – verify per release."],
  ["Own read-only ABAP services (a small Z package exposed as OData)", "Everything the released APIs do not cover: customizing reads, application logs, queues, PPF status, dumps.", "Expected to be the main mechanism. It becomes a product component, the EWM Agent Connector, installed by transport, protected by its own authorisation object, and read-only by construction. Designed after system access."],
  ["ADT REST interface", "Reading ABAP source, where-used lists; later, controlled code changes and transports.", "Standard interface used by the ABAP Development Tools. TODO – verify authorisations needed for read-only use."],
  ["RFC and BAPIs", "Fallback where no HTTP option exists.", "Avoided as a foundation. Needs the SAP NetWeaver RFC SDK, and generic table readers such as `RFC_READ_TABLE` are not a sound basis for a product. TODO – verify current SAP position."],
  ["SAP GUI scripting or screen reading", "None", "Rejected. Brittle and hard to audit."],
  ["MCP", "Protocol between the agent and our tool server.", "Not an SAP integration in itself. It carries our own tool definitions."],
], [2300, 2900, 3826]));
c.push(gap(80));
c.push(h2("4.3 The simulated SAP adapter"));
c.push(p("The simulated adapter implements the same tool contracts the real adapter will. It is driven by **scenario packs**: each pack is a consistent warehouse state for one failure case (documents, stock, queues, logs, customizing) with a planted root cause and an answer key that the agent never sees."));
c.push(bullet("Every tool result carries `source: \"SIMULATED\"`, and the user interface shows a permanent SIMULATED banner on any investigation that used simulated data."));
c.push(bullet("Scenario content comes from your experience and your past tickets. Error texts and message numbers are taken from real cases you supply; none are invented."));
c.push(bullet("The scenario packs double as the regression test suite and as the scoring basis for the evaluation harness (section 7.3)."));
c.push(note("Limit.", "A pass on simulated data shows that the reasoning loop and controls work. It is not evidence that the agent is correct on a real system, where data is messier and the tools return far more."));

// ---- 5 ----
c.push(h1("5. Tool and MCP architecture"));
c.push(p("The model decides what to investigate. The tool gateway decides what it is allowed to do. Every call passes through the gateway, whichever adapter is behind it."));
c.push(table(["Gateway step", "What it enforces"], [
  ["1. Schema validation", "Input must match the tool's input schema. Output must match its output schema; a mismatch is treated as unexpected data and stops the investigation (section 21)."],
  ["2. Project and system scope", "The call must target an SAP system that belongs to the ticket's project."],
  ["3. Authorisation level", "The tool's level (0 to 3) is checked against the policy and the approval state. In the MVP only level 0 tools are registered."],
  ["4. Environment check", "The environment is taken from the registered system record and confirmed against the system itself on connection. It is never inferred from a hostname."],
  ["5. Credentials", "Resolved inside the tool server from the secrets store by system ID. They are never placed in a prompt, a tool result or a log."],
  ["6. Timeout and retry", "Per-tool limits. Only read-only calls are retried."],
  ["7. Audit", "Tool, parameters, user, ticket, system, time, result and duration are written for every call, including failures."],
], [2400, 6626]));
c.push(gap(80));
c.push(h2("5.1 Tool contract"));
c.push(p("Each tool is defined once, in code, with the attributes listed in section 9 of the master prompt. Example:"));
c.push(...code([
  "name:          get_warehouse_tasks",
  "description:   Warehouse tasks for a delivery, a task number or a handling unit",
  "level:         0 (READ)        access: read",
  "environments:  DEV, QAS, PROD",
  "timeout:       15 s            retry: 2 attempts (read-only)",
  "audit:         always",
  "",
  "input:   { system_id, warehouse, delivery?, warehouse_task?, handling_unit? }",
  "",
  "output:  { source: \"SIMULATED\" | \"SAP\", system_id, environment, retrieved_at,",
  "           tasks: [ { number, status, process_type, product, quantity, uom,",
  "                      source_bin, destination_bin, warehouse_order, created_at } ] }",
]));
c.push(h2("5.2 Where MCP sits"));
c.push(p("The tool registry is the single definition of all tools. The MCP server is a thin wrapper that publishes the registry; the agent runtime reaches it through an MCP client. In the MVP both run in the same process. Later the tool server is deployed separately, close to SAP, with no change to the tools or the agent."));

// ---- 6 ----
c.push(h1("6. First ten EWM diagnostic tools"));
c.push(p("All ten are read-only, level 0. The SAP GUI column is for orientation only; it names where a consultant would look, not how the tool will read the data. The technical source of each tool is fixed when a real system is connected."));
c.push(table(["#", "Tool", "Returns", "Consultant equivalent", "Use cases"], [
  ["1", "`get_delivery`", "Inbound or outbound delivery order: header, items, statuses, reference documents.", "/SCWM/PRDI, /SCWM/PRDO", "1, 3, 4, 9"],
  ["2", "`get_warehouse_tasks`", "Warehouse tasks by delivery, task or HU, with status, process type and bins.", "/SCWM/MON", "1, 2, 4"],
  ["3", "`get_warehouse_order`", "Warehouse order: status, tasks, queue, creation rule applied.", "/SCWM/MON", "2"],
  ["4", "`get_handling_unit`", "HU header, contents, status and current location.", "/SCWM/MON", "3, 4"],
  ["5", "`get_stock`", "Physical and available stock by product, bin, stock type, batch and owner.", "/SCWM/MON", "1, 10"],
  ["6", "`get_queue_status`", "qRFC queue entries with status and error text.", "SMQ1, SMQ2", "3, 4, 5"],
  ["7", "`get_application_log`", "Log messages by object, external ID and time window.", "SLG1", "1 to 7"],
  ["8", "`get_ppf_actions`", "PPF actions for a document: determination, status, processing log.", "Actions on the document", "6"],
  ["9", "`get_abap_dump`", "Short dumps by time, user or program: error, program, source position.", "ST22", "8"],
  ["10", "`get_configuration`", "Named, whitelisted customizing reads, for example process type determination, storage type search sequence, warehouse order creation rules.", "SPRO views", "1, 2, 9, 10"],
], [450, 2500, 3026, 1800, 1250]));
c.push(gap(80));
c.push(p("`get_configuration` accepts only a fixed list of named configuration areas. It is not a general table reader."));
c.push(p("**Next tools, after the first ten:** `get_product_master`, `get_storage_bin`, `search_abap_code`, `get_abap_object`, `get_background_job`, `get_idoc`, `get_transport`, `get_change_history`."));

// ---- 7 ----
c.push(h1("7. Claude agent architecture"));
c.push(...image("lifecycle.png", 3000, 1120, "Figure 2. Investigation lifecycle. The MVP ends at a recorded human approval."));
c.push(h2("7.1 Investigation state"));
c.push(p("The investigation state is a structured record in the database, updated after every step. The conversation history is not the source of truth. The model changes the state only through internal tools such as `record_evidence`, `record_hypothesis`, `conclude_root_cause` and `propose_solution`, so the state is written as data rather than parsed out of prose."));
c.push(h2("7.2 Rules enforced in code, not in the prompt"));
c.push(table(["Rule", "How it is enforced"], [
  ["No evidence, no root cause", "The API rejects a root cause that does not reference at least one stored evidence item."],
  ["Evidence must be real", "Every evidence item must reference a stored tool call or a stored document chunk. An item that references neither cannot be saved."],
  ["Tool failures are never replaced", "A failed call is stored as failed and the model receives the error. There is no fallback value."],
  ["Similar tickets are leads, not proof", "Historical matches are stored with type LEAD. A root cause supported only by leads is rejected (section 7 of the master prompt)."],
  ["Simulated stays simulated", "If any evidence in an investigation is simulated, the result, the solution and the approval record are all labelled SIMULATED."],
  ["Budgets", "Maximum tool calls, tokens and minutes per investigation. On reaching one, the agent stops with: Insufficient evidence. Additional investigation required."],
  ["Reasoning records", "The plan, tool calls, and short reasoning summaries are stored. Hidden chain-of-thought is not stored (section 22)."],
  ["Untrusted content", "Ticket text, documents and SAP data are treated as data. Instructions found inside them are not followed."],
], [2700, 6326]));
c.push(gap(80));
c.push(h2("7.3 Models, cost and evaluation"));
c.push(bullet("**Two tiers.** A fast, cheaper model for classification, extraction and summaries; the strongest model for diagnosis and code reasoning. Model names live in configuration."));
c.push(bullet("**Cost control.** Tool outputs are structured and trimmed, knowledge comes through retrieval, and the fixed part of the prompt (instructions and tool definitions) is cached."));
c.push(bullet("**Scripted model for tests.** A fake model that replays fixed decisions lets the whole pipeline be tested automatically at no API cost."));
c.push(bullet("**Evaluation harness.** Each scenario pack has an answer key. A run is scored on three points: correct root cause, all evidence valid, no invented SAP object. This is how \"works reliably\" in section 31 is measured before any write capability is considered."));

// ---- 8 ----
c.push(h1("8. Knowledge and RAG architecture"));
c.push(table(["Stage", "Design"], [
  ["Ingestion", "Upload per project. Text extraction for PDF, DOCX, XLSX, PPTX, TXT, Markdown and ABAP source. Screenshots are stored but read by a model only later, because that costs API usage."],
  ["Chunking", "By document structure: headings and sections for documents, object and method for ABAP, one row group per sheet region for spreadsheets."],
  ["Metadata", "Project, document type, version, warehouse, process, module, source page or section, linked tickets."],
  ["Indexing", "Local embedding model into pgvector, plus PostgreSQL full-text search for exact terms such as message numbers, object names and bin types. The embedding model is chosen by test in Milestone 4."],
  ["Retrieval", "Hybrid search (semantic and keyword results merged), always filtered by project, optionally by warehouse, process and document type."],
  ["Traceability", "Every retrieved passage carries document, version and location. The agent's answer cites them, and the user interface links to the source."],
  ["Versioning", "A new upload of the same document creates a new version. Old versions stay searchable only when explicitly requested."],
  ["Resolved tickets", "On closure a ticket becomes a structured record with the fields listed in section 7 of the master prompt, plus an embedded summary for similarity search."],
], [1800, 7226]));

// ---- 9 ----
c.push(h1("9. Database schema"));
c.push(p("The schema covers the entities listed in section 25 of the master prompt, plus two additions: `organizations` and `project_members`. They are needed for project isolation now and for selling to several clients later."));
c.push(table(["Group", "Tables", "Notes"], [
  ["Tenancy and access", "organizations, users, project_members, projects", "A user sees a project only through a membership with a role."],
  ["SAP landscape", "sap_systems, environments", "A system belongs to one project and one environment. System ID and client are stored and checked on connection."],
  ["Tickets", "tickets, ticket_events", "Events give the full timeline of a ticket."],
  ["Investigation", "investigations, investigation_steps, sap_tool_calls, evidence, hypotheses", "The investigation holds the structured state. Tool calls store input, output, status and duration."],
  ["Outcome", "solutions, approvals, executions, verification_results", "Solutions are versioned and hashed. The last two tables exist but stay empty in the MVP."],
  ["Knowledge", "knowledge_sources, documents, document_chunks, sap_objects", "Chunks hold text, embedding, full-text index and metadata."],
  ["Audit", "audit_logs", "Append-only. Each entry includes the hash of the previous entry, so tampering is detectable."],
], [1900, 3500, 3626]));
c.push(gap(80));
c.push(p("**Main relationships.** A ticket has many investigations. An investigation has many steps, tool calls, evidence items and hypotheses. Evidence points to one tool call or one document chunk. A hypothesis links to the evidence for and against it. A solution belongs to an investigation. An approval belongs to one exact solution version."));
c.push(p("**Isolation.** Every project-scoped row carries `project_id`. In the MVP the data-access layer applies the project filter on every query; PostgreSQL row-level security is added before a second client is onboarded."));
c.push(p("**Pay-as-you-go later.** Model calls and tool calls are already recorded per project with token counts and durations, so usage metering can be derived from existing tables when you start charging."));

// ---- 10 ----
c.push(h1("10. Security model"));
c.push(table(["Area", "MVP", "Before production use"], [
  ["SAP credentials", "Encrypted at rest with a key held outside the database. Resolved only inside the tool server.", "Managed secrets service; credential rotation."],
  ["Model exposure", "The model never receives credentials, connection strings or internal host names.", "Same."],
  ["Roles", "Admin, Consultant (can approve), Analyst (can raise and view).", "Client user role; single sign-on."],
  ["Environment separation", "Each system is registered as DEV, QAS or PROD with separate credentials. The gateway refuses a call when the system reports a different identity from the one registered.", "Production systems connectable only with a stricter policy and a named owner."],
  ["Tool authorisation", "Level per tool; only level 0 tools exist.", "Levels 1 to 3 introduced one at a time with their approval rules."],
  ["Audit", "Append-only, hash-chained log of every tool call, approval and login.", "Export to the client's log platform."],
  ["Transport security", "HTTPS between components once deployed off the laptop.", "Same, plus network restriction between platform and tool server."],
  ["Input and output validation", "Schemas on every API request, tool input and tool output. Rate limits per user and per investigation.", "Same."],
  ["Client data and the AI provider", "Only simulated and anonymised data is used.", "Ticket text and SAP data are sent to the Claude API for reasoning. Each client must agree to this in writing, and personal data such as user names should be masked."],
], [2000, 3900, 3126]));

// ---- 11 ----
c.push(h1("11. Approval workflow"));
c.push(table(["Level", "Examples", "MVP behaviour", "Later"], [
  ["0 Read", "Read documents, logs, queues, customizing, code.", "Automatic. Always audited.", "Same."],
  ["1 Low-risk, non-production", "Re-run diagnostics, predefined read-only tests, reports.", "Not built.", "Automatic or approved, by policy per project."],
  ["2 Change", "Customizing, ABAP, data correction, reprocessing, transports.", "Approval or rejection is recorded against the exact solution version. Nothing is executed.", "Approval releases one execution of exactly the approved change in DEV."],
  ["3 Production", "Any change in production.", "Not built.", "Two approvers and a reference to the client's change record. Never automatic."],
], [1900, 2500, 2526, 2100]));
c.push(gap(80));
c.push(bullet("An approval is tied to the hash of the solution it was given for. If the solution changes, the approval is void and must be given again."));
c.push(bullet("The approver's identity, time and comment are stored and shown on the ticket."));
c.push(bullet("In the MVP the button reads **Approve**, not Approve and Execute, because nothing is executed."));

// ---- 12 ----
c.push(h1("12. First ten EWM use cases"));
c.push(p("These are the ten from section 32. The planted root causes are starting examples for the simulator; the final set should come from your real tickets."));
c.push(table(["#", "Use case", "Example planted root causes", "Main tools"], [
  ["1", "Warehouse task not created", "No available stock in the storage types of the search sequence; stock in a non-pickable stock type; product not maintained for the warehouse.", "1, 2, 5, 7, 10"],
  ["2", "Warehouse order not created", "Creation rule filter or limit excludes the tasks; bins not assigned to an activity area or not sorted.", "2, 3, 10"],
  ["3", "Inbound delivery issue", "Delivery not distributed because a queue is stuck; putaway finds no destination bin; HU data inconsistent.", "1, 4, 6, 7"],
  ["4", "Outbound delivery issue", "Goods issue blocked by open picking tasks; goods movement message to ERP failed in a queue.", "1, 2, 6, 7"],
  ["5", "qRFC queue failure", "Queue in error status with an application error that points to master data or a locked object.", "6, 7"],
  ["6", "PPF action failure", "Action not determined because a condition is not met; action processed with error because print determination is missing.", "8, 7, 10"],
  ["7", "Application log error", "Error raised by a determination step whose customizing entry is missing.", "7, 10"],
  ["8", "ABAP dump in an EWM process", "Unhandled exception in a custom BAdI implementation during task confirmation.", "9, then code search"],
  ["9", "Process type determination", "No determination entry for the combination of document type, item type and control indicators.", "1, 10"],
  ["10", "Master data or configuration", "Bin blocked or over capacity; fixed bin assignment missing; packaging specification not found.", "5, 10, 7"],
], [450, 2100, 4776, 1700]));

// ---- 13 ----
c.push(h1("13. Implementation roadmap"));
c.push(p("Your twelve phases are kept. They are grouped into milestones and reordered so that everything that can be built without SAP comes first."));
c.push(table(["Milestone", "Your phases", "What is built", "Exit test"], [
  ["**M1** Foundation", "1", "Repository, Docker Compose, database schema, login and roles, projects, tickets, audit log, user interface shell with the ten sections, automated tests.", "One command starts it. You create a project and a ticket in the browser and see the audit entries."],
  ["**M2** Tool layer and simulated SAP", "3", "Ten tool contracts, tool gateway, simulated adapter, MCP server. First three scenario packs: task not created, queue failure, process type determination.", "Each tool can be called from tests and from a tool console in the UI. Every result is labelled SIMULATED and audited."],
  ["**M3** Agent and ticket investigation", "4, 6", "Investigation loop, structured state, evidence rules, live investigation view, evaluation harness.", "The section 31 ticket: the agent finds the planted root cause with valid evidence."],
  ["**M4** Knowledge", "5", "Ingestion, hybrid search, citations, resolved-ticket memory.", "The agent cites project documents. Similar tickets appear as leads."],
  ["**M5** Solution and approval", "7, 8", "Solution in the section 13 format, risk, rollback, test plan, approval record. Scenario packs for all ten use cases.", "All sixteen steps of section 31 work. Evaluation target met."],
  ["**Decision gate**", "", "Review evaluation results. Decide whether to pay for a real system.", "Proposed target: correct root cause in at least 8 of the 10 use-case families, with no invented evidence in any run."],
  ["**M6** Real SAP, read-only", "2", "Connector for one real system. The ten tools read from SAP.", "The same kinds of ticket are diagnosed on a real embedded EWM system."],
  ["**M7 onward**", "9 to 12", "Execution in DEV, automated testing and verification, monitoring, controlled QAS and production workflows.", "Defined after M6."],
], [1900, 1000, 3426, 2700]));

// ---- 14 ----
c.push(h1("14. Dependencies and prerequisites"));
c.push(table(["Dependency", "Needed for", "Status"], [
  ["GitHub linked to Claude, repository created", "Saving and reviewing code", "Open. Access was refused today."],
  ["Laptop with Docker Desktop, Node.js LTS, Git, VS Code", "Running the platform locally", "Open. 16 GB RAM is a sensible minimum for Docker with the database and applications; this is an estimate."],
  ["Anonymised past tickets", "Realistic scenario packs and the first knowledge base", "Open."],
  ["Claude API key with credit", "Milestone 3 onward", "Not needed yet."],
  ["Real SAP EWM system and a read-only technical user", "Milestone 6", "Deferred to the decision gate."],
  ["SAP licensing position", "Any commercial use", "Open. Trial licences are for evaluation. Third-party access to a client's SAP system can also have licence implications. Confirm with SAP or a licensing adviser before selling."],
], [3300, 2500, 3226]));

// ---- 15 ----
c.push(h1("15. What you need to provide"));
c.push(table(["When", "Action", "Notes"], [
  ["Now", "Finish creating the repository `sap_ewm_automation` (private, README on).", "Your screenshot showed the creation form still open. Confirm it was submitted."],
  ["Now", "Link your GitHub account to Claude and allow access to that repository.", "In Claude, under Settings, Connectors, connect GitHub."],
  ["Now", "Install Docker Desktop, Node.js LTS, Git and VS Code on your laptop. Tell me the operating system and RAM.", "All free."],
  ["Before M2", "Send 10 to 20 past EWM tickets with client names removed: symptom, exact error text, root cause, fix.", "The most valuable input you can give. They decide how realistic the simulator is."],
  ["Before M3", "Create an Anthropic Console account, add credit, generate an API key and put it in the local `.env` file.", "Never paste the key into chat or commit it to the repository."],
  ["Before M4", "A few anonymised project documents: a functional specification, a configuration document, a custom program.", "Used to test ingestion and citations."],
  ["Decision gate", "Decide on the first real system and its budget.", "Start the 30-day appliance trial only when Milestone 6 is ready to use it."],
], [1500, 4300, 3226]));

// ---- 16 ----
c.push(h1("16. Proposed first milestone: M1 Foundation"));
c.push(p("**Goal.** A running, tested skeleton that every later milestone builds on, with no SAP and no AI in it yet."));
c.push(num("Monorepo with the structure in section 3.1, linting, formatting and a test runner.", "m1"));
c.push(num("Docker Compose with PostgreSQL and pgvector; one command to start everything.", "m1"));
c.push(num("Database schema and migrations for all tables in section 9.", "m1"));
c.push(num("Login, the three roles, and project membership checks on every API route.", "m1"));
c.push(num("Projects, SAP system records (marked as simulated) and tickets: create, list, view, timeline.", "m1"));
c.push(num("Append-only audit log, written by every state-changing request.", "m1"));
c.push(num("User interface shell with the ten sections from section 18; Projects, Tickets and Audit Logs working, the rest present as labelled placeholders.", "m1"));
c.push(num("Automated tests for access control, project isolation and audit writing.", "m1"));
c.push(num("A setup guide written for someone who is not a developer.", "m1"));
c.push(p("**Exit test.** On your laptop you run one command, open the browser, log in, create a project and the ticket \"Warehouse task is not being created for delivery XXXXX in warehouse MUHW\", and see both actions in the audit log. A second user without membership cannot see the project."));
c.push(p("**Needs from you.** GitHub linked, and the laptop tools installed. No cost."));

// ---- 17 ----
c.push(h1("17. Risks and open points"));
c.push(table(["Risk or open point", "Effect", "Handling"], [
  ["The simulator is not SAP.", "Good results on simulated data may not carry over.", "Scenario packs built from real tickets; clear SIMULATED labelling; real-system test at Milestone 6 before any claim of accuracy."],
  ["Released API coverage for embedded EWM on-premise is unconfirmed.", "The real connector may need more custom ABAP than hoped.", "Plan assumes our own read-only ABAP services as the main mechanism."],
  ["Claude API cost.", "The agent cannot run without it.", "Scripted model for automated tests; budgets per investigation; cheaper model tier for simple steps."],
  ["Client data sent to an external AI service.", "Contractual and data-protection exposure.", "Only anonymised data until a client agrees in writing; masking of personal data. Take legal advice before the first client."],
  ["SAP licensing for commercial use.", "Possible licence cost or restriction.", "Confirm before selling; see section 14."],
  ["Who operates the platform.", "Setup and updates need basic command-line work.", "Setup guide in Milestone 1. A part-time developer becomes useful from Milestone 6."],
], [3000, 2600, 3426]));

// ---- Sources ----
c.push(h1("Sources"));
[
  "SAP: S/4HANA Fully-Activated Appliance, 30-day trial quick start guide. https://www.sap.com/cz/documents/2025/05/e0389287-077f-0010-bca6-c68f7e60039b.html",
  "SAP blog: S/4HANA Fully-Activated Appliance overview (hosting cost per hour). https://blogs.sap.com/2018/12/12/sap-s4hana-fully-activated-appliance-create-your-sap-s4hana-1809-system-in-a-fraction-of-the-usual-setup-time/",
  "SAP Community: Warehouse Order API usage (API_WAREHOUSE_ORDER_TASK_2 and embedded EWM). https://community.sap.com/t5/technology-q-a/warehouse-order-api-usage-for-mobile-app/qaq-p/12767484",
  "SAP Help: Warehouse Order and Task (A2X), S/4HANA on-premise documentation. https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/5aadd5aa0ed541e49b1e006d7e17919b/3f4ed3d800bb42ce9588fc7fa4051a9a.html",
  "SAP: ABAP Platform Trial image (requirements and licence). https://github.com/SAP-docs/abap-platform-trial-image",
  "SAP Sandbox MCP Server (third-party description of the Business Accelerator Hub sandbox). https://glama.ai/mcp/servers/fvhz0ptukq",
].forEach((s) => c.push(new Paragraph({ numbering: { reference: "sources", level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: s, font: FONT, size: 18 })] })));

// =============================== DOCUMENT ===============================
const numLevel = (format, text) => [{ level: 0, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 320 } } } }];
const doc = new Document({
  creator: "EWM Agent project",
  title: "AI SAP EWM Engineering and Support Agent: MVP Architecture and Implementation Plan",
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, color: NAVY, font: FONT },
        paragraph: { spacing: { before: 400, after: 160 }, outlineLevel: 0, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, color: BLUE, font: FONT },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: "bullets", levels: numLevel(LevelFormat.BULLET, "•") },
    { reference: "numbers", levels: numLevel(LevelFormat.DECIMAL, "%1.") },
    { reference: "m1", levels: numLevel(LevelFormat.DECIMAL, "%1.") },
    { reference: "sources", levels: numLevel(LevelFormat.DECIMAL, "%1.") },
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1300, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "EWM Agent  ·  MVP Architecture and Implementation Plan  ·  v0.1 draft", size: 16, color: GREY, font: FONT })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Page ", size: 16, color: GREY, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY, font: FONT })] })] }) },
    children: c,
  }],
});

const out = path.join(__dirname, "EWM-Agent-MVP-Architecture.docx");
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log("written", out, buf.length); });
