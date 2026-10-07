"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { TICKET_STATUSES, type TicketStatus } from "@ewm/shared";
import { Button, ErrorNote, Field, Priority, SimulatedTag, StatusPill } from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { formatDateTime, PROCESS_LABEL, STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { TicketDetail, TicketEvent } from "@/lib/types";

function eventLine(event: TicketEvent): string {
  if (event.type === "created") return "raised the ticket";
  if (event.type === "comment") return "commented";
  if (event.type === "status_changed") {
    const from = STATUS_LABEL[event.data.from as TicketStatus] ?? event.data.from;
    const to = STATUS_LABEL[event.data.to as TicketStatus] ?? event.data.to;
    return `changed the status from ${from?.toLowerCase()} to ${to?.toLowerCase()}`;
  }
  return event.type;
}

export default function TicketPage() {
  const { projectId, ticketId } = useParams<{ projectId: string; ticketId: string }>();
  const { projects, project: current, selectProject } = useSession();
  const base = `/projects/${projectId}/tickets/${ticketId}`;
  const { data, error, reload } = useApi<{ ticket: TicketDetail }>(base);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Opening a ticket by link switches the console to the ticket's project.
  useEffect(() => {
    if (current?.id !== projectId && projects.some((p) => p.id === projectId))
      selectProject(projectId);
  }, [current?.id, projectId, projects, selectProject]);

  const role = projects.find((p) => p.id === projectId)?.role;
  const canChangeStatus = role === "consultant" || role === "admin";

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await run();
      reload();
    } catch (err) {
      setActionError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get("body");
    void act(async () => {
      await api(`${base}/comments`, { body: { body } });
      form.reset();
    });
  }

  function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(() => api(`${base}/status`, { body: { status: form.get("status") } }));
  }

  if (error) {
    return (
      <>
        <Link className="back-link" href="/tickets">
          All tickets
        </Link>
        <ErrorNote error={error} />
      </>
    );
  }
  if (!data) return null;
  const t = data.ticket;

  return (
    <>
      <Link className="back-link" href="/tickets">
        All tickets
      </Link>
      <div className="ticket">
        <div>
          <p className="ticket__ref">{t.reference}</p>
          <h1>{t.title}</h1>
          {t.description ? <p className="ticket__description">{t.description}</p> : null}

          <section className="section">
            <h2>Investigation</h2>
            <p className="note note--info">
              The built-in agent&apos;s investigation, root cause, evidence and proposed solution
              will appear here from Milestone 3. Until then you can read the system yourself under{" "}
              <Link href={t.sapSystemId ? `/sap-systems/${t.sapSystemId}` : "/sap-systems"}>
                SAP Systems
              </Link>
              , or let Claude investigate with the same read-only tools through{" "}
              <Link href="/agent-access">agent access</Link>.
            </p>
          </section>

          <section className="section">
            <h2>Timeline</h2>
            <ol className="timeline">
              {t.events.map((event) => (
                <li
                  key={event.id}
                  className={event.type === "status_changed" ? "timeline__status" : undefined}
                >
                  <p className="timeline__meta">
                    <strong>{event.actorName ?? "System"}</strong> {eventLine(event)},{" "}
                    <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                  </p>
                  {event.body ? <p className="timeline__body">{event.body}</p> : null}
                </li>
              ))}
            </ol>
            <form className="form" onSubmit={comment} style={{ maxWidth: 640 }}>
              <Field label="Add a comment">
                <textarea name="body" required maxLength={10000} />
              </Field>
              <ErrorNote error={actionError} />
              <div className="form__actions">
                <Button type="submit" disabled={busy}>
                  Add comment
                </Button>
              </div>
            </form>
          </section>
        </div>

        <aside className="surface surface--padded">
          <dl className="facts">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusPill status={t.status} />
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <Priority priority={t.priority} />
              </dd>
            </div>
            <div>
              <dt>EWM process</dt>
              <dd>{PROCESS_LABEL[t.process]}</dd>
            </div>
            <div>
              <dt>Warehouse</dt>
              <dd className="num">{t.warehouse ?? <span className="muted">Not specified</span>}</dd>
            </div>
            <div>
              <dt>SAP system</dt>
              <dd>
                {t.sapSystemSid ? (
                  <>
                    <span className="num">
                      {t.sapSystemSid}/{t.sapSystemClient}
                    </span>{" "}
                    <span className={`env env--${t.sapSystemEnvironment}`}>
                      {t.sapSystemEnvironment}
                    </span>{" "}
                    <SimulatedTag adapter={t.sapSystemAdapter} />
                    <div className="muted">{t.sapSystemName}</div>
                  </>
                ) : (
                  <span className="muted">Not specified</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Raised by</dt>
              <dd>
                {t.reportedByName}
                <div className="muted">{formatDateTime(t.createdAt)}</div>
              </dd>
            </div>
          </dl>

          {canChangeStatus ? (
            <form className="form" onSubmit={changeStatus} style={{ marginTop: 20 }} key={t.status}>
              <Field label="Change status">
                <select name="status" defaultValue={t.status}>
                  {TICKET_STATUSES.map((s) => (
                    <option key={s} value={s} disabled={s === t.status}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form__actions">
                <Button type="submit" variant="quiet" disabled={busy}>
                  Save status
                </Button>
              </div>
            </form>
          ) : null}
        </aside>
      </div>
    </>
  );
}
