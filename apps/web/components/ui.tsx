"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { SapAdapter, TicketPriority, TicketStatus } from "@ewm/shared";
import type { ApiError } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";

export function PageHeader({
  title,
  context,
  action,
}: {
  title: string;
  context?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {context ? <p className="page-header__context">{context}</p> : null}
      </div>
      {action ? <div className="page-header__action">{action}</div> : null}
    </header>
  );
}

export function Button({
  variant = "primary",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "quiet" }) {
  return <button {...props} className={`button button--${variant} ${props.className ?? ""}`} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field ${error ? "field--invalid" : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function ErrorNote({ error }: { error: ApiError | Error | null | undefined }) {
  if (!error) return null;
  return (
    <p className="note note--error" role="alert">
      {error.message}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children ? <div className="empty__body">{children}</div> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: TicketStatus }) {
  return <span className={`pill pill--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Priority({ priority }: { priority: TicketPriority }) {
  return <span className={`priority priority--${priority}`}>{priority}</span>;
}

/**
 * Hazard-tape marker for anything that is not real SAP. It appears wherever a simulated system,
 * or data that came from one, is shown, so a simulated result can never pass for a real one.
 */
export function SimulatedTag({ adapter }: { adapter: SapAdapter | null | undefined }) {
  if (adapter !== "simulated") return null;
  return (
    <span
      className="simulated"
      title="This is a simulated system. Nothing here comes from a real SAP system."
    >
      Simulated
    </span>
  );
}

/** Wraps a page that needs a project. Shows what to do when the user has none. */
export function NeedsProject({ children }: { children: ReactNode }) {
  const { project, user } = useSession();
  if (project) return <>{children}</>;
  return (
    <Empty title="No project yet">
      {user.isOrgAdmin ? (
        <p>
          Everything in the console belongs to a project.{" "}
          <Link href="/projects">Create your first project</Link> to start.
        </p>
      ) : (
        <p>
          You are not a member of any project. Ask an administrator of your organisation to add you.
        </p>
      )}
    </Empty>
  );
}
