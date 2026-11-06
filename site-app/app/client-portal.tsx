"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowDialog, type WorkflowAct } from "./audit-program";
import type { WorkspaceData } from "./workspace-types";
import { requestLabel } from "@/lib/evidence-requests";
export function ClientPortal({
  data,
  busy,
  onReload,
  onEditing,
}: {
  data: WorkspaceData;
  busy: boolean;
  onReload: () => Promise<unknown>;
  onEditing: (v: boolean) => void;
}) {
  const e = data.engagement!,
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [dirty, setDirty] = useState(false),
    [files, setFiles] = useState<{ name: string; size: number }[]>([]),
    [reply, setReply] = useState({ grantId: "", text: "" });
  useEffect(() => {
    onEditing(dirty || !!reply.text.trim());
    return () => onEditing(false);
  }, [dirty, reply.text, onEditing]);
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    f.set("tenantId", data.tenantId);
    f.set("engagementId", e.id);
    f.set("expectedVersion", String(e.version));
    f.set("grantId", selected);
    if (
      files.length > 10 ||
      files.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024
    ) {
      setError("Choose up to 10 files totaling 10 MB.");
      return;
    }
    try {
      setError("");
      setSending(true);
      const r = await fetch("/api/client-submission", {
          method: "POST",
          body: f,
        }),
        v = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(v.error);
      setDirty(false);
      setSelected("");
      setFiles([]);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSending(false);
    }
  }
  async function replyTo(grantId: string) {
    try {
      setError("");
      setSending(true);
      const r = await fetch("/api/client-submission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: data.tenantId,
            engagementId: e.id,
            expectedVersion: e.version,
            grantId,
            text: reply.text,
          }),
        }),
        v = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(v.error);
      setReply({ grantId: "", text: "" });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reply");
    } finally {
      setSending(false);
    }
  }
  function cancel() {
    if (dirty && !window.confirm("Discard the unsent evidence package?"))
      return;
    setSelected("");
    setDirty(false);
    setFiles([]);
    setError("");
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Your evidence requests</h2>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {e.portalRequests?.map((r) => (
        <details
          className="captured-record"
          key={r.grantId}
          open={selected === r.grantId || reply.grantId === r.grantId}
        >
          <summary>
            <span>
              {r.subject}
              <small className="block subtle">
                {r.periodVersion} · due {r.dueDate}
              </small>
            </span>
            <span className="badge neutral">
              {requestLabel({ status: r.status as "open" })}
            </span>
          </summary>
          <p className="record-text">{r.instructions}</p>
          {!!r.requestedItems?.length && (
            <section>
              <h3>Requested package</h3>
              <ul className="record-list">
                {r.requestedItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {r.submissions.map((s) => (
            <div className="comment-box" key={s.id}>
              <b>
                Submitted {new Date(s.at).toLocaleString()} · {s.delivery}
              </b>
              <p>{s.note}</p>
              {s.remaining && <p>Outstanding: {s.remaining}</p>}
              {s.evidenceIds.map((id) => {
                const a = e.artifacts.find((a) => a.id === id);
                return (
                  a && (
                    <p key={id}>
                      <a
                        className="source-link"
                        href={
                          "/api/evidence?" +
                          new URLSearchParams({
                            tenantId: data.tenantId,
                            engagementId: e.id,
                            artifactId: id,
                          })
                        }
                      >
                        {a.name}
                      </a>{" "}
                      · {a.status}
                    </p>
                  )
                );
              })}
              <p className="subtle">
                {s.receipt
                  ? "Receipt acknowledged " +
                    new Date(s.receipt.at).toLocaleString()
                  : "Awaiting receipt acknowledgment"}
              </p>
              {s.receipt?.note && <p>{s.receipt.note}</p>}
            </div>
          ))}
          {!!r.communications?.length && (
            <section className="communication-thread">
              <h3>Clarifications</h3>
              {r.communications.map((m) => (
                <article key={m.id}>
                  <small>
                    {m.kind === "reply" ? "You" : "Audit team"} ·{" "}
                    {new Date(m.at).toLocaleString()}
                  </small>
                  <p>{m.text}</p>
                </article>
              ))}
            </section>
          )}
          {!["accepted", "waived"].includes(r.status) && (
            <>
              {selected !== r.grantId ? (
                <div className="row-actions">
                  <Button
                    variant="outline"
                    disabled={busy || sending || dirty || !!reply.text.trim()}
                    onClick={() => {
                      setSelected(r.grantId);
                      setFiles([]);
                    }}
                  >
                    Submit evidence package
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || sending || dirty}
                    onClick={() => setReply({ grantId: r.grantId, text: "" })}
                  >
                    Ask a question
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={submit}
                  onChange={() => setDirty(true)}
                  className="client-submission-form"
                >
                  <fieldset disabled={busy || sending}>
                    <label>
                      Evidence files
                      <Input
                        type="file"
                        name="file"
                        multiple
                        required
                        onChange={(ev) =>
                          setFiles(
                            Array.from(ev.target.files ?? []).map((f) => ({
                              name: f.name,
                              size: f.size,
                            })),
                          )
                        }
                      />
                      <small className="subtle">
                        Up to 10 files, totaling 10 MB. Use the handling route
                        authorized for this request.
                      </small>
                    </label>
                    {!!files.length && (
                      <ul className="bundle-files">
                        {files.map((f, i) => (
                          <li key={i}>
                            <span>{f.name}</span>
                            <small>{(f.size / 1024).toFixed(0)} KB</small>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!!r.requestedItems?.length && (
                      <fieldset className="client-request-checklist">
                        <legend>Items delivered in this package</legend>
                        {r.requestedItems.map((item) => (
                          <label key={item}>
                            <input
                              type="checkbox"
                              name="deliveredItem"
                              value={item}
                            />
                            {item}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <label>
                      Submission note
                      <Textarea name="note" required maxLength={5000} />
                    </label>
                    <label>
                      Delivery status
                      <select name="delivery" required defaultValue="">
                        <option value="">Choose…</option>
                        <option value="partial">
                          Partial · more items remain
                        </option>
                        <option value="complete">
                          Complete · all requested items supplied
                        </option>
                      </select>
                    </label>
                    <label>
                      Items still outstanding
                      <Textarea name="remaining" maxLength={5000} />
                    </label>
                    <div className="row-actions">
                      <Button type="submit">
                        {sending ? "Submitting…" : "Submit for assessment"}
                      </Button>
                      <Button type="button" variant="outline" onClick={cancel}>
                        Cancel
                      </Button>
                    </div>
                  </fieldset>
                </form>
              )}
              {reply.grantId === r.grantId && (
                <form
                  className="client-submission-form"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void replyTo(r.grantId);
                  }}
                >
                  <label>
                    Question or clarification
                    <Textarea
                      required
                      maxLength={5000}
                      value={reply.text}
                      onChange={(ev) =>
                        setReply({ grantId: r.grantId, text: ev.target.value })
                      }
                    />
                  </label>
                  <div className="row-actions">
                    <Button type="submit" disabled={sending || busy || dirty}>
                      Send reply
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={sending}
                      onClick={() => {
                        if (
                          !reply.text.trim() ||
                          window.confirm("Discard your unsent reply?")
                        )
                          setReply({ grantId: "", text: "" });
                      }}
                    >
                      Cancel reply
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </details>
      ))}
      {!e.portalRequests?.length && (
        <p className="empty-result">
          No evidence requests are assigned to you.
        </p>
      )}
    </section>
  );
}
export function RequestAccess({
  data,
  busy,
  act,
  onEditing,
}: {
  data: WorkspaceData;
  busy: boolean;
  act: WorkflowAct;
  onEditing: (v: boolean) => void;
}) {
  const e = data.engagement!,
    [form, setForm] =
      useState<Parameters<typeof WorkflowDialog>[0]["form"]>(null);
  if (data.identity.role !== "Lead Auditor" || !e.workflow) return null;
  const contributors = data.members.filter(
    (m) =>
      m.status === "active" &&
      m.role === "Client Contributor" &&
      m.client_id === e.clientId,
  );
  return (
    <details className="captured-record">
      <summary>
        Client request access{" "}
        <span className="subtle">
          {
            e.workflow.clientGrants.filter(
              // eslint-disable-next-line react-hooks/purity -- grant expiry is checked against the clock on each render
              (g) => g.active && Date.parse(g.expiresAt) > Date.now(),
            ).length
          }{" "}
          active grants
        </span>
      </summary>
      <p className="subtle">
        Client Viewers remain read only. Add a Client Contributor in Members &
        access, then assign specific requests here.
      </p>
      <Button
        variant="outline"
        disabled={busy || !contributors.length}
        onClick={() =>
          setForm({
            title: "Assign client evidence request",
            action: "Grant request access",
            description:
              "Only the client-facing prompt, instructions, deadline and this contributor’s submissions are visible in the portal.",
            fields: [
              {
                name: "userId",
                label: "Client Contributor",
                type: "select",
                options: contributors.map((m) => ({
                  value: m.user_id,
                  label: m.display_name,
                })),
              },
              {
                name: "requestId",
                label: "Outstanding request",
                type: "select",
                options: (e.evidenceRequests ?? [])
                  .filter((r) => !["accepted", "waived"].includes(r.status))
                  .map((r) => ({ value: r.id, label: r.subject })),
              },
              { name: "prompt", label: "Client-facing subject", type: "text" },
              {
                name: "instructions",
                label: "Client-facing instructions and permitted data",
                type: "area",
              },
              {
                name: "requestedItems",
                label: "Package checklist · one item per line",
                type: "area",
                optional: true,
              },
              {
                name: "category",
                label: "Expected evidence category",
                type: "select",
                options: [
                  "Dataset",
                  "Model",
                  "Training log",
                  "Validation",
                  "Pipeline code",
                  "Governance",
                  "Instructions",
                  "Oversight",
                  "Security",
                  "GenAI log",
                  "Other",
                ].map((value) => ({ value, label: value })),
              },
              {
                name: "handlingBasis",
                label: "Approved handling route",
                type: "select",
                options: [
                  { value: "synthetic", label: "Synthetic data" },
                  { value: "anonymized", label: "Anonymized data" },
                ],
              },
              { name: "expiresAt", label: "Access expires", type: "date" },
            ],
            save: (v) =>
              act("grantClientRequest", {
                ...v,
                requestedItems: String(v.requestedItems ?? "")
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean),
                expiresAt: String(v.expiresAt) + "T23:59:59.000Z",
              }),
          })
        }
      >
        Assign request
      </Button>
      {!contributors.length && (
        <p className="subtle">
          Add a Client Contributor for this client before assigning access.
        </p>
      )}
      {e.workflow.clientGrants.map((g) => (
        <div className="comment-box" key={g.id}>
          <b>
            {data.members.find((m) => m.user_id === g.userId)?.display_name ??
              "Inactive contributor"}{" "}
            · {g.prompt}
          </b>
          <p>
            {/* eslint-disable-next-line react-hooks/purity -- grant expiry is checked against the clock on each render */}
            {g.active && Date.parse(g.expiresAt) > Date.now()
              ? "Active"
              : "Inactive"}{" "}
            · expires {new Date(g.expiresAt).toLocaleDateString()}
          </p>
          {/* eslint-disable-next-line react-hooks/purity -- grant expiry is checked against the clock on each render */}
          {g.active && Date.parse(g.expiresAt) > Date.now() && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                setForm({
                  title: "Publish client-facing clarification",
                  action: "Update client instructions",
                  description:
                    "Only this separately authored prompt and instructions are shown to the client. Internal assessments remain private.",
                  fields: [
                    {
                      name: "prompt",
                      label: "Client-facing subject",
                      value: g.prompt,
                    },
                    {
                      name: "instructions",
                      label: "Required clarification and next steps",
                      type: "area",
                      value: g.instructions,
                    },
                  ],
                  save: (v) =>
                    act("updateClientRequest", { grantId: g.id, ...v }),
                })
              }
            >
              Update client instructions
            </Button>
          )}
          {!!g.communications?.length && (
            <div className="communication-thread">
              {g.communications.map((m) => (
                <article key={m.id}>
                  <small>
                    {m.kind === "reply" ? "Client reply" : "Audit team"} ·{" "}
                    {new Date(m.at).toLocaleString()}
                  </small>
                  <p>{m.text}</p>
                </article>
              ))}
            </div>
          )}
          {/* eslint-disable-next-line react-hooks/purity -- grant expiry is checked against the clock on each render */}
          {g.active && Date.parse(g.expiresAt) > Date.now() && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                setForm({
                  title: "Send client-facing clarification",
                  action: "Publish clarification",
                  description:
                    "This message is visible to the assigned contributor.",
                  fields: [
                    {
                      name: "text",
                      label: "Client-facing message",
                      type: "area",
                    },
                  ],
                  save: (v) =>
                    act("publishClientClarification", { grantId: g.id, ...v }),
                })
              }
            >
              Send clarification
            </Button>
          )}
          {e
            .workflow!.submissions.filter((s) => s.grantId === g.id)
            .map((s) => (
              <div className="comment-box" key={s.id}>
                <b>
                  Package · {s.evidenceIds.length} files ·{" "}
                  {new Date(s.at).toLocaleString()}
                </b>
                <p>{s.note}</p>
                {s.receipt ? (
                  <p className="subtle">
                    Receipt acknowledged ·{" "}
                    {new Date(s.receipt.at).toLocaleString()}
                  </p>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      setForm({
                        title: "Acknowledge package receipt",
                        action: "Acknowledge receipt",
                        description:
                          "Receipt acknowledgment does not accept the files or conclude that evidence is sufficient.",
                        fields: [
                          {
                            name: "note",
                            label: "Client-facing receipt note",
                            type: "area",
                          },
                        ],
                        save: (v) =>
                          act("acknowledgeClientSubmission", {
                            submissionId: s.id,
                            ...v,
                          }),
                      })
                    }
                  >
                    Acknowledge receipt
                  </Button>
                )}
              </div>
            ))}
          {g.active && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                setForm({
                  title: "Revoke request access",
                  action: "Revoke access",
                  fields: [
                    {
                      name: "reason",
                      label: "Revocation reason",
                      type: "area",
                    },
                  ],
                  save: (v) =>
                    act("revokeClientRequest", { grantId: g.id, ...v }),
                })
              }
            >
              Revoke
            </Button>
          )}
        </div>
      ))}
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </details>
  );
}
