"use client";

import { useState, type FormEvent } from "react";
import { ENVIRONMENT_KINDS } from "@ewm/shared";
import {
  Button,
  Empty,
  ErrorNote,
  Field,
  NeedsProject,
  PageHeader,
  SimulatedTag,
} from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { SapSystem } from "@/lib/types";

function NewSystemForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (created: boolean) => void;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${projectId}/sap-systems`, {
        body: {
          name: form.get("name"),
          sid: form.get("sid"),
          client: form.get("client"),
          environment: form.get("environment"),
          deployment: form.get("deployment"),
          adapter: "simulated",
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
      <h2>
        Register a system <SimulatedTag adapter="simulated" />
      </h2>
      <p className="muted">
        Only simulated systems can be registered in this build. A simulated system is a stand-in
        used to build and test the agent; it holds no data from any real SAP system.
      </p>
      <Field label="Name" error={error?.field("name")}>
        <input
          name="name"
          required
          maxLength={120}
          placeholder="Simulated S/4HANA embedded EWM"
          autoFocus
        />
      </Field>
      <div className="form__row">
        <Field label="System ID" hint="3 characters, for example S4D." error={error?.field("sid")}>
          <input name="sid" required maxLength={3} style={{ textTransform: "uppercase" }} />
        </Field>
        <Field label="Client" hint="3 digits, for example 100." error={error?.field("client")}>
          <input name="client" required maxLength={3} inputMode="numeric" />
        </Field>
        <Field label="Environment">
          <select name="environment" defaultValue="DEV">
            {ENVIRONMENT_KINDS.map((kind) => (
              <option key={kind}>{kind}</option>
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
      {error && !error.details ? <ErrorNote error={error} /> : null}
      <div className="form__actions">
        <Button type="submit" disabled={busy}>
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
  const { data, error, reload } = useApi<{ sapSystems: SapSystem[] }>(
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
              ? "Register a simulated system so tickets can be filed against it. Real SAP connections arrive with Milestone 6."
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
                <th>EWM</th>
                <th>Connection</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id}>
                  <td className="num">
                    <strong>{s.sid}</strong>
                  </td>
                  <td className="num">{s.client}</td>
                  <td>
                    <span className={`env env--${s.environment}`}>{s.environment}</span>
                  </td>
                  <td>{s.name}</td>
                  <td>{s.deployment === "embedded" ? "Embedded" : "Decentralized"}</td>
                  <td>
                    {s.adapter === "simulated" ? <SimulatedTag adapter="simulated" /> : "SAP"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
