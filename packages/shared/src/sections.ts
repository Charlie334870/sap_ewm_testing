/**
 * The ten sections of the user interface (master prompt, section 18) and the milestone that
 * makes each one live. The web app renders its navigation from this list.
 */
export interface Section {
  slug: string;
  label: string;
  liveFrom: number;
  purpose: string;
}

export const CURRENT_MILESTONE = 1;

export const SECTIONS: readonly Section[] = [
  {
    slug: "dashboard",
    label: "Dashboard",
    liveFrom: 1,
    purpose: "Open work in the selected project at a glance.",
  },
  {
    slug: "projects",
    label: "Projects",
    liveFrom: 1,
    purpose: "Projects, their members and environments.",
  },
  {
    slug: "sap-systems",
    label: "SAP Systems",
    liveFrom: 1,
    purpose: "The SAP systems registered for a project.",
  },
  {
    slug: "tickets",
    label: "Tickets",
    liveFrom: 1,
    purpose: "Incidents and requests raised against a project.",
  },
  {
    slug: "investigations",
    label: "Investigations",
    liveFrom: 3,
    purpose: "Each agent investigation with its plan, tool calls, evidence and hypotheses.",
  },
  {
    slug: "knowledge",
    label: "Knowledge Base",
    liveFrom: 4,
    purpose: "Project documents, custom code and resolved tickets the agent can search and cite.",
  },
  {
    slug: "approvals",
    label: "Approvals",
    liveFrom: 5,
    purpose: "Proposed solutions waiting for a consultant to approve or reject.",
  },
  {
    slug: "executions",
    label: "Execution History",
    liveFrom: 7,
    purpose: "Approved changes carried out in an SAP system, with test and verification results.",
  },
  { slug: "audit-logs", label: "Audit Logs", liveFrom: 1, purpose: "Who did what, and when." },
  {
    slug: "agent-activity",
    label: "Agent Activity",
    liveFrom: 3,
    purpose: "Live view of what the agent is doing, with model and tool usage.",
  },
] as const;
