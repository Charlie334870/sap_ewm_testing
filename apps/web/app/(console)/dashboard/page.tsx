"use client";

import Link from "next/link";
import { CURRENT_MILESTONE, SECTIONS, TICKET_STATUSES } from "@ewm/shared";
import { Empty, ErrorNote, NeedsProject, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDateTime, STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Summary } from "@/lib/types";

function describe(event: Summary["recentActivity"][number]): string {
  const who = event.actorName ?? "Someone";
  if (event.type === "created") return `${who} raised the ticket`;
  if (event.type === "comment") return `${who} commented`;
  if (event.type === "status_changed") {
    const to = STATUS_LABEL[event.data.to as keyof typeof STATUS_LABEL] ?? event.data.to;
    return `${who} set the status to ${to?.toLowerCase()}`;
  }
  return `${who}: ${event.type}`;
}

function ProjectDashboard() {
  const { project } = useSession();
  const { data, error } = useApi<Summary>(project ? `/projects/${project.id}/summary` : null);
  if (!project) return null;

  return (
    <>
      <PageHeader title="Dashboard" context={`${project.key} ${project.name}`} />
      <ErrorNote error={error} />

      <section aria-label="Tickets by status" className="surface status-strip">
        {TICKET_STATUSES.map((status) => (
          <Link key={status} href={`/tickets?status=${status}`}>
            <strong>{data ? (data.ticketsByStatus[status] ?? 0) : "–"}</strong>
            {STATUS_LABEL[status]}
          </Link>
        ))}
      </section>

      <div className="two-col section">
        <section>
          <h2>Recent ticket activity</h2>
          {data && data.recentActivity.length === 0 ? (
            <Empty title="No tickets yet">
              <p>
                <Link href="/tickets?new=1">Raise the first ticket</Link> for this project.
              </p>
            </Empty>
          ) : (
            <ul className="surface activity" style={{ marginTop: 10 }}>
              {data?.recentActivity.map((event) => (
                <li key={event.id}>
                  <Link href={`/tickets/${project.id}/${event.ticketId}`}>
                    {project.key}-{event.ticketNumber} {event.ticketTitle}
                  </Link>
                  <div>
                    {describe(event)}{" "}
                    <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>What this build can do</h2>
          <ul className="surface build-list" style={{ marginTop: 10 }}>
            {SECTIONS.map((section) => (
              <li key={section.slug}>
                <span>{section.label}</span>
                {section.liveFrom <= CURRENT_MILESTONE ? (
                  <span className="is-live">Working</span>
                ) : (
                  <span className="muted">Milestone {section.liveFrom}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 10, fontSize: "0.9rem" }}>
            This is Milestone {CURRENT_MILESTONE}: read-only SAP tools on a simulated system and on
            SAP&apos;s API sandbox. The built-in agent arrives with Milestone 3; until then Claude
            can use the tools through <Link href="/agent-access">agent access</Link>.
          </p>
        </section>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <NeedsProject>
      <ProjectDashboard />
    </NeedsProject>
  );
}
