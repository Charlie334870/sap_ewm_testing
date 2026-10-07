"use client";

import { useState, type FormEvent } from "react";
import { Button, Empty, ErrorNote, Field, NeedsProject, PageHeader } from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { ApiToken } from "@/lib/types";

interface NewToken {
  id: string;
  name: string;
  token: string;
  expiresAt: string;
}

function configSnippet(folder: string, token: string): string {
  const script = `${folder.replace(/[\\/]+$/, "")}${folder.includes("\\") ? "\\" : "/"}apps${folder.includes("\\") ? "\\" : "/"}mcp${
    folder.includes("\\") ? "\\" : "/"
  }dist${folder.includes("\\") ? "\\" : "/"}ewm-mcp.mjs`;
  return JSON.stringify(
    {
      mcpServers: {
        "ewm-agent": {
          command: "node",
          args: [script],
          env: { EWM_API_URL: window.location.origin, EWM_API_TOKEN: token },
        },
      },
    },
    null,
    2,
  );
}

function AgentAccess() {
  const { project, user } = useSession();
  const allowed = project?.role === "consultant" || project?.role === "admin";
  const base = project ? `/projects/${project.id}/api-tokens` : null;
  const { data, error, reload } = useApi<{ tokens: ApiToken[] }>(allowed ? base : null);
  const [created, setCreated] = useState<NewToken | null>(null);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [folder, setFolder] = useState("C:\\Users\\you\\sap_ewm_testing");
  const [copied, setCopied] = useState<string | null>(null);

  if (!project) return null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    try {
      const res = await api<{ token: NewToken }>(base!, {
        body: { name: form.get("name"), expiresInDays: Number(form.get("expiresInDays")) },
      });
      setCreated(res.token);
      reload();
    } catch (err) {
      setFormError(err as ApiError);
    }
  }

  async function revoke(id: string) {
    setActionError(null);
    try {
      await api(`${base}/${id}`, { method: "DELETE" });
      if (created?.id === id) setCreated(null);
      reload();
    } catch (err) {
      setActionError(err as ApiError);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }

  const tokens = data?.tokens ?? [];
  const snippet = configSnippet(folder, created?.token ?? "PASTE-YOUR-TOKEN-HERE");

  return (
    <>
      <PageHeader
        title="Agent access"
        context={
          <>
            {project.key} {project.name}. Lets Claude read this project&apos;s tickets and run the
            read-only SAP tools, acting as you. It cannot change anything, here or in SAP, and every
            call it makes is recorded.
          </>
        }
      />

      {!allowed ? (
        <Empty title="Not available for your role">
          <p>Consultants and project admins can give an agent access.</p>
        </Empty>
      ) : (
        <>
          <section>
            <h2>1. Create an access token</h2>
            <form
              className="surface surface--padded form"
              onSubmit={create}
              style={{ marginTop: 10, maxWidth: 720 }}
            >
              <div className="form__row">
                <Field
                  label="Name"
                  hint="Where the token will be used."
                  error={formError?.field("name")}
                >
                  <input name="name" required maxLength={80} defaultValue="Claude Desktop" />
                </Field>
                <Field label="Valid for" error={formError?.field("expiresInDays")}>
                  <select name="expiresInDays" defaultValue="90">
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </select>
                </Field>
              </div>
              {formError && !formError.details ? <ErrorNote error={formError} /> : null}
              <div className="form__actions">
                <Button type="submit">Create token</Button>
              </div>
            </form>

            {created ? (
              <div className="note note--ok" role="status" style={{ marginTop: 12, maxWidth: 720 }}>
                <strong>Token created. Copy it now: it is not shown again.</strong>
                <pre className="snippet">{created.token}</pre>
                <div className="form__actions" style={{ marginTop: 8 }}>
                  <Button variant="quiet" onClick={() => void copy("token", created.token)}>
                    {copied === "token" ? "Copied" : "Copy token"}
                  </Button>
                </div>
                <p style={{ marginTop: 8 }}>
                  Treat it like a password. Anyone who has it can read this project&apos;s tickets
                  and SAP data until {formatDate(created.expiresAt)} or until you revoke it.
                </p>
              </div>
            ) : null}
          </section>

          <section className="section">
            <h2>2. Connect Claude Desktop</h2>
            <ol className="steps" style={{ marginTop: 10 }}>
              <li>
                Install <a href="https://claude.ai/download">Claude Desktop</a> and{" "}
                <a href="https://nodejs.org">Node.js (LTS)</a> on this computer, if they are not
                there yet.
              </li>
              <li>
                Tell the snippet below where the code is:
                <div style={{ maxWidth: 520, marginTop: 6 }}>
                  <Field label="Folder where you cloned sap_ewm_testing">
                    <input value={folder} onChange={(e) => setFolder(e.target.value)} />
                  </Field>
                </div>
              </li>
              <li>
                In Claude Desktop open Settings, then Developer, then Edit Config. Put this in the
                file <span className="num">claude_desktop_config.json</span> and save. If the file
                already has an <span className="num">mcpServers</span> block, add the{" "}
                <span className="num">ewm-agent</span> entry to it.
                <pre className="snippet">{snippet}</pre>
                <div className="form__actions" style={{ marginTop: 8 }}>
                  <Button variant="quiet" onClick={() => void copy("config", snippet)}>
                    {copied === "config" ? "Copied" : "Copy configuration"}
                  </Button>
                  {created ? null : (
                    <span className="muted">Create a token first; it is filled in for you.</span>
                  )}
                </div>
              </li>
              <li>
                Quit Claude Desktop completely and start it again. Under Connectors you should see
                ewm-agent.
              </li>
              <li>
                Ask Claude, for example:{" "}
                <em>Investigate ticket {project.key}-1 with the ewm-agent tools.</em> Claude asks
                for your permission before each tool call.
              </li>
            </ol>
            <p className="muted" style={{ marginTop: 12, maxWidth: "78ch", fontSize: "0.9rem" }}>
              This console must be running while Claude works. Claude reasons with your Claude
              subscription; the platform only supplies the tools and keeps the record.
              docs/CONNECT-CLAUDE.md has the same steps with troubleshooting, and a variant that
              needs Docker instead of Node.js.
            </p>
          </section>

          <section className="section">
            <h2>Tokens of this project</h2>
            <ErrorNote error={error ?? actionError} />
            {data && tokens.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <div className="surface table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Acts as</th>
                      <th>Token starts with</th>
                      <th>Last used</th>
                      <th>Valid until</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => {
                      const expired = new Date(t.expiresAt).getTime() < Date.now();
                      return (
                        <tr key={t.id}>
                          <td>{t.name}</td>
                          <td>{t.userId === user.id ? "You" : t.userName}</td>
                          <td className="num">{t.tokenPrefix}</td>
                          <td className="nowrap">
                            {t.lastUsedAt ? (
                              formatDateTime(t.lastUsedAt)
                            ) : (
                              <span className="muted">Never</span>
                            )}
                          </td>
                          <td className="nowrap">
                            {t.revokedAt ? (
                              <span className="muted">Revoked</span>
                            ) : expired ? (
                              <span className="muted">Expired</span>
                            ) : (
                              formatDate(t.expiresAt)
                            )}
                          </td>
                          <td className="nowrap">
                            {t.revokedAt || expired ? null : (
                              <button
                                className="link-button link-button--danger"
                                onClick={() => void revoke(t.id)}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function AgentAccessPage() {
  return (
    <NeedsProject>
      <AgentAccess />
    </NeedsProject>
  );
}
