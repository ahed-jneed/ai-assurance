"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
export function DossierControls({
  tenantId,
  engagementId,
  reportId,
  onRefresh,
}: {
  tenantId: string;
  engagementId: string;
  reportId: string;
  onRefresh?: () => Promise<unknown>;
}) {
  const [audience, setAudience] = useState(""),
    [captured, setCaptured] = useState<Record<string, any[]>>({}),
    [withheld, setWithheld] = useState<Record<string, string>>({});
  const [role, setRole] = useState(""),
    [sealed, setSealed] = useState<Record<string, any>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = new URLSearchParams({ tenantId, engagementId, reportId });
  useEffect(() => {
    let active = true;
    void fetch(
      "/api/workspace?" + new URLSearchParams({ tenantId, engagementId }),
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (!r.ok) return;
        const v = (await r.json()) as any;
        if (!active) return;
        setRole(v.identity.role);
        if (
          !["Client Viewer", "Client Contributor"].includes(v.identity.role)
        ) {
          const res = await fetch(
            "/api/assurance?" + new URLSearchParams({ tenantId, engagementId }),
            { cache: "no-store" },
          );
          if (res.ok) {
            const s = (await res.json()) as any;
            if (active)
              setSealed(
                Object.fromEntries(
                  s.records
                    .filter(
                      (x: any) =>
                        x.kind === "dossier" && x.body.reportId === reportId,
                    )
                    .map((x: any) => [x.body.audience, x.body]),
                ),
              );
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tenantId, engagementId, reportId]);
  async function prepare(a: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
          "/api/workspace?" + new URLSearchParams({ tenantId, engagementId }),
          { cache: "no-store" },
        ),
        v = (await r.json()) as any;
      if (!r.ok) throw Error(v.error);
      const report = v.engagement.reports.find((r: any) => r.id === reportId);
      setCaptured({
        internal: report.snapshot?.evidence ?? [],
        client: report.clientSnapshot?.evidence ?? [],
      });
      setWithheld({});
      setAudience(a);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Report unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function seal() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/dossier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            engagementId,
            reportId,
            audience,
            withheld: Object.entries(withheld).map(([id, reason]) => ({
              id,
              reason,
            })),
          }),
        }),
        v = (await r.json()) as any;
      if (!r.ok) throw Error(v.error);
      setSealed({ ...sealed, [audience]: v.record.body });
      setAudience("");
      await onRefresh?.();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Dossier could not be sealed");
    } finally {
      setBusy(false);
    }
  }
  const client = ["Client Viewer", "Client Contributor"].includes(role);
  return (
    <section className="release-controls">
      <h3>Portable audit dossier</h3>
      <p className="subtle">
        Exact report, readable rendition, paper revisions, permitted evidence
        bytes and a signed verification manifest.
      </p>
      {(client ? ["client"] : ["internal", "client"]).map((a) => (
        <div className="row-actions" key={a}>
          {role === "Lead Auditor" && !sealed[a] && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void prepare(a)}
            >
              <ShieldCheck size={15} />
              Seal {a} dossier
            </Button>
          )}
          {(sealed[a] || client) && (
            <a
              className="download-link"
              href={"/api/dossier?" + q + "&audience=" + a}
            >
              <Download size={15} />
              Download {a} dossier
            </a>
          )}
          {sealed[a] && (
            <small className="subtle">
              {sealed[a].files} verified files · key {sealed[a].keyId}
            </small>
          )}
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details className="provenance">
        <summary>Verification trust and limits</summary>
        <p>
          Application Ed25519 signing uses versioned server-held practice keys.
          Verify offline with the standalone assurance tool and an independently
          pinned public key. An embedded key alone does not establish trusted
          origin. External timestamping, KMS attestation and qualified
          signatures are not configured.
        </p>
        {Object.values(sealed).map((s) => (
          <p key={s.keyId}>
            Key {s.keyId}
            <br />
            <code className="hash-text">{s.publicKeySPKI}</code>
          </p>
        ))}
      </details>
      <Dialog
        open={!!audience}
        onOpenChange={(v) => {
          if (!v && !busy) setAudience("");
        }}
      >
        <DialogContent className="audit-dialog workbench-dialog">
          <DialogHeader>
            <DialogTitle>Seal {audience} dossier</DialogTitle>
            <DialogDescription>
              Verify included bytes and explain any evidence retained outside
              this dossier. The sealed export is immutable.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void seal();
            }}
          >
            <fieldset disabled={busy}>
              <p className="subtle">
                Maximum included payload: 30 MB. Evidence exclusions reduce
                portability and remain explicit in the signed manifest.
              </p>
              {(captured[audience] ?? [])
                .filter((a) => a.status === "accepted")
                .map((a) => (
                  <div className="record-item" key={a.id}>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={a.id in withheld}
                        onChange={(ev) =>
                          setWithheld((x) => {
                            const next = { ...x };
                            if (ev.target.checked) next[a.id] = "";
                            else delete next[a.id];
                            return next;
                          })
                        }
                      />
                      <span>
                        Withhold {a.name}
                        <small className="block subtle">{a.id}</small>
                      </span>
                    </label>
                    {a.id in withheld && (
                      <label className="workbench-field">
                        Reason and independently retained location
                        <Textarea
                          required
                          maxLength={1000}
                          value={withheld[a.id]}
                          onChange={(ev) =>
                            setWithheld({
                              ...withheld,
                              [a.id]: ev.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <div className="ml-footer">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAudience("")}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {busy ? "Verifying and sealing…" : "Verify bytes and seal"}
                </Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
