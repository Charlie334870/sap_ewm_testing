"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { DEFAULT_SANDBOX_URL, ENVIRONMENT_KINDS } from "@ewm/shared";
import {
  Button,
  Empty,
  ErrorNote,
  Field,
  NeedsProject,
  PageHeader,
  SourceTag,
} from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { SapSystem } from "@/lib/types";

type Kind = "simulated" | "sap_api_sandbox";

function NewSystemForm({
  projectId,
  canStoreSecrets,
  onDone,
}: {
  projectId: string;
  canStoreSecrets: boolean;
  onDone: (created: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>("simulated");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${projectId}/sap-systems`, {
        body:
          kind === "simulated"
            ? {
                adapter: "simulated",
                name: form.get("name"),
                sid: form.get("sid"),
                client: form.get("client"),
                environment: form.get("environment"),
                deployment: form.get("deployment"),
              }
            : {
                adapter: "sap_api_sandbox",
                name: form.get("name"),
                baseUrl: form.get("baseUrl"),
                apiKey: form.get("apiKey"),
              },
      });
      onDone(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface surface--padded form form-panel" onSubmit={submit}>
      <h2>Register a system</h2>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label" style={{ marginBottom: 6 }}>
          Kind of connection
        </legend>
        <div className="choice">
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === "simulated"}
              onChange={() => setKind("simulated")}
            />
            Simulated system
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === "sap_api_sandbox"}
              onChange={() => setKind("sap_api_sandbox")}
            />
            SAP API sandbox
          </label>
        </div>
      </fieldset>

      {kind === "simulated" ? (
        <>
          <p className="muted">
            A built-in practice warehouse with planted faults. All eleven tools work on it. It holds
            no data from any real SAP system, and every result is marked Simulated.
          </p>
          <Field label="Name" error={error?.field("name")}>
            <input
              name="name"
              required
              maxLength={120}
              defaultValue="Simulated S/4HANA embedded EWM"
            />
          </Field>
          <div className="form__row">
            <Field
              label="System ID"
              hint="3 characters, for example S4D."
              error={error?.field("sid")}
            >
              <input name="sid" required maxLength={3} style={{ textTransform: "uppercase" }} />
            </Field>
            <Field label="Client" hint="3 digits, for example 100." error={error?.field("client")}>
              <input name="client" required maxLength={3} inputMode="numeric" />
            </Field>
            <Field label="Environment">
              <select name="environment" defaultValue="DEV">
                {ENVIRONMENT_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="EWM deployment">
              <select name="deployment" defaultValue="embedded">
                <option value="embedded">Embedded in S/4HANA</option>
                <option value="decentralized">Decentralized</option>
              </select>
            </Field>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            A real connection to SAP&apos;s public API sandbox at api.sap.com: real SAP software
            answering with SAP&apos;s demo data. It is free, read-only and not a client system. Six
            of the eleven tools can run over it; the others need APIs that SAP has not released.
          </p>
          {canStoreSecrets ? null : (
            <p className="note note--error">
              The server has no SECRETS_KEY, so it cannot store an API key safely. Add SECRETS_KEY
              to the .env file and restart; docs/SETUP.md shows how.
            </p>
          )}
          <Field label="Name" error={error?.field("name")}>
            <input
              name="name"
              required
              maxLength={120}
              defaultValue="SAP API sandbox (S/4HANA Cloud demo data)"
            />
          </Field>
          <Field
            label="API key"
            hint="Sign in at api.sap.com with your SAP ID, open any API, and choose Show API Key. The key is stored encrypted and never shown again."
            error={error?.field("apiKey")}
          >
            <input name="apiKey" type="password" required autoComplete="off" />
          </Field>
          <Field
            label="Sandbox address"
            hint="Leave as it is unless SAP changes it."
            error={error?.field("baseUrl")}
          >
            <input name="baseUrl" defaultValue={DEFAULT_SANDBOX_URL} />
          </Field>
        </>
      )}
      {error && !error.details ? <ErrorNote error={error} /> : null}
      <div className="form__actions">
        <Button type="submit" disabled={busy || (kind === "sap_api_sandbox" && !canStoreSecrets)}>
          Register system
        </Button>
        <Button type="button" variant="quiet" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Systems() {
  const { project } = useSession();
  const { data, error, reload } = useApi<{ sapSystems: SapSystem[]; canStoreSecrets: boolean }>(
    project ? `/projects/${project.id}/sap-systems` : null,
  );
  const [creating, setCreating] = useState(false);
  if (!project) return null;
  const canManage = project.role === "admin";
  const systems = data?.sapSystems ?? [];

  return (
    <>
      <PageHeader
        title="SAP Systems"
        context={`${project.key} ${project.name}`}
        action={
          canManage && !creating ? (
            <Button onClick={() => setCreating(true)}>Register a system</Button>
          ) : undefined
        }
      />
      {creating ? (
        <NewSystemForm
          projectId={project.id}
          canStoreSecrets={data?.canStoreSecrets ?? false}
          onDone={(created) => {
            setCreating(false);
            if (created) reload();
          }}
        />
      ) : null}
      <ErrorNote error={error} />

      {data && systems.length === 0 && !creating ? (
        <Empty title="No systems registered">
          <p>
            {canManage
              ? "Register a simulated system to practise on, or SAP's API sandbox to read from real SAP software. Client systems can be connected from Milestone 6."
              : "A project admin can register the systems of this project."}
          </p>
        </Empty>
      ) : null}

      {systems.length > 0 ? (
        <div className="surface table-wrap">
          <table>
            <thead>
              <tr>
                <th>System</th>
                <th>Client</th>
                <th>Environment</th>
                <th>Name</th>
                <th>Connection</th>
                <th>Last connection test</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className="row-link">
                  <td className="num">
                    <Link className="cell-link" href={`/sap-systems/${s.id}`}>
                      {s.sid}
                    </Link>
                  </td>
                  <td className="num">{s.client}</td>
                  <td>
                    <span className={`env env--${s.environment}`}>{s.environment}</span>
                  </td>
                  <td>{s.name}</td>
                  <td>
                    <SourceTag source={s.source} />
                  </td>
                  <td>
                    {s.source === "SIMULATED" ? (
                      <span className="muted">Not needed</span>
                    ) : s.lastCheck ? (
                      <span className={`state state--${s.lastCheck.reachable ? "ok" : "bad"}`}>
                        {s.lastCheck.reachable ? "Reachable" : "Not reachable"}
                      </span>
                    ) : (
                      <span className="muted">Not tested yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {systems.length > 0 ? (
        <p className="muted" style={{ marginTop: 12, fontSize: "0.9rem" }}>
          Open a system to run the read-only tools on it.
        </p>
      ) : null}
    </>
  );
}

export default function SapSystemsPage() {
  return (
    <NeedsProject>
      <Systems />
    </NeedsProject>
  );
}
