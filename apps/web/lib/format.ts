import type { EwmProcess, TicketStatus } from "@ewm/shared";

const dateTime = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  awaiting_approval: "Awaiting approval",
  resolved: "Resolved",
  closed: "Closed",
};

export const PROCESS_LABEL: Record<EwmProcess, string> = {
  unknown: "Not classified",
  inbound: "Inbound",
  outbound: "Outbound",
  internal: "Internal warehouse",
  physical_inventory: "Physical inventory",
  integration: "Integration and queues",
  master_data: "Master data",
  configuration: "Configuration",
  custom_development: "Custom development",
};

export const ROLE_LABEL = {
  analyst: "Analyst",
  consultant: "Consultant",
  admin: "Project admin",
} as const;

const ACTION_LABEL: Record<string, string> = {
  "organization.bootstrapped": "Organisation set up",
  "auth.login": "Signed in",
  "auth.login_failed": "Sign-in failed",
  "auth.logout": "Signed out",
  "auth.password_changed": "Changed password",
  "user.created": "Created user",
  "user.activated": "Reactivated user",
  "user.deactivated": "Deactivated user",
  "user.password_reset": "Reset a user's password",
  "project.created": "Created project",
  "member.added": "Added member",
  "member.role_changed": "Changed member role",
  "member.removed": "Removed member",
  "sap_system.created": "Registered SAP system",
  "sap_system.tested": "Tested SAP connection",
  "sap_system.credential_changed": "Replaced SAP API key",
  "api_token.created": "Created agent access token",
  "api_token.revoked": "Revoked agent access token",
  "ticket.created": "Created ticket",
  "ticket.commented": "Commented on ticket",
  "ticket.status_changed": "Changed ticket status",
};
export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

/** One line describing the details of an audit entry, without dumping raw JSON. */
export function auditDetail(data: Record<string, unknown>): string {
  const d = data as Record<string, string | undefined>;
  const parts: string[] = [];
  if (d.reference) parts.push(d.reference);
  if (d.title) parts.push(d.title);
  if (d.key && d.name) parts.push(`${d.key}: ${d.name}`);
  else if (d.name) parts.push(d.name);
  if (d.sid) parts.push(`${d.sid}/${d.client} ${d.environment ?? ""}`.trim());
  if (d.email) parts.push(d.email);
  if (d.adminEmail) parts.push(d.adminEmail);
  if (d.from && d.to) parts.push(`${d.from.replace("_", " ")} to ${d.to.replace("_", " ")}`);
  if (d.previousRole && d.role) parts.push(`${d.previousRole} to ${d.role}`);
  else if (d.role) parts.push(d.role);
  if (d.reason) parts.push(d.reason.replace("_", " "));
  if (typeof data.toolsAvailable === "number") {
    parts.push(data.reachable ? `${data.toolsAvailable} tools available` : "not reachable");
  }
  return parts.join(", ");
}

export const TOOL_STATUS_LABEL = {
  ok: "OK",
  error: "Failed",
  timeout: "Timed out",
  rejected: "Refused",
} as const;
