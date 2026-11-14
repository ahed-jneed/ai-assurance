"use client";

import { Button } from "@/components/ui/button";
import {
  adapterFormatLabel,
  label,
  type OpenForm,
  type Snapshot,
} from "./types";

/** Access: the engagement team, runner connections and runtime downloads. */
export function AccessSection({
  snapshot,
  lead,
  busy,
  open,
}: {
  snapshot: Snapshot;
  lead: boolean;
  busy: boolean;
  open: OpenForm;
}) {
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Engagement team</h2>
          <p className="subtle">
            Practice membership and engagement access are separate permissions.
          </p>
        </div>
        {lead && (
          <Button onClick={() => open("setAccess")}>Manage access</Button>
        )}
      </div>
      <div className="assurance-register">
        {snapshot.access.map((a) => (
          <div className="execution-row" key={a.user_id}>
            <div>
              <b>{a.display_name}</b>
              <small className="block subtle">{a.role}</small>
            </div>
            <span
              className={
                "badge " +
                (a.active && a.status === "active" ? "green" : "neutral")
              }
            >
              {a.active && a.status === "active" ? "Granted" : "Revoked"}
            </span>
          </div>
        ))}
      </div>
      <div className="section-toolbar">
        <h2>Runner connections</h2>
        {lead && (
          <Button variant="outline" onClick={() => open("enrollWorker")}>
            Enroll runner
          </Button>
        )}
      </div>
      {snapshot.workers.map((w) => (
        <div key={w.id} className="execution-row">
          <div>
            <b>{w.name}</b>
            <small className="block subtle">
              {w.last_seen
                ? "Last attempt connection " +
                  new Date(w.last_seen).toLocaleString()
                : "Awaiting first connection"}{" "}
              ·{" "}
              {(JSON.parse(w.capabilities) as string[])
                .map(adapterFormatLabel)
                .join(", ")}
            </small>
            <details>
              <summary className="subtle">Image pin</summary>
              <code>{w.image_digest}</code>
            </details>
          </div>
          <span className="badge neutral">
            {w.active ? "Enrolled" : "Revoked"}
          </span>
          {lead && !!w.active && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => open("revokeWorker", null, { workerId: w.id })}
            >
              Revoke
            </Button>
          )}
        </div>
      ))}
      <div className="row-actions">
        <a className="download-link" href="/tools/assurance-runtime.zip">
          Download portable runtime &amp; operator guides
        </a>
        <a className="download-link" href="/tools/assurance-verifier.py">
          Download standalone verifier
        </a>
      </div>
      <details className="help-panel">
        <summary>Deployment and verification readiness</summary>
        {Object.entries(snapshot.capabilities ?? {}).map(([k, v]) => (
          <p key={k}>
            <b>{label(k)}:</b> {v}
          </p>
        ))}
        <p>
          Deploy the portable worker with a read-only isolated compute
          container, an approved model-hash allowlist and separate platform
          service credentials. Service enrollment authenticates origin; it is
          not remote runtime attestation.
        </p>
      </details>
    </>
  );
}
