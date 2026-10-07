"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Empty, ErrorNote, Field, PageHeader } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";
import { formatDate, ROLE_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const { reloadProjects, selectProject } = useSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { project } = await api<{ project: { id: string } }>("/projects", {
        body: {
          key: form.get("key"),
          name: form.get("name"),
          description: form.get("description"),
        },
      });
      await reloadProjects();
      selectProject(project.id);
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface surface--padded form form-panel" onSubmit={submit}>
      <h2>New project</h2>
      <div className="form__row">
        <Field
          label="Key"
          hint="Short code used in ticket numbers, for example MUHW gives MUHW-1."
          error={error?.field("key")}
        >
          <input
            name="key"
            required
            maxLength={10}
            autoFocus
            style={{ textTransform: "uppercase" }}
          />
        </Field>
        <Field label="Name" error={error?.field("name")}>
          <input name="name" required maxLength={120} />
        </Field>
      </div>
      <Field
        label="Description"
        hint="Optional. Client, scope, warehouses."
        error={error?.field("description")}
      >
        <textarea name="description" maxLength={2000} />
      </Field>
      {error && !error.details ? <ErrorNote error={error} /> : null}
      <div className="form__actions">
        <Button type="submit" disabled={busy}>
          Create project
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function ProjectsPage() {
  const { projects, user, project: current } = useSession();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        context="Each project keeps its own tickets, SAP systems, members and audit trail. Nothing is shared between projects."
        action={
          user.isOrgAdmin && !creating ? (
            <Button onClick={() => setCreating(true)}>New project</Button>
          ) : undefined
        }
      />
      {creating ? <NewProjectForm onDone={() => setCreating(false)} /> : null}

      {projects.length === 0 && !creating ? (
        <Empty title="No projects yet">
          {user.isOrgAdmin ? (
            <p>Create a project for each client engagement. You become its first admin.</p>
          ) : (
            <p>
              You are not a member of any project. Ask an administrator of your organisation to add
              you.
            </p>
          )}
        </Empty>
      ) : null}

      {projects.length > 0 ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Your role</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="row-link">
                  <td className="num">
                    <Link className="cell-link" href={`/projects/${p.id}`}>
                      {p.key}
                    </Link>
                  </td>
                  <td>
                    {p.name}
                    {p.id === current?.id ? <span className="muted"> (selected)</span> : null}
                  </td>
                  <td>{ROLE_LABEL[p.role]}</td>
                  <td className="nowrap">{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
