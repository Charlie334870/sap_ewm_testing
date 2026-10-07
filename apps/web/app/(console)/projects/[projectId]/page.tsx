"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PROJECT_ROLES, type ProjectRole } from "@ewm/shared";
import { Button, ErrorNote, Field, PageHeader } from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { formatDate, ROLE_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Environment, Member, ProjectListItem } from "@/lib/types";

interface Detail {
  project: ProjectListItem;
  environments: Environment[];
  members: Member[];
}

const ROLE_HELP: Record<ProjectRole, string> = {
  analyst: "Raises tickets and comments.",
  consultant: "Also changes ticket status and reads the audit log.",
  admin: "Also manages members and SAP systems.",
};

function AddMember({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const candidates = useApi<{ users: Array<{ id: string; name: string; email: string }> }>(
    `/projects/${projectId}/member-candidates`,
  );
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      await api(`/projects/${projectId}/members`, {
        method: "PUT",
        body: { userId: form.get("userId"), role: form.get("role") },
      });
      candidates.reload();
      onAdded();
    } catch (err) {
      setError(err as ApiError);
    }
  }

  const users = candidates.data?.users ?? [];
  if (candidates.data && users.length === 0) {
    return (
      <p className="muted">Everyone in your organisation is already a member of this project.</p>
    );
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="form__row">
        <Field label="Person">
          <select name="userId" required defaultValue="">
            <option value="" disabled>
              Choose a person
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role">
          <select name="role" defaultValue="analyst">
            {PROJECT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNote error={error ?? candidates.error} />
      <div className="form__actions">
        <Button type="submit">Add member</Button>
      </div>
    </form>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, project: current, selectProject } = useSession();
  const { data, error, reload } = useApi<Detail>(`/projects/${projectId}`);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  if (error) {
    return (
      <>
        <Link className="back-link" href="/projects">
          All projects
        </Link>
        <ErrorNote error={error} />
      </>
    );
  }
  if (!data) return null;
  const { project, environments, members } = data;
  const canManage = project.role === "admin";

  async function change(userId: string, role: ProjectRole | null) {
    setActionError(null);
    try {
      if (role)
        await api(`/projects/${projectId}/members`, { method: "PUT", body: { userId, role } });
      else await api(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError(err as ApiError);
    }
  }

  return (
    <>
      <Link className="back-link" href="/projects">
        All projects
      </Link>
      <PageHeader
        title={`${project.key} ${project.name}`}
        context={
          project.description ||
          `Created ${formatDate(project.createdAt)}. Your role: ${ROLE_LABEL[project.role]}.`
        }
        action={
          current?.id === project.id ? undefined : (
            <Button variant="quiet" onClick={() => selectProject(project.id)}>
              Work in this project
            </Button>
          )
        }
      />

      <section className="section">
        <h2>Members</h2>
        <ErrorNote error={actionError} />
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Can do</th>
                {canManage ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>
                    {m.name}
                    {m.isActive ? null : <span className="muted"> (deactivated)</span>}
                  </td>
                  <td>{m.email}</td>
                  <td>
                    {canManage && m.userId !== user.id ? (
                      <select
                        aria-label={`Role of ${m.name}`}
                        value={m.role}
                        onChange={(e) => void change(m.userId, e.target.value as ProjectRole)}
                      >
                        {PROJECT_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABEL[m.role]
                    )}
                  </td>
                  <td className="muted">{ROLE_HELP[m.role]}</td>
                  {canManage ? (
                    <td className="nowrap">
                      {m.userId !== user.id ? (
                        <button
                          className="link-button link-button--danger"
                          onClick={() => void change(m.userId, null)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <div className="surface surface--padded" style={{ marginTop: 16 }}>
            <AddMember projectId={project.id} onAdded={reload} />
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2>Environments</h2>
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>Agent may run without approval</th>
                <th>Change record required</th>
              </tr>
            </thead>
            <tbody>
              {environments.map((env) => (
                <tr key={env.id}>
                  <td>
                    <span className={`env env--${env.kind}`}>{env.kind}</span>
                  </td>
                  <td>
                    {env.maxAutoToolLevel === 0
                      ? "Read-only tools only"
                      : "Read-only and low-risk tools"}
                  </td>
                  <td>{env.requiresChangeReference ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "0.9rem" }}>
          These limits apply once the agent and SAP tools exist (Milestone 2 onward). Changes always
          need a human approval.
        </p>
      </section>
    </>
  );
}
