import type { ProjectRole } from "@ewm/shared";

/**
 * Who may do what inside a project.
 *
 *   analyst     raises tickets and reads
 *   consultant  also changes ticket status, reads the audit log, and (from Milestone 5) approves
 *   admin       also manages members and SAP system records
 *
 * An organisation administrator is treated as admin on every project of that organisation.
 */
const RANK: Record<ProjectRole, number> = { analyst: 1, consultant: 2, admin: 3 };

export const PROJECT_ACTIONS = {
  "project.view": "analyst",
  "ticket.create": "analyst",
  "ticket.comment": "analyst",
  "ticket.change_status": "consultant",
  "audit.view": "consultant",
  "member.manage": "admin",
  "sap_system.manage": "admin",
} as const satisfies Record<string, ProjectRole>;

export type ProjectAction = keyof typeof PROJECT_ACTIONS;

export function roleAllows(role: ProjectRole, action: ProjectAction): boolean {
  return RANK[role] >= RANK[PROJECT_ACTIONS[action]];
}

/** The role a user effectively holds on a project, or null when they have no access. */
export function effectiveRole(input: {
  isOrgAdmin: boolean;
  sameOrganization: boolean;
  memberRole: ProjectRole | null;
}): ProjectRole | null {
  if (!input.sameOrganization) return null;
  if (input.isOrgAdmin) return "admin";
  return input.memberRole;
}
