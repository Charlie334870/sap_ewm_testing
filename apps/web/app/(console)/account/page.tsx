"use client";

import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@ewm/shared";
import { Button, ErrorNote, Field, PageHeader } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";

export default function AccountPage() {
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(null);
    setDone(false);
    if (form.get("newPassword") !== form.get("repeat")) {
      setError(new Error("The two new passwords are not the same.") as ApiError);
      return;
    }
    try {
      await api("/auth/change-password", {
        body: {
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
        },
      });
      formElement.reset();
      setDone(true);
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        title="Password"
        context="Changing your password signs you out on every other device."
      />
      <form className="surface surface--padded form" onSubmit={submit} style={{ maxWidth: 440 }}>
        <Field label="Current password">
          <input name="currentPassword" type="password" required autoComplete="current-password" />
        </Field>
        <Field
          label="New password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={error && "field" in error ? error.field("newPassword") : undefined}
        >
          <input
            name="newPassword"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
          />
        </Field>
        <Field label="New password again">
          <input
            name="repeat"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
          />
        </Field>
        {error && !("details" in error && error.details) ? <ErrorNote error={error} /> : null}
        {done ? (
          <p className="note note--ok" role="status">
            Password changed.
          </p>
        ) : null}
        <div className="form__actions">
          <Button type="submit">Change password</Button>
        </div>
      </form>
    </>
  );
}
