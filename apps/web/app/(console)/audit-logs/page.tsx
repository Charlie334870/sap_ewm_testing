"use client";

import { useEffect, useState } from "react";
import { Button, Empty, ErrorNote, NeedsProject, PageHeader } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";
import { actionLabel, auditDetail, formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { AuditEntry } from "@/lib/types";

interface Page {
  entries: AuditEntry[];
  nextBefore: number | null;
}
interface Verification {
  ok: boolean;
  entries: number;
  brokenAtSeq?: number;
  reason?: string;
}

function AuditLog() {
  const { project, user } = useSession();
  const canView = project?.role === "consultant" || project?.role === "admin";
  // Organisation administrators can also see entries that belong to no project (sign-ins, users).
  const [scope, setScope] = useState<"project" | "organisation">("project");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);

  const path = scope === "organisation" ? "/audit-logs" : `/projects/${project?.id}/audit-logs`;

  useEffect(() => {
    if (!project || !canView) return;
    let cancelled = false;
    setLoaded(false);
    setVerification(null);
    api<Page>(`${path}?limit=50`)
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setNextBefore(page.nextBefore);
        setError(null);
        setLoaded(true);
      })
      .catch((err: ApiError) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [path, project, canView]);

  if (!project) return null;

  async function more() {
    try {
      const page = await api<Page>(`${path}?limit=50&before=${nextBefore}`);
      setEntries((current) => [...current, ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(err as ApiError);
    }
  }

  async function verify() {
    try {
      setVerification(await api<Verification>("/audit-logs/verify"));
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        title="Audit Logs"
        context={scope === "organisation" ? "Whole organisation" : `${project.key} ${project.name}`}
        action={
          user.isOrgAdmin ? (
            <div className="verify">
              <Button
                variant="quiet"
                onClick={() => setScope(scope === "project" ? "organisation" : "project")}
              >
                {scope === "project" ? "Show whole organisation" : "Show this project only"}
              </Button>
              <Button variant="quiet" onClick={() => void verify()}>
                Check integrity
              </Button>
            </div>
          ) : undefined
        }
      />

      {verification ? (
        verification.ok ? (
          <p className="note note--ok" role="status" style={{ marginBottom: 16 }}>
            All {verification.entries} entries of your organisation check out. Nothing was changed
            or removed after it was written.
          </p>
        ) : (
          <p className="note note--error" role="alert" style={{ marginBottom: 16 }}>
            The log is broken at entry {verification.brokenAtSeq}. {verification.reason} Treat
            everything from that entry onward as unreliable and investigate who had database access.
          </p>
        )
      ) : null}
      <ErrorNote error={error} />

      {!canView ? (
        <Empty title="Not available for your role">
          <p>Consultants and project admins can read the audit log of a project.</p>
        </Empty>
      ) : loaded && entries.length === 0 ? (
        <Empty title="Nothing recorded yet" />
      ) : (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
                {scope === "organisation" ? <th>Project</th> : null}
                <th>Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td>
                  <td className="nowrap">{formatDateTime(e.createdAt)}</td>
                  <td>{e.actorName ?? (e.actorType === "system" ? "System" : "Unknown")}</td>
                  <td className="nowrap">{actionLabel(e.action)}</td>
                  <td>{auditDetail(e.data)}</td>
                  {scope === "organisation" ? <td className="num">{e.projectKey ?? ""}</td> : null}
                  <td className="hash" title={e.hash}>
                    {e.hash.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextBefore && canView ? (
        <div style={{ marginTop: 16 }}>
          <Button variant="quiet" onClick={() => void more()}>
            Show older entries
          </Button>
        </div>
      ) : null}
      {canView ? (
        <p className="muted" style={{ marginTop: 16, fontSize: "0.9rem", maxWidth: "75ch" }}>
          Entries cannot be edited or deleted. Each one carries a fingerprint computed from its
          content and the entry before it, so a later change to any entry is detectable.
        </p>
      ) : null}
    </>
  );
}

export default function AuditLogsPage() {
  return (
    <NeedsProject>
      <AuditLog />
    </NeedsProject>
  );
}
