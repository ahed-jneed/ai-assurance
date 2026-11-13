"use client";
// The GenAI evidence tab of the Testing lab (docs/design/genai-evidence.md
// section 12.2), from GET /api/assurance?view=genai: every GenAI result with
// its evidence level, readiness, claim scope, criteria with n and intervals,
// per-technique members and the run-metadata checklist; and the auditor's
// intake (freeze a plan, declare a bundle, queue the engine's ingest, compile
// a worker result, import a CLI envelope) and the reviewer's
// acknowledgements. The workspace never parses, runs or renders an ingested
// log: it shows the engine's verified summary only.
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Engagement, Role } from "@/lib/domain";
import {
  ACK_LABELS,
  LEVEL_LABELS,
  custodyLabel,
  fmt,
  reasonLabel,
} from "@/lib/genai/labels";
import type { GenaiAcknowledgement } from "@/lib/genai/readiness";
import type { GenaiRunSummary } from "@/lib/genai/summary";
import type { GenaiView } from "@/lib/read-models/genai-view";
import { WorkflowDialog, type Form } from "./audit-program";

type Result = GenaiView["results"][number];

const PLAN_TEMPLATE = JSON.stringify(
  {
    schemaVersion: "genai-plan/0.1",
    criteria: [{ id: "C1", kind: "genai_mean" }],
  },
  null,
  2,
);

async function post(
  tenantId: string,
  engagementId: string,
  op: string,
  data: Record<string, unknown>,
) {
  const r = await fetch("/api/assurance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId, engagementId, op, data }),
  });
  const v = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(v.error ?? "The command failed");
  return v;
}

function parseJson(text: string, what: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(what + " is not valid JSON");
  }
}

function Level({ level }: { level: string }) {
  return (
    <span
      className={
        "badge " +
        (level === "L2" || level === "L3"
          ? "green"
          : level === "L1"
            ? "amber"
            : "red")
      }
      title={LEVEL_LABELS[level] ?? level}
      data-genai-level={level}
    >
      {LEVEL_LABELS[level] ?? level}
    </span>
  );
}

function Checklist({ run }: { run: GenaiRunSummary }) {
  return (
    <ul className="genai-checklist" aria-label={"Metadata of " + run.runKey}>
      {run.checklist.map((c) => (
        <li key={c.field}>
          <span
            className={
              "badge " +
              (c.state === "recorded"
                ? "green"
                : c.state === "declared"
                  ? "amber"
                  : "red")
            }
          >
            {c.state}
          </span>{" "}
          {c.field}
        </li>
      ))}
    </ul>
  );
}

function ResultCard({
  result,
  reviewer,
  busy,
  onAcknowledge,
}: {
  result: Result;
  reviewer: boolean;
  busy: boolean;
  onAcknowledge: (a: GenaiAcknowledgement) => void;
}) {
  const s = result.summary,
    r = result.readiness,
    runLevel = (key: string) =>
      r.runs.find((x) => x.runKey === key)?.effectiveLevel ?? "L0";
  return (
    <section className="panel" data-genai-result={result.id}>
      <div className="panel-head">
        <h2>
          GenAI result{" "}
          <span className="subtle">{s.computationSha256.slice(0, 12)}</span>
        </h2>
        <Level level={r.effectiveLevel} />
      </div>
      <p className="subtle">
        {custodyLabel(result.custody, !!result.authenticatedBy)} · origin{" "}
        {s.origin.replace("_", " ")} · engine {s.engine.version} ·{" "}
        {new Date(result.createdAt).toLocaleString()}
        {result.attested ? " · re-run attested" : ""}
      </p>
      <p>
        Overall outcome: <strong>{s.overallOutcome}</strong>
      </p>
      {r.blockers.length ? (
        <Alert variant="destructive" role="status">
          <AlertTitle>
            The readiness gate blocks a positive conclusion on this result
          </AlertTitle>
          <AlertDescription>
            <ul>
              {r.blockers.map((b, i) => (
                <li key={b.code + i} data-genai-blocker={b.code}>
                  {b.message}
                  {b.criterionId ? " (criterion " + b.criterionId + ")" : ""}
                  {b.runKey ? " (run " + b.runKey + ")" : ""}
                  {b.detail ? ": " + b.detail : ""}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert role="status" data-genai-ready>
          <AlertTitle>No gate blocks a conclusion on this result</AlertTitle>
          <AlertDescription>
            The auditor still determines sufficiency.
          </AlertDescription>
        </Alert>
      )}
      {r.claimScope.length > 0 && (
        <>
          <h3>What a conclusion on this result covers</h3>
          <ul className="genai-claim-scope">
            {r.claimScope.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {r.pendingAcknowledgements.length > 0 && (
        <>
          <h3>Awaiting a reviewer&apos;s acknowledgement</h3>
          <ul>
            {r.pendingAcknowledgements.map((a) => (
              <li
                key={[a.flag, a.runKey, a.judgeRef, a.score].join("|")}
                className="row-actions"
              >
                {ACK_LABELS[a.flag] ?? a.flag} · run {a.runKey}
                {a.judgeRef ? " · judge " + a.judgeRef : ""}
                {a.score ? " · score " + a.score : ""}
                {reviewer && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onAcknowledge(a)}
                  >
                    Acknowledge
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Criteria</h3>
      <Table>
        <TableHeader>
          <TableRow>
            {["Criterion", "Role", "Outcome", "n", "p (adjusted)", "Why"].map(
              (h) => (
                <TableHead key={h}>{h}</TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.criteria.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                {c.id} <small className="block subtle">{c.kind}</small>
              </TableCell>
              <TableCell>{c.role}</TableCell>
              <TableCell>{c.outcome ?? "—"}</TableCell>
              <TableCell>{c.sampleSize ?? "—"}</TableCell>
              <TableCell>
                {fmt(c.pValue)} ({fmt(c.adjustedPValue)})
              </TableCell>
              <TableCell>{c.reasons.map(reasonLabel).join("; ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {s.criteria
        .filter((c) => c.members.length > 0)
        .map((c) => (
          <details key={c.id} className="genai-members">
            <summary>
              {c.id}: {c.members.length} members
              {c.membersOmitted
                ? " (" + c.membersOmitted + " more in the computation)"
                : ""}
            </summary>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Member",
                    "Metric",
                    "n",
                    "Estimate",
                    "Interval",
                    "SE",
                    "Status",
                    "Why",
                  ].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.members.map((m) => (
                  <TableRow key={m.memberId}>
                    <TableCell>{m.subject ?? m.memberId}</TableCell>
                    <TableCell>{m.metric}</TableCell>
                    <TableCell>{m.n ?? "—"}</TableCell>
                    <TableCell>{fmt(m.estimate)}</TableCell>
                    <TableCell>
                      {m.interval
                        ? Math.round(m.interval.level * 100) +
                          "% [" +
                          fmt(m.interval.lower) +
                          ", " +
                          fmt(m.interval.upper) +
                          "] " +
                          m.interval.method
                        : "—"}
                    </TableCell>
                    <TableCell>{fmt(m.seCluster ?? m.se)}</TableCell>
                    <TableCell>{m.status}</TableCell>
                    <TableCell>
                      {m.reasons.map(reasonLabel).join("; ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        ))}
      <h3>Runs</h3>
      {s.runs.map((run) => (
        <details key={run.runKey} className="genai-run">
          <summary>
            {run.runKey} · {run.format}
            {run.kind === "marking" ? " · marking check" : ""}
            {run.signedResults
              ? " · " + run.signedResults + " signatures verified"
              : ""}{" "}
            ·{" "}
            <Level level={runLevel(run.runKey)} />
            {run.missing.length
              ? " · " + run.missing.length + " metadata missing"
              : ""}
          </summary>
          <p className="subtle">
            System {run.systemUnderTest.model ?? "undeclared"} (
            {run.systemUnderTest.family ?? "family undeclared"}) · harness{" "}
            {run.harness ?? "undeclared"} · dataset {run.dataset ?? "—"}
            {run.incomplete ? " · run incomplete" : ""}
          </p>
          {run.levelReasons.length > 0 && (
            <p className="subtle">
              Level: {run.levelReasons.map(reasonLabel).join("; ")}
            </p>
          )}
          <Checklist run={run} />
          {run.judges.length > 0 && (
            <ul>
              {run.judges.map((j) => (
                <li key={j.ref}>
                  Judge {j.ref}: {j.model ?? "model undeclared"} (
                  {j.family ?? "family undeclared"}) · kappa {fmt(j.kappa, 3)},
                  lower bound {fmt(j.lower, 3)} on {j.n ?? "—"} items
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </section>
  );
}

export function GenaiEvidence({
  engagement: e,
  tenantId,
  role,
  onRefresh,
  onEditing,
}: {
  engagement: Engagement;
  tenantId: string;
  role: Role;
  onRefresh: () => Promise<unknown>;
  onEditing?: (open: boolean) => void;
}) {
  const writer = ["Auditor", "Lead Auditor"].includes(role),
    reviewer = ["Reviewer", "Lead Auditor"].includes(role);
  const [view, setView] = useState<GenaiView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState<Form | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "/api/assurance?" +
          new URLSearchParams({
            tenantId,
            engagementId: e.id,
            view: "genai",
          }),
        { headers: { accept: "application/json" } },
      );
      const body = (await r.json().catch(() => ({}))) as GenaiView & {
        error?: string;
      };
      if (!r.ok) throw new Error(body.error ?? "GenAI evidence unavailable");
      setView(body);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "GenAI evidence unavailable",
      );
    }
  }, [tenantId, e.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the view when the engagement changes
    void load();
  }, [load, e.version]);
  const run = async (op: string, data: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post(tenantId, e.id, op, data);
      await onRefresh();
      await load();
    } finally {
      setBusy(false);
    }
  };
  const act = (op: string, data: Record<string, unknown>) =>
    run(op, data).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "The command failed"),
    );

  const procedures = (e.workflow?.procedures ?? []).filter(
      (p) =>
        p.selected && ["applicable", "readiness"].includes(p.applicability),
    ),
    procedureOptions = procedures.map((p) => ({
      value: p.id,
      label: p.templateId + " · " + p.title,
    })),
    imported = new Set(view?.results.map((r) => r.artifactId) ?? []),
    envelopes = e.artifacts.filter(
      (a) =>
        a.category === "GenAI log" &&
        a.status === "accepted" &&
        !imported.has(a.id),
    ),
    compilable = (view?.jobs ?? []).filter(
      (j) => j.state === "succeeded" && !imported.has(String(j.id)),
    );

  const freezePlan = () =>
    setForm({
      title: "Freeze a GenAI plan",
      description:
        "genai-plan/0.1 for one procedure. The judge floor (kappa lower bound at least 0.60 on at least 50 items, a judge of another model family) and the sample minimums may be raised, never lowered.",
      action: "Freeze plan",
      fields: [
        {
          name: "procedureId",
          label: "Procedure",
          type: "select",
          options: procedureOptions,
        },
        {
          name: "plan",
          label: "Plan (JSON)",
          type: "area",
          value: PLAN_TEMPLATE,
        },
      ],
      save: (v) =>
        run("freezeGenaiPlan", {
          procedureId: v.procedureId,
          plan: parseJson(String(v.plan), "The plan"),
        }),
    });
  const declareBundle = () =>
    setForm({
      title: "Declare a GenAI bundle",
      description:
        "genai-bundle/0.1. Every input pins accepted evidence of this engagement by SHA-256 and size; the matching evidence is linked automatically.",
      action: "Declare bundle",
      fields: [{ name: "manifest", label: "Manifest (JSON)", type: "area" }],
      save: (v) => {
        const manifest = parseJson(String(v.manifest), "The manifest"),
          inputs = Array.isArray(manifest.inputs)
            ? (manifest.inputs as { sha256?: string; name?: string }[])
            : [];
        const inputArtifactIds = inputs.map((i) => {
          const a = e.artifacts.find(
            (a) => a.sha256 === i.sha256 && a.status === "accepted",
          );
          if (!a)
            throw new Error(
              "No accepted evidence has the bytes of " +
                (i.name ?? i.sha256 ?? "an input"),
            );
          return a.id;
        });
        return run("declareGenaiBundle", { manifest, inputArtifactIds });
      },
    });
  const queueIngest = () =>
    setForm({
      title: "Queue the engine's GenAI ingest",
      description:
        "An enrolled worker recomputes the statistics from the pinned logs. It runs no harness and executes nothing the logs name.",
      action: "Queue ingest",
      fields: [
        {
          name: "procedureId",
          label: "Procedure",
          type: "select",
          options: procedureOptions,
        },
        {
          name: "planRecordId",
          label: "Frozen plan",
          type: "select",
          options: (view?.plans ?? []).map((p) => ({
            value: p.id,
            label:
              p.id +
              " · " +
              (procedures.find((q) => q.id === p.procedureId)?.templateId ??
                p.procedureId),
          })),
        },
        {
          name: "bundleRecordId",
          label: "Declared bundle",
          type: "select",
          options: (view?.bundles ?? []).map((b) => ({
            value: b.id,
            label: b.id + " · " + b.inputArtifactIds.length + " inputs",
          })),
        },
      ],
      save: (v) => run("queueGenaiIngest", v),
    });
  const importEnvelope = () =>
    setForm({
      title: "Import a GenAI result envelope",
      description:
        "An envelope made with the engine CLI and uploaded as GenAI log evidence. Its hashes are checked; it counts as L1 at most until a worker recomputation matches it.",
      action: "Import envelope",
      fields: [
        {
          name: "artifactId",
          label: "Envelope",
          type: "select",
          options: envelopes.map((a) => ({ value: a.id, label: a.name })),
        },
      ],
      save: (v) => run("importGenaiEnvelope", v),
    });
  const acknowledge = (result: Result, a: GenaiAcknowledgement) =>
    setForm({
      title: "Acknowledge: " + (ACK_LABELS[a.flag] ?? a.flag),
      description:
        "Run " +
        a.runKey +
        (a.judgeRef ? ", judge " + a.judgeRef : "") +
        (a.score ? ", score " + a.score : "") +
        ". Record why the flag does not prevent reliance.",
      action: "Acknowledge",
      fields: [{ name: "rationale", label: "Rationale", type: "area" }],
      save: (v) =>
        run("acknowledgeGenaiFlag", {
          resultRecordId: result.id,
          flag: a.flag,
          runKey: a.runKey,
          judgeRef: a.judgeRef ?? null,
          score: a.score ?? null,
          rationale: v.rationale,
        }),
    });

  return (
    <div className="genai-evidence">
      <section className="panel">
        <div className="panel-head">
          <h2>
            GenAI evidence{" "}
            <span className="count-label">{view?.results.length ?? 0}</span>
          </h2>
          {writer && (
            <div className="row-actions">
              <Button
                variant="outline"
                disabled={busy || !procedureOptions.length}
                onClick={freezePlan}
              >
                Freeze plan
              </Button>
              <Button variant="outline" disabled={busy} onClick={declareBundle}>
                Declare bundle
              </Button>
              <Button
                variant="outline"
                disabled={busy || !view?.plans.length || !view.bundles.length}
                onClick={queueIngest}
              >
                Queue ingest
              </Button>
              <Button
                disabled={busy || !envelopes.length}
                onClick={importEnvelope}
              >
                Import envelope
              </Button>
            </div>
          )}
        </div>
        <p className="subtle">
          Evidence levels: L0 reported aggregate, L1 hashed tool log, L2
          recomputed by the engine, L3 auditor re-run with attestation. A
          positive conclusion needs L2 or better, n and intervals for every
          deciding criterion, and a validated judge of another model family.
          Benchmark accuracy is not accuracy on the population of real inputs; a
          low attack-success rate holds only for that attack set and judge.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {view && (
          <p className="subtle">
            {view.plans.length} frozen plans · {view.bundles.length} declared
            bundles · {view.jobs.length} ingest jobs ·{" "}
            {view.acknowledgements.length} acknowledgements
          </p>
        )}
        {writer && compilable.length > 0 && (
          <ul>
            {compilable.map((j) => (
              <li key={String(j.id)} className="row-actions">
                Ingest job {String(j.id)} finished.
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act("compileGenaiResult", { jobId: j.id })
                  }
                >
                  Compile result
                </Button>
              </li>
            ))}
          </ul>
        )}
        {view && !view.results.length && (
          <p className="subtle">
            No GenAI result yet. Upload the envelope as GenAI log evidence and
            import it, or declare a bundle of tool logs and queue the
            engine&apos;s ingest.
          </p>
        )}
      </section>
      {view?.results
        .slice()
        .reverse()
        .map((r) => (
          <ResultCard
            key={r.id}
            result={r}
            reviewer={reviewer}
            busy={busy}
            onAcknowledge={(a) => acknowledge(r, a)}
          />
        ))}
      <WorkflowDialog
        form={form}
        busy={busy}
        onClose={() => setForm(null)}
        onEditing={onEditing}
      />
    </div>
  );
}
