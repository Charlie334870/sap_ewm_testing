import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { effectiveRole, roleAllows, type ProjectAction } from "@ewm/auth";
import { schema, type DbOrTx } from "@ewm/database";
import type { ProjectRole } from "@ewm/shared";
import type { AuthUser } from "./context";
import { forbidden, notFound } from "./errors";

const { projects, projectMembers } = schema;
const uuid = z.uuid();

export const isUuid = (value: unknown): value is string => uuid.safeParse(value).success;

export interface ProjectAccess {
  project: typeof projects.$inferSelect;
  role: ProjectRole;
}

/**
 * The single gate for anything inside a project.
 *
 * A project the user cannot see answers "not found", exactly like a project that does not
 * exist, so its existence is not revealed. A project the user can see but may not act on
 * answers "forbidden".
 */
export async function requireProjectAccess(
  db: DbOrTx,
  user: AuthUser,
  projectId: string,
  action: ProjectAction,
): Promise<ProjectAccess> {
  if (!isUuid(projectId)) throw notFound("Project");
  // An agent access token only ever sees the project it was created for.
  if (user.token && user.token.projectId !== projectId) throw notFound("Project");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw notFound("Project");

  let memberRole: ProjectRole | null = null;
  if (!user.isOrgAdmin) {
    const [member] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
      .limit(1);
    memberRole = member?.role ?? null;
  }
  const role = effectiveRole({
    isOrgAdmin: user.isOrgAdmin,
    sameOrganization: project.organizationId === user.organizationId,
    memberRole,
  });
  if (!role) throw notFound("Project");
  if (!roleAllows(role, action)) throw forbidden();
  return { project, role };
}

export function requireOrgAdmin(user: AuthUser): void {
  if (user.token || !user.isOrgAdmin)
    throw forbidden("Only an organisation administrator can do this.");
}
