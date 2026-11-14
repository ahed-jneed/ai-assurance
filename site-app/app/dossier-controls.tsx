"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { recordsQuery, refreshAfterMutation } from "@/lib/assurance-query";
import type { Engagement, Report, Role } from "@/lib/domain";
import { errorMessage, fetchJson, postJson } from "@/lib/fetch-json";
import { can } from "@/lib/permissions";
import { isClientRole } from "@/lib/workflow-state";
import { describeScope, type DossierScope } from "@/lib/dossier-scope";
type CapturedEvidence = { id: string; name: string; status: string };
type SealedDossier = {
  files: number;
  keyId: string;
  publicKeySPKI: string;
  scope?: DossierScope;
  scopeSha256?: string;
};
/** What a scoped export (#83) can select by, from the captured report. */
type ScopeChoices = {
  procedures: { id: string; title: string }[];
  kinds: { kind: string; count: number }[];
  pinned: number;
};
type ScopeDraft = {
  procedureIds: string[];
  recordKinds: string[];
  from: string;
  to: string;
  withholdEvidence: boolean;
};
const emptyDraft: ScopeDraft = {
  procedureIds: [],
  recordKinds: [],
  from: "",
  to: "",
  withholdEvidence: false,
};
const toggled = (list: string[], value: string, on: boolean) =>
  on ? [...list, value] : list.filter((x) => x !== value);
const dossierRecords = recordsQuery("dossier");
/**
 * The audience the seal dialog posts for the one it was opened for: a scoped
 * export is an internal dossier; anything else, an empty audience included,
 * posts nothing (#202).
 */
export function sealedAudience(opened: string): "internal" | "client" | null {
  return opened === "scoped" || opened === "internal"
    ? "internal"
    : opened === "client"
      ? "client"
      : null;
}
/**
 * Sealing and downloading the portable dossiers of one report. The role and
 * the report come from the workspace state; the sealed dossiers are the
 * engagement's dossier records, a shared query (lib/assurance-query.ts) read
 * once per engagement version and again after a seal. Client roles read no
 * records: they download the client dossier only, once it is sealed.
 */
export function DossierControls({
  tenantId,
  engagement: e,
  report,
  role,
  onRefresh,
}: {
  tenantId: string;
  engagement: Engagement;
  report: Report;
  role: Role;
  onRefresh?: () => Promise<unknown>;
}) {
  const reportId = report.id,
    engagementId = e.id,
    client = isClientRole(role),
    sealer = can(role, "sealDossier");
  const [audience, setAudience] = useState(""),
    [captured, setCaptured] = useState<Record<string, CapturedEvidence[]>>({}),
    [withheld, setWithheld] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<ScopeChoices | null>(null),
    [draft, setDraft] = useState<ScopeDraft>(emptyDraft),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // Whether the client dossier is sealed, as a client reader learns it.
    [clientSealed, setClientSealed] = useState(false);
  useEffect(() => {
    if (!client) return;
    let active = true;
    fetchJson<{ sealed: boolean }>(
      "/api/dossier?" +
        new URLSearchParams({ tenantId, engagementId, reportId, sealed: "1" }),
      { cache: "no-store" },
    )
      .then((status) => {
        if (active) setClientSealed(status.sealed);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, tenantId, engagementId, reportId]);
  const dossiers = useAssuranceQuery(
    client ? null : { tenantId, engagementId, version: e.version },
    dossierRecords,
  ).data;
  const { sealed, scopedSeals } = useMemo(() => {
    const ofReport = (dossiers ?? []).filter(
      (x) => x.body.reportId === reportId,
    );
    return {
      sealed: Object.fromEntries(
        ofReport
          .filter((x) => !x.body.scopeSha256)
          .map((x) => [x.body.audience, x.body as SealedDossier]),
      ) as Record<string, SealedDossier>,
      scopedSeals: ofReport
        .filter((x) => x.body.scopeSha256)
        .map((x) => x.body as SealedDossier),
    };
  }, [dossiers, reportId]);
  const q = new URLSearchParams({ tenantId, engagementId, reportId });
  function prepare(a: string) {
    setError("");
    // A report's snapshots never change, so the report in the workspace
    // state is the one to seal.
    const snapshot = report.snapshot as {
        evidence?: CapturedEvidence[];
        assurancePins?: { id: string; kind?: string }[];
      },
      clientSnapshot = report.clientSnapshot as
        { evidence?: CapturedEvidence[] } | undefined;
    setCaptured({
      internal: snapshot.evidence ?? [],
      scoped: snapshot.evidence ?? [],
      client: clientSnapshot?.evidence ?? [],
    });
    const pins = snapshot.assurancePins ?? [],
      kinds = new Map<string, number>();
    for (const p of pins)
      if (p.kind) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
    setChoices({
      procedures: (e.workflow?.procedures ?? []).map((p) => ({
        id: p.id,
        title: p.title,
      })),
      kinds: [...kinds]
        .map(([kind, count]) => ({ kind, count }))
        .sort((x, y) => x.kind.localeCompare(y.kind)),
      pinned: pins.length,
    });
    setDraft(emptyDraft);
    setWithheld({});
    setAudience(a);
  }
  async function seal() {
    // The dialog posts only for the audience it was opened for: never an
    // empty one, as while it closes (#202).
    const target = sealedAudience(audience);
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      const scoped = audience === "scoped",
        scope = scoped
          ? {
              ...(draft.procedureIds.length
                ? { procedureIds: draft.procedureIds }
                : {}),
              ...(draft.recordKinds.length
                ? { recordKinds: draft.recordKinds }
                : {}),
              ...(draft.from || draft.to
                ? {
                    period: {
                      from: draft.from || draft.to,
                      to: draft.to || draft.from,
                    },
                  }
                : {}),
              evidence: draft.withholdEvidence ? "withheld" : "included",
            }
          : undefined;
      await postJson<unknown>("/api/dossier", {
        tenantId,
        engagementId,
        reportId,
        audience: target,
        withheld: Object.entries(withheld).map(([id, reason]) => ({
          id,
          reason,
        })),
        ...(scope ? { scope } : {}),
      });
      setAudience("");
      await refreshAfterMutation({ tenantId, engagementId }, onRefresh);
    } catch (x) {
      setError(errorMessage(x, "Dossier could not be sealed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="release-controls">
      <h3>Portable audit dossier</h3>
      <p className="subtle">
        Exact report, readable rendition, paper revisions, permitted evidence
        bytes and a signed verification manifest.
      </p>
      {(client ? ["client"] : ["internal", "client"]).map((a) => (
        <div className="row-actions" key={a}>
          {sealer && !sealed[a] && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => prepare(a)}
            >
              <ShieldCheck size={15} />
              Seal {a} dossier
            </Button>
          )}
          {(sealed[a] || (client && clientSealed)) && (
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
      {!client && (
        <div className="scoped-dossiers">
          {sealer && (
            <div className="row-actions">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => prepare("scoped")}
              >
                <ShieldCheck size={15} />
                Seal scoped internal export
              </Button>
              <small className="subtle">
                For a large audit file: by procedure, period or record type.
              </small>
            </div>
          )}
          {scopedSeals.map((s) => (
            <div className="row-actions" key={s.scopeSha256}>
              <a
                className="download-link"
                href={
                  "/api/dossier?" +
                  q +
                  "&audience=internal&scope=" +
                  s.scopeSha256
                }
              >
                <Download size={15} />
                Download scoped export
              </a>
              <small className="subtle">
                {s.scope ? describeScope(s.scope) : "Scoped export"} · {s.files}{" "}
                verified files · key {s.keyId}
              </small>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details className="provenance">
        <summary>Verification trust and limits</summary>
        <p>
          Application Ed25519 signing uses the practice&apos;s current key,
          stored wrapped under a platform secret; a practice administrator
          rotates it. Verify offline with the standalone assurance tool and an
          independently pinned public key. An embedded key alone does not
          establish trusted origin. External timestamping, KMS attestation and
          qualified signatures are not configured.
        </p>
        <p>
          <a
            href={"/api/dossier/keys?" + new URLSearchParams({ tenantId })}
            target="_blank"
            rel="noreferrer"
          >
            Practice verification keys (active and retired)
          </a>
        </p>
        {/* Both dossiers may be signed with the same key (#202). */}
        {Object.entries(sealed).map(([a, s]) => (
          <p key={a + ":" + s.keyId}>
            Key {s.keyId} · {a} dossier
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
            <DialogTitle>
              {audience === "scoped"
                ? "Seal scoped internal export"
                : "Seal " + audience + " dossier"}
            </DialogTitle>
            <DialogDescription>
              {audience === "scoped"
                ? "Include only the pinned assurance records within a scope. The signed manifest states the scope and how many of the report's pinned records it includes."
                : "Verify included bytes and explain any evidence retained outside this dossier. The sealed export is immutable."}
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
                Maximum included payload: 30 MB and 500 files. Evidence
                exclusions reduce portability and remain explicit in the signed
                manifest.
              </p>
              {audience === "scoped" && choices && (
                <div className="dossier-scope">
                  <p className="subtle">
                    The report pins {choices.pinned} assurance records. Every
                    part you choose must hold; leave a part empty to include
                    all.
                  </p>
                  {choices.procedures.length > 0 && (
                    <fieldset>
                      <legend>Procedures</legend>
                      {choices.procedures.map((p) => (
                        <label className="check-row" key={p.id}>
                          <input
                            type="checkbox"
                            checked={draft.procedureIds.includes(p.id)}
                            onChange={(ev) =>
                              setDraft({
                                ...draft,
                                procedureIds: toggled(
                                  draft.procedureIds,
                                  p.id,
                                  ev.target.checked,
                                ),
                              })
                            }
                          />
                          <span>
                            {p.title}
                            <small className="block subtle">{p.id}</small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <fieldset>
                    <legend>Record types</legend>
                    {choices.kinds.map((k) => (
                      <label className="check-row" key={k.kind}>
                        <input
                          type="checkbox"
                          checked={draft.recordKinds.includes(k.kind)}
                          onChange={(ev) =>
                            setDraft({
                              ...draft,
                              recordKinds: toggled(
                                draft.recordKinds,
                                k.kind,
                                ev.target.checked,
                              ),
                            })
                          }
                        />
                        <span>
                          {k.kind.replace(/_/g, " ")}{" "}
                          <small className="subtle">({k.count})</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="workbench-form-grid">
                    <label className="workbench-field">
                      Created from (UTC)
                      <Input
                        type="date"
                        value={draft.from}
                        max={draft.to || undefined}
                        onChange={(ev) =>
                          setDraft({ ...draft, from: ev.target.value })
                        }
                      />
                    </label>
                    <label className="workbench-field">
                      Created to (UTC, inclusive)
                      <Input
                        type="date"
                        value={draft.to}
                        min={draft.from || undefined}
                        onChange={(ev) =>
                          setDraft({ ...draft, to: ev.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={draft.withholdEvidence}
                      onChange={(ev) =>
                        setDraft({
                          ...draft,
                          withholdEvidence: ev.target.checked,
                        })
                      }
                    />
                    <span>
                      Withhold evidence bytes
                      <small className="block subtle">
                        Each accepted source is listed as withheld with its
                        SHA-256.
                      </small>
                    </span>
                  </label>
                </div>
              )}
              {(audience === "scoped" && draft.withholdEvidence
                ? []
                : (captured[audience] ?? [])
              )
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
                <Button type="submit" disabled={!sealedAudience(audience)}>
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
