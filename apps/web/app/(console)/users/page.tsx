"use client";

import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@ewm/shared";
import { Button, Empty, ErrorNote, Field, PageHeader } from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface UserRow {
  id: string;
  email: string;
  name: string;
  isOrgAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
}

export default function UsersPage() {
  const { user } = useSession();
  const { data, error, reload } = useApi<{ users: UserRow[] }>(user.isOrgAdmin ? "/users" : null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [resetError, setResetError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!user.isOrgAdmin) {
    return (
      <>
        <PageHeader title="Users" />
        <Empty title="Not available for your role">
          <p>Only an administrator of your organisation manages users.</p>
        </Empty>
      </>
    );
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    try {
      await api("/users", {
        body: {
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          isOrgAdmin: form.get("isOrgAdmin") === "on",
        },
      });
      setCreating(false);
      reload();
    } catch (err) {
      setFormError(err as ApiError);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetting) return;
    setResetError(null);
    try {
      await api(`/users/${resetting.id}/reset-password`, {
        body: { password: new FormData(event.currentTarget).get("password") },
      });
      setNotice(
        `New password set for ${resetting.name}. They are signed out everywhere and should change it after signing in.`,
      );
      setResetting(null);
    } catch (err) {
      setResetError(err as ApiError);
    }
  }

  async function setActive(id: string, isActive: boolean) {
    setActionError(null);
    try {
      await api(`/users/${id}`, { method: "PATCH", body: { isActive } });
      reload();
    } catch (err) {
      setActionError(err as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        context="People in your organisation. A user sees a project only after being added to it as a member."
        action={!creating ? <Button onClick={() => setCreating(true)}>New user</Button> : undefined}
      />
      {creating ? (
        <form className="surface surface--padded form form-panel" onSubmit={create}>
          <h2>New user</h2>
          <div className="form__row">
            <Field label="Name" error={formError?.field("name")}>
              <input name="name" required maxLength={120} autoFocus />
            </Field>
            <Field label="Email" error={formError?.field("email")}>
              <input name="email" type="email" required />
            </Field>
            <Field
              label="First password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. Ask them to change it after signing in.`}
              error={formError?.field("password")}
            >
              <input
                name="password"
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <label>
            <input type="checkbox" name="isOrgAdmin" /> Organisation administrator: sees every
            project and manages users
          </label>
          {formError && !formError.details ? <ErrorNote error={formError} /> : null}
          <div className="form__actions">
            <Button type="submit">Create user</Button>
            <Button type="button" variant="quiet" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {resetting ? (
        <form className="surface surface--padded form form-panel" onSubmit={resetPassword}>
          <h2>Set a new password for {resetting.name}</h2>
          <Field
            label="New password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Give it to them in person or by phone, not by email.`}
            error={resetError?.field("password")}
          >
            <input
              name="password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              autoFocus
              style={{ maxWidth: 360 }}
            />
          </Field>
          {resetError && !resetError.details ? <ErrorNote error={resetError} /> : null}
          <div className="form__actions">
            <Button type="submit">Set password</Button>
            <Button type="button" variant="quiet" onClick={() => setResetting(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {notice ? (
        <p className="note note--ok" role="status" style={{ marginBottom: 16 }}>
          {notice}
        </p>
      ) : null}
      <ErrorNote error={error ?? actionError} />
      <div className="surface table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Access</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  {u.isActive
                    ? u.isOrgAdmin
                      ? "Organisation administrator"
                      : "By project membership"
                    : "Deactivated"}
                </td>
                <td className="nowrap">
                  {u.lastLoginAt ? (
                    formatDateTime(u.lastLoginAt)
                  ) : (
                    <span className="muted">Never</span>
                  )}
                </td>
                <td className="nowrap">
                  {u.id === user.id ? (
                    <span className="muted">You</span>
                  ) : u.isActive ? (
                    <span style={{ display: "inline-flex", gap: 14 }}>
                      <button
                        className="link-button"
                        onClick={() => {
                          setNotice(null);
                          setResetError(null);
                          setResetting(u);
                        }}
                      >
                        Set password
                      </button>
                      <button
                        className="link-button link-button--danger"
                        onClick={() => void setActive(u.id, false)}
                      >
                        Deactivate
                      </button>
                    </span>
                  ) : (
                    <button className="link-button" onClick={() => void setActive(u.id, true)}>
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
