"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { EWM_PROCESSES, TICKET_PRIORITIES, TICKET_STATUSES, type TicketStatus } from "@ewm/shared";
import {
  Button,
  Empty,
  ErrorNote,
  Field,
  NeedsProject,
  PageHeader,
  Priority,
  SimulatedTag,
  StatusPill,
} from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { formatDateTime, PROCESS_LABEL, STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { SapSystem, TicketListItem } from "@/lib/types";

function NewTicketForm({ projectId, onCancel }: { projectId: string; onCancel: () => void }) {
  const router = useRouter();
  const systems = useApi<{ sapSystems: SapSystem[] }>(`/projects/${projectId}/sap-systems`);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => (form.get(name) as string).trim() || undefined;
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await api<{ ticket: { id: string } }>(`/projects/${projectId}/tickets`, {
        body: {
          title: form.get("title"),
          description: form.get("description"),
          priority: form.get("priority"),
          process: form.get("process"),
          warehouse: optional("warehouse"),
          sapSystemId: optional("sapSystemId"),
        },
      });
      router.push(`/tickets/${projectId}/${ticket.id}`);
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <form className="surface surface--padded form form-panel" onSubmit={submit}>
      <h2>New ticket</h2>
      <Field
        label="What is going wrong?"
        hint="One sentence, with the document and warehouse if you know them."
        error={error?.field("title")}
      >
        <input
          name="title"
          required
          maxLength={200}
          autoFocus
          placeholder="Warehouse task is not being created for delivery 80001234 in warehouse MUHW"
        />
      </Field>
      <Field
        label="Details"
        hint="What you did, what you expected, the exact error text, and when it started."
        error={error?.field("description")}
      >
        <textarea name="description" maxLength={10000} />
      </Field>
      <div className="form__row">
        <Field label="Priority">
          <select name="priority" defaultValue="medium">
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0]!.toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="EWM process">
          <select name="process" defaultValue="unknown">
            {EWM_PROCESSES.map((p) => (
              <option key={p} value={p}>
                {PROCESS_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Warehouse number"
          hint="Up to 4 characters."
          error={error?.field("warehouse")}
        >
          <input name="warehouse" maxLength={4} style={{ textTransform: "uppercase" }} />
        </Field>
        <Field label="SAP system" error={error?.field("sapSystemId")}>
          <select name="sapSystemId" defaultValue="">
            <option value="">Not specified</option>
            {systems.data?.sapSystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sid}/{s.client} {s.environment}
                {s.adapter === "simulated" ? " (simulated)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && !error.details ? <ErrorNote error={error} /> : null}
      <div className="form__actions">
        <Button type="submit" disabled={busy}>
          Create ticket
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Tickets() {
  const { project } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const status = TICKET_STATUSES.find((s) => s === params.get("status")) as
    TicketStatus | undefined;
  const [creating, setCreating] = useState(params.get("new") === "1");
  const { data, error } = useApi<{ tickets: TicketListItem[] }>(
    project ? `/projects/${project.id}/tickets${status ? `?status=${status}` : ""}` : null,
  );
  if (!project) return null;
  const tickets = data?.tickets ?? [];

  return (
    <>
      <PageHeader
        title="Tickets"
        context={`${project.key} ${project.name}`}
        action={
          !creating ? <Button onClick={() => setCreating(true)}>New ticket</Button> : undefined
        }
      />
      {creating ? (
        <NewTicketForm projectId={project.id} onCancel={() => setCreating(false)} />
      ) : null}

      <div style={{ marginBottom: 14, maxWidth: 240 }}>
        <Field label="Show">
          <select
            value={status ?? ""}
            onChange={(e) =>
              router.replace(e.target.value ? `/tickets?status=${e.target.value}` : "/tickets")
            }
          >
            <option value="">All tickets</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNote error={error} />

      {data && tickets.length === 0 && !creating ? (
        <Empty
          title={status ? `No ${STATUS_LABEL[status].toLowerCase()} tickets` : "No tickets yet"}
        >
          <p>
            {status ? (
              <Link href="/tickets">Show all tickets</Link>
            ) : (
              "Raise a ticket for anything that goes wrong in the warehouse system: a task that is not created, a queue that is stuck, a failed action."
            )}
          </p>
        </Empty>
      ) : null}

      {tickets.length > 0 ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Issue</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Process</th>
                <th>Warehouse</th>
                <th>System</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="row-link">
                  <td className="num nowrap">
                    <Link className="cell-link" href={`/tickets/${project.id}/${t.id}`}>
                      {project.key}-{t.number}
                    </Link>
                  </td>
                  <td style={{ minWidth: 260 }}>{t.title}</td>
                  <td>
                    <StatusPill status={t.status} />
                  </td>
                  <td>
                    <Priority priority={t.priority} />
                  </td>
                  <td className="nowrap">
                    {t.process === "unknown" ? (
                      <span className="muted">–</span>
                    ) : (
                      PROCESS_LABEL[t.process]
                    )}
                  </td>
                  <td className="num">{t.warehouse ?? <span className="muted">–</span>}</td>
                  <td className="nowrap">
                    {t.sapSystemSid ? (
                      <>
                        {t.sapSystemSid} <SimulatedTag adapter={t.sapSystemAdapter} />
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td className="nowrap">{formatDateTime(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

export default function TicketsPage() {
  return (
    <NeedsProject>
      <Suspense>
        <Tickets />
      </Suspense>
    </NeedsProject>
  );
}
