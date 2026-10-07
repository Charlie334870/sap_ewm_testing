"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
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
import { formatDateTime, TOOL_STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import type {
  ConnectionCheck,
  SapSystemDetail,
  ServiceCheck,
  ToolCall,
  ToolDescription,
  ToolEnvelope,
} from "@/lib/types";

const SERVICE_STATE: Record<ServiceCheck["state"], [string, "ok" | "bad" | "warn"]> = {
  ok: ["Answers as expected", "ok"],
  changed: ["Changed since the tools were built", "warn"],
  not_found: ["Not on this system", "bad"],
  refused: ["Access refused", "bad"],
  error: ["Failed", "bad"],
};

function Connection({
  projectId,
  system,
  canTest,
  canManage,
  onChanged,
}: {
  projectId: string;
  system: SapSystemDetail;
  canTest: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const base = `/projects/${projectId}/sap-systems/${system.id}`;
  const [check, setCheck] = useState<ConnectionCheck | null>(system.lastCheck);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [replacing, setReplacing] = useState(false);

  async function test() {
    setBusy(true);
    setError(null);
    try {
      setCheck((await api<{ check: ConnectionCheck }>(`${base}/test`, { body: {} })).check);
      onChanged();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function replaceKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await api(`${base}/credential`, {
        method: "PUT",
        body: { apiKey: new FormData(event.currentTarget).get("apiKey") },
      });
      setReplacing(false);
      await test();
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <section className="section">
      <div className="section__head">
        <h2>Connection to SAP</h2>
        <div className="form__actions">
          {canManage ? (
            <Button variant="quiet" onClick={() => setReplacing(!replacing)}>
              Replace API key
            </Button>
          ) : null}
          {canTest ? (
            <Button onClick={() => void test()} disabled={busy}>
              {busy ? "Asking SAP" : "Test connection"}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 12, maxWidth: "80ch" }}>
        {system.baseUrl}. The test asks SAP which of the services behind the tools exist, compares
        them with the definitions the tools were built on, and reads one row from each. It changes
        nothing.
      </p>
      {replacing ? (
        <form className="surface surface--padded form form-panel" onSubmit={replaceKey}>
          <Field
            label="New API key"
            hint="From api.sap.com, Show API Key. Stored encrypted; the old key is discarded."
          >
            <input
              name="apiKey"
              type="password"
              required
              autoComplete="off"
              autoFocus
              style={{ maxWidth: 420 }}
            />
          </Field>
          <div className="form__actions">
            <Button type="submit">Save key and test</Button>
          </div>
        </form>
      ) : null}
      <ErrorNote error={error} />
      {check ? (
        <>
          <p
            className={`note note--${check.reachable ? "ok" : "error"}`}
            role="status"
            style={{ marginBottom: 12 }}
          >
            {check.summary} <span className="muted">Tested {formatDateTime(check.checkedAt)}.</span>
          </p>
          <div className="surface table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SAP service</th>
                  <th>Result</th>
                  <th>Used by</th>
                  <th>Values found in SAP, to try the tools with</th>
                </tr>
              </thead>
              <tbody>
                {check.services.map((s) => {
                  const [label, tone] = SERVICE_STATE[s.state];
                  const missing = s.entitySets.flatMap((e) =>
                    e.present ? e.missingProperties.map((p) => `${e.name}.${p}`) : [e.name],
                  );
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.title}</strong>
                        <div className="muted num">
                          {s.id}, OData {s.version.toUpperCase()}
                        </div>
                      </td>
                      <td>
                        <span className={`state state--${tone}`}>{label}</span>
                        {s.detail ? <div className="muted">{s.detail}</div> : null}
                        {missing.length ? (
                          <div className="muted">Missing: {missing.join(", ")}</div>
                        ) : null}
                        {s.exposes ? (
                          <div className="muted">
                            Exposes:{" "}
                            {Object.entries(s.exposes)
                              .map(([set, props]) => `${set} (${props.length} properties)`)
                              .join(", ")}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {s.usedByTools.length ? (
                          s.usedByTools.join(", ")
                        ) : (
                          <span className="muted">No tool</span>
                        )}
                      </td>
                      <td className="num">
                        {s.example && Object.keys(s.example).length
                          ? Object.entries(s.example)
                              .map(([k, v]) => `${k} ${v}`)
                              .join(", ")
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty title="Not tested yet">
          <p>Run the test once after registering, to see which tools SAP will answer.</p>
        </Empty>
      )}
    </section>
  );
}

function Scenarios({
  projectId,
  system,
  canManage,
}: {
  projectId: string;
  system: SapSystemDetail;
  canManage: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function createTickets() {
    setError(null);
    try {
      const result = await api<{ created: unknown[]; skipped: number }>(
        `/projects/${projectId}/sap-systems/${system.id}/sample-tickets`,
        { body: {} },
      );
      setMessage(
        result.created.length
          ? `${result.created.length} practice ticket${result.created.length === 1 ? "" : "s"} created. Find them under Tickets.`
          : "The practice tickets already exist. Find them under Tickets.",
      );
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <section className="section">
      <div className="section__head">
        <h2>Practice scenarios in this simulated warehouse</h2>
        {canManage ? (
          <Button variant="quiet" onClick={() => void createTickets()}>
            Create the practice tickets
          </Button>
        ) : null}
      </div>
      <p className="muted" style={{ marginBottom: 12, maxWidth: "80ch" }}>
        Each scenario is a fault planted in warehouse MUHW. The ticket states only the symptom. The
        cause has to be found with the tools, by a person or by an agent; it is not stored anywhere
        the tools can read.
      </p>
      <ErrorNote error={error} />
      {message ? (
        <p className="note note--ok" role="status" style={{ marginBottom: 12 }}>
          {message} <Link href="/tickets">Open tickets</Link>
        </p>
      ) : null}
      <div className="surface table-wrap">
        <table>
          <thead>
            <tr>
              <th>Use case</th>
              <th>Scenario</th>
              <th>Ticket a user would raise</th>
            </tr>
          </thead>
          <tbody>
            {system.scenarios.map((s) => (
              <tr key={s.id}>
                <td className="num">{s.useCase}</td>
                <td>{s.title}</td>
                <td>{s.ticketTitle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Turns the form's text values into the typed input the tool's schema asks for. */
function buildInput(tool: ToolDescription, form: FormData): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(tool.inputSchema.properties ?? {})) {
    const raw = form.get(name);
    if (property.type === "boolean") {
      input[name] = raw === "on";
      continue;
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") continue;
    if (property.type === "integer" || property.type === "number") input[name] = Number(value);
    else if (property.type === "object") {
      // Written as field=value pairs, one per line or separated by commas.
      input[name] = Object.fromEntries(
        value
          .split(/[\n,]/)
          .map((pair) => pair.split("=").map((part) => part.trim()))
          .filter((pair) => pair.length === 2 && pair[0]),
      );
    } else input[name] = value;
  }
  return input;
}

function ToolConsole({
  projectId,
  system,
  onRan,
}: {
  projectId: string;
  system: SapSystemDetail;
  onRan: () => void;
}) {
  const catalogue = useApi<{ tools: ToolDescription[] }>("/tools");
  const tools = useMemo(() => catalogue.data?.tools ?? [], [catalogue.data]);
  const available = useMemo(() => new Map(system.tools.map((t) => [t.name, t])), [system.tools]);
  const [chosen, setChosen] = useState<string>("");
  const [result, setResult] = useState<ToolEnvelope | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Until the person picks one, show the first tool this connection can run.
  const selected =
    chosen || tools.find((t) => available.get(t.name)?.available)?.name || tools[0]?.name || "";
  const tool = tools.find((t) => t.name === selected);
  const blocked = tool ? available.get(tool.name) : undefined;

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tool) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ result: ToolEnvelope }>(
        `/projects/${projectId}/sap-systems/${system.id}/tools/${tool.name}`,
        { body: { input: buildInput(tool, new FormData(event.currentTarget)) } },
      );
      setResult(response.result);
      onRan();
    } catch (err) {
      setError(err as ApiError);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2>Run a read-only tool</h2>
      <ErrorNote error={catalogue.error} />
      <div className="console">
        <form className="surface surface--padded form" onSubmit={run} key={selected}>
          <Field label="Tool">
            <select
              value={selected}
              onChange={(e) => {
                setChosen(e.target.value);
                setResult(null);
                setError(null);
              }}
            >
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.title}
                  {available.get(t.name)?.available ? "" : " (not on this connection)"}
                </option>
              ))}
            </select>
          </Field>
          {tool ? (
            <>
              <p className="muted" style={{ fontSize: "0.9rem" }}>
                {tool.description} In SAP GUI: {tool.consultantEquivalent}.
              </p>
              {blocked && !blocked.available ? (
                <p className="note note--info">{blocked.reason}</p>
              ) : (
                <>
                  {Object.entries(tool.inputSchema.properties ?? {}).map(([name, property]) => {
                    const required = tool.inputSchema.required?.includes(name) ?? false;
                    const label = `${name}${required ? "" : " (optional)"}`;
                    if (property.type === "boolean") {
                      return (
                        <label key={name}>
                          <input
                            type="checkbox"
                            name={name}
                            defaultChecked={property.default === true}
                          />{" "}
                          {name}
                        </label>
                      );
                    }
                    return (
                      <Field
                        key={name}
                        label={label}
                        hint={
                          property.type === "object"
                            ? "One per line, as field=value. For example itemType=ODLV"
                            : property.description
                        }
                      >
                        {property.enum ? (
                          <select
                            name={name}
                            defaultValue={String(
                              property.default ?? (required ? property.enum[0] : ""),
                            )}
                          >
                            {required ? null : <option value="">Any</option>}
                            {property.enum.map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </select>
                        ) : property.type === "object" ? (
                          <textarea name={name} style={{ minHeight: 60 }} />
                        ) : (
                          <input
                            name={name}
                            required={required}
                            inputMode={property.type === "integer" ? "numeric" : undefined}
                            defaultValue={
                              property.default === undefined ? "" : String(property.default)
                            }
                            maxLength={property.maxLength}
                          />
                        )}
                      </Field>
                    );
                  })}
                  <div className="form__actions">
                    <Button type="submit" disabled={busy}>
                      {busy ? "Reading" : "Run tool"}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </form>

        <div className="result">
          <ErrorNote error={error} />
          {result ? (
            <div className="surface" aria-live="polite">
              <div className="result__head">
                <SourceTag source={result.source} />
                <span className={`state state--${result.status === "ok" ? "ok" : "bad"}`}>
                  {TOOL_STATUS_LABEL[result.status]}
                </span>
                <span className="muted num">
                  {result.system.sid}/{result.system.client} {result.system.environment},{" "}
                  {result.durationMs} ms
                </span>
                <span className="muted num" title="Quote this ID as evidence">
                  Call {result.toolCallId.slice(0, 8)}
                </span>
              </div>
              {result.status === "ok" ? (
                <pre className="result__body">{JSON.stringify(result.data, null, 2)}</pre>
              ) : (
                <div
                  className="result__body"
                  style={{ fontFamily: "inherit", fontSize: "0.95rem" }}
                >
                  <strong>{result.error?.message}</strong>
                  <p className="muted" style={{ marginTop: 6 }}>
                    No data was returned. The attempt is recorded below.
                  </p>
                </div>
              )}
            </div>
          ) : error ? null : (
            <Empty title="Nothing read yet">
              <p>
                Choose a tool and run it. The result appears here exactly as an agent would receive
                it, with its source marked.
              </p>
            </Empty>
          )}
        </div>
      </div>
    </section>
  );
}

function SystemPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const { project } = useSession();
  const base = project ? `/projects/${project.id}` : null;
  const { data, error, reload } = useApi<{ sapSystem: SapSystemDetail }>(
    base ? `${base}/sap-systems/${systemId}` : null,
  );
  const canRun = project?.role === "consultant" || project?.role === "admin";
  const calls = useApi<{ toolCalls: ToolCall[] }>(
    base && canRun ? `${base}/tool-calls?sapSystemId=${systemId}&limit=15` : null,
  );

  if (!project) return null;
  if (error) {
    return (
      <>
        <Link className="back-link" href="/sap-systems">
          All systems
        </Link>
        <ErrorNote error={error} />
      </>
    );
  }
  if (!data) return null;
  const system = data.sapSystem;

  return (
    <>
      <Link className="back-link" href="/sap-systems">
        All systems
      </Link>
      <PageHeader
        title={system.name}
        context={
          <>
            <span className="num">
              {system.sid}/{system.client}
            </span>{" "}
            <span className={`env env--${system.environment}`}>{system.environment}</span>{" "}
            <SourceTag source={system.source} />
          </>
        }
      />

      {system.source === "SAP_SANDBOX" ? (
        <Connection
          projectId={project.id}
          system={system}
          canTest={canRun}
          canManage={project.role === "admin"}
          onChanged={reload}
        />
      ) : null}
      {system.source === "SIMULATED" ? (
        <Scenarios projectId={project.id} system={system} canManage={project.role === "admin"} />
      ) : null}

      {canRun ? (
        <ToolConsole projectId={project.id} system={system} onRan={calls.reload} />
      ) : (
        <section className="section">
          <h2>Tools</h2>
          <Empty title="Not available for your role">
            <p>Consultants and project admins can run the read-only tools.</p>
          </Empty>
        </section>
      )}

      {canRun ? (
        <section className="section">
          <h2>Recent tool calls on this system</h2>
          {calls.data && calls.data.toolCalls.length === 0 ? (
            <p className="muted">
              None yet. Every call, including a refused one, is listed here with who made it.
            </p>
          ) : (
            <div className="surface table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Tool</th>
                    <th>Asked for</th>
                    <th>Result</th>
                    <th>By</th>
                    <th>Call</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.data?.toolCalls.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{formatDateTime(c.createdAt)}</td>
                      <td className="num">{c.toolName}</td>
                      <td className="num">
                        {Object.entries(c.input)
                          .filter(([k]) => k !== "limit")
                          .map(
                            ([k, v]) =>
                              `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                          )
                          .join(", ")}
                      </td>
                      <td>
                        <span className={`state state--${c.status === "ok" ? "ok" : "bad"}`}>
                          {TOOL_STATUS_LABEL[c.status]}
                        </span>
                        {c.error ? <div className="muted">{c.error}</div> : null}
                      </td>
                      <td>
                        {c.calledByName}
                        {c.viaToken ? (
                          <div className="muted">
                            through agent access &ldquo;{c.viaToken}&rdquo;
                          </div>
                        ) : null}
                      </td>
                      <td className="hash" title={c.id}>
                        {c.id.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

export default function Page() {
  return (
    <NeedsProject>
      <SystemPage />
    </NeedsProject>
  );
}
