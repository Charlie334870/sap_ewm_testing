"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";

// The lifecycle from the master prompt. The first step is what this build can do.
const LIFECYCLE = [
  ["Raise the ticket", true],
  ["Investigate the SAP system", false],
  ["Identify the root cause, with evidence", false],
  ["Propose the fix, risk and test plan", false],
  ["Consultant approves", false],
  ["Execute, test and verify", false],
] as const;

function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", {
        body: { email: form.get("email"), password: form.get("password") },
      });
      // Only follow a path inside this site.
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>Sign in</h2>
      <Field label="Email">
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <ErrorNote error={error} />
      <div className="form__actions">
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="signin">
      <section className="signin__panel">
        <div>
          <h1>EWM Agent</h1>
          <p>
            A support console for SAP EWM projects. Tickets come in here; from later milestones the
            agent investigates them and a consultant approves every change.
          </p>
        </div>
        <ol className="signin__lifecycle" aria-label="How a ticket will move through the console">
          {LIFECYCLE.map(([step, built]) => (
            <li key={step} className={built ? "is-built" : undefined}>
              <span>
                {step}
                {built ? "" : " (not built yet)"}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section className="signin__form">
        <Suspense>
          <SignInForm />
        </Suspense>
      </section>
    </div>
  );
}
