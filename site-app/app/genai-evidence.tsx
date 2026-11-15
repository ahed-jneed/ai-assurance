"use client";
// The GenAI evidence tab of the Testing lab (docs/design/genai-evidence.md
// section 12.2), from GET /api/assurance?view=genai: every GenAI result with
// its evidence level, readiness, claim scope, criteria with n and intervals,
// per-technique members and the run-metadata checklist; and the auditor's
// intake (freeze a plan, declare a bundle, queue the engine's ingest, compile
// a worker result, import a CLI envelope) and the reviewer's
// acknowledgements. The workspace never parses, runs or renders an ingested
// log: it shows the engine's verified summary only.
import { useState } from "react";
import { postJson } from "@/lib/fetch-json";
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
import type { Engagement, Role } from "@/lib/domain/types";
import {
  ACK_LABELS,
  LEVEL_LABELS,
  custodyLabel,
  fmt,
  judgeValidationText,
  reasonLabel,
} from "@/lib/genai/labels";
import {
  RERUN_STATEMENT,
  attestationPayload,
} from "@/lib/genai/evidence-levels";
import { GENAI_PLAN_TEMPLATE } from "@/lib/genai/plan-check";
import type { GenaiAcknowledgement } from "@/lib/genai/readiness";
import type { GenaiRunSummary } from "@/lib/genai/summary";
import { can } from "@/lib/permissions";
import { useAssuranceQuery } from "@/hooks/use-assurance-query";
import { genaiQuery, refreshAfterMutation } from "@/lib/assurance-query";
import type { GenaiView } from "@/lib/read-models/genai-view";
import { ViewLoading } from "./view-loading";
import {
  art50BandText,
  art50CriteriaSource,
  art50GenaiPlan,
} from "@/lib/art50-criteria";
import { WorkflowDialog, type Form } from "./audit-program/workflow-dialog";
import {
  count,
  genaiFieldLabel,
  genaiFormatLabel,
  genaiOutcomeLabel,
  valueLabel,
} from "@/lib/presentation";
import { jobNames } from "./assurance-workbench/types";
import {
  bundleOptionLabel,
  distinctOptions,
  planLabel,
  planOptionLabel,
  runOfPlan,
} from "./genai-ingest-labels";

type Result = GenaiView["results"][number];

const PLAN_TEMPLATE = JSON.stringify(GENAI_PLAN_TEMPLATE, null, 2);

async function post(
  tenantId: string,
  engagementId: string,
  op: string,
  data: Record<string, unknown>,
) {
  return postJson<Record<string, unknown>>("/api/assurance", {
    tenantId,
    engagementId,
    op,
    data,
  });
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
            {valueLabel(c.state)}
          </span>{" "}
          {genaiFieldLabel(c.field)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The heading of a criterion's per-technique members: "C1: 1 member (2 more
 * in the computation)", with the shared pluraliser (#221).
 */
export function membersHeading(c: {
  id: string;
  members: unknown[];
  membersOmitted?: number;
}) {
  return (
    c.id +
    ": " +
    count(c.members.length, "member") +
    (c.membersOmitted
      ? " (" + c.membersOmitted.toLocaleString() + " more in the computation)"
      : "")
  );
}

const procedureOption = (p: {
  id: string;
  templateId: string;
  title: string;
}) => ({
  value: p.id,
  label: p.templateId + " · " + p.title,
});

/**
 * The Queue ingest dialog's fields: the procedure, and the frozen plans and
 * declared bundles by readable labels that tell same-day records apart
 * (#211, #221).
 */
export function queueIngestFields(
  procedures: { id: string; templateId: string; title: string }[],
  view: Pick<GenaiView, "plans" | "bundles"> | null,
): Form["fields"] {
  return [
    {
      name: "procedureId",
      label: "Procedure",
      type: "select",
      options: procedures.map(procedureOption),
    },
    {
      name: "planRecordId",
      label: "Frozen plan",
      type: "select",
      options: distinctOptions(view?.plans ?? [], (p) =>
        planOptionLabel(p, procedures),
      ),
    },
    {
      name: "bundleRecordId",
      label: "Declared bundle",
      type: "select",
      options: distinctOptions(view?.bundles ?? [], bundleOptionLabel),
    },
  ];
}

/**
 * The plan label a GenAI result's runs are named by (#246 item 2): the label
 * of the ingest job it was compiled from, as the workbench names that job,
 * else the label of the procedure its plan was frozen for. Null when
 * neither is known, so its runs keep their keys.
 */
export function resultPlanLabel(
  r: Pick<Result, "jobId" | "artifactId" | "procedureId">,
  jobs: GenaiView["jobs"],
  procedures: Parameters<typeof jobNames>[1],
): string | null {
  const typed = jobs as unknown as Parameters<typeof jobNames>[0],
    i = jobs.findIndex((j) => String(j.id) === (r.jobId ?? r.artifactId));
  if (i >= 0) return jobNames(typed, procedures)[i];
  return procedures.some((p) => p.id === r.procedureId)
    ? planLabel(r.procedureId, null, null, procedures)
    : null;
}

export function ResultCard({
  result,
  reviewer,
  busy,
  onAcknowledge,
  plan = null,
}: {
  result: Result;
  reviewer: boolean;
  busy: boolean;
  onAcknowledge: (a: GenaiAcknowledgement) => void;
  /** The plan label its blockers name the runs by (resultPlanLabel). */
  plan?: string | null;
}) {
  const s = result.summary,
    r = result.readiness,
    runLevel = (key: string) =>
      r.runs.find((x) => x.runKey === key)?.effectiveLevel ?? "L0",
    runKeys = s.runs.map((x) => x.runKey);
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
        Overall outcome: <strong>{genaiOutcomeLabel(s.overallOutcome)}</strong>
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
                  {b.runKey
                    ? " (" + runOfPlan(b.runKey, runKeys, plan) + ")"
                    : ""}
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
                {c.id}{" "}
                <small className="block subtle">{valueLabel(c.kind)}</small>
              </TableCell>
              <TableCell>{valueLabel(c.role)}</TableCell>
              <TableCell>{c.outcome ? valueLabel(c.outcome) : "—"}</TableCell>
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
            <summary>{membersHeading(c)}</summary>
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
                    <TableCell>{valueLabel(m.status)}</TableCell>
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
            {run.runKey} · {genaiFormatLabel(run.format)}
            {run.kind === "marking" ? " · marking check" : ""}
            {run.signedResults
              ? " · " + run.signedResults + " signatures verified"
              : ""}{" "}
            · <Level level={runLevel(run.runKey)} />
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
                  {j.family ?? "family undeclared"}) ·{" "}
                  {judgeValidationText(s, run.runKey, j)}
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </section>
  );
}

/**
 * The finished ingest jobs not yet compiled, each named by its frozen plan's
 * label as the workbench's execution requests name it (#240 item 2), never
 * by its job id.
 */
export function FinishedIngests({
  jobs,
  imported,
  procedures,
  busy,
  onCompile,
}: {
  jobs: GenaiView["jobs"];
  /** Artifact ids of the results already compiled or imported. */
  imported: ReadonlySet<string>;
  procedures: Parameters<typeof jobNames>[1];
  busy: boolean;
  onCompile: (jobId: string) => void;
}) {
  const typed = jobs as unknown as Parameters<typeof jobNames>[0],
    names = jobNames(typed, procedures),
    finished = jobs
      .map((j, i) => ({ id: String(j.id), state: j.state, name: names[i] }))
      .filter((j) => j.state === "succeeded" && !imported.has(j.id));
  if (!finished.length) return null;
  return (
    <ul>
      {finished.map((j) => (
        <li key={j.id} className="row-actions">
          The ingest of {j.name} finished.
          <Button size="sm" disabled={busy} onClick={() => onCompile(j.id)}>
            Compile result
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The auditor's intake buttons. "Queue ingest" appears only while an active
 * worker of the engagement is enrolled with genai_ingest (the runner route
 * serves the job to no other worker).
 */
export function IntakeActions({
  view,
  busy,
  canFreeze,
  canImport,
  canAttest,
  onFreeze,
  onDeclare,
  onQueue,
  onImport,
  onAttest,
}: {
  view: Pick<GenaiView, "plans" | "bundles" | "ingestWorkers"> | null;
  busy: boolean;
  canFreeze: boolean;
  canImport: boolean;
  canAttest: boolean;
  onFreeze: () => void;
  onDeclare: () => void;
  onQueue: () => void;
  onImport: () => void;
  onAttest: () => void;
}) {
  return (
    <div className="row-actions">
      <Button
        variant="outline"
        disabled={busy || !canFreeze}
        onClick={onFreeze}
      >
        Freeze plan
      </Button>
      <Button variant="outline" disabled={busy} onClick={onDeclare}>
        Declare bundle
      </Button>
      {!!view && view.ingestWorkers > 0 && (
        <Button
          variant="outline"
          disabled={busy || !view.plans.length || !view.bundles.length}
          onClick={onQueue}
        >
          Queue ingest
        </Button>
      )}
      <Button
        variant="outline"
        disabled={busy || !canAttest}
        onClick={onAttest}
      >
        Attest a re-run
      </Button>
      <Button disabled={busy || !canImport} onClick={onImport}>
        Import envelope
      </Button>
    </div>
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
  // Every GenAI write op admits the same writers (see lib/permissions.ts).
  const writer = can(role, "freezeGenaiPlan"),
    reviewer = can(role, "acknowledgeGenaiFlag");
  const [commandError, setCommandError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState<Form | null>(null);
  // Shared with the Evidence vault's levels (lib/assurance-query.ts): read
  // once per engagement version and again after each command here.
  const genai = useAssuranceQuery(
      { tenantId, engagementId: e.id, version: e.version },
      genaiQuery,
    ),
    view = genai.data ?? null,
    error = commandError || genai.error;
  const run = async (op: string, data: Record<string, unknown>) => {
    setBusy(true);
    setCommandError("");
    try {
      await post(tenantId, e.id, op, data);
      await refreshAfterMutation({ tenantId, engagementId: e.id }, onRefresh);
    } finally {
      setBusy(false);
    }
  };
  const act = (op: string, data: Record<string, unknown>) =>
    run(op, data).catch((err: unknown) =>
      setCommandError(
        err instanceof Error ? err.message : "The command failed",
      ),
    );

  const procedures = (e.workflow?.procedures ?? []).filter(
      (p) =>
        p.selected && ["applicable", "readiness"].includes(p.applicability),
    ),
    procedureOptions = procedures.map(procedureOption),
    imported = new Set(view?.results.map((r) => r.artifactId) ?? []),
    envelopes = e.artifacts.filter(
      (a) =>
        a.category === "GenAI log" &&
        a.status === "accepted" &&
        !imported.has(a.id),
    ),
    // Tool logs and label files a re-run attestation may pin.
    pinnedInputs = new Set(
      (view?.results ?? []).flatMap((r) =>
        r.summary.inputs.map((i) => i.sha256),
      ),
    ),
    attestable = e.artifacts.filter(
      (a) =>
        a.category === "GenAI log" &&
        a.status === "accepted" &&
        !imported.has(a.id),
    ),
    // The runner route serves a GenAI ingest job only to an active worker
    // enrolled with genai_ingest; until one is, a queued job would wait.
    ingestAvailable = !!view && view.ingestWorkers > 0;

  // #152: the Art 50 criteria GenAI marking evidence decides, pre-registered
  // for review; nothing is frozen until the auditor freezes the plan.
  const art50Plans = procedures.flatMap((p) => {
    const g = art50GenaiPlan(p.templateId);
    return g ? [{ procedure: p, genai: g }] : [];
  });
  const freezePlan = (art50?: (typeof art50Plans)[number]) =>
    setForm({
      title: art50
        ? "Pre-register the Art 50 criteria of " + art50.procedure.templateId
        : "Freeze a GenAI plan",
      description:
        "genai-plan/0.1 for one procedure. The judge floor (kappa lower bound at least 0.60 on at least 50 items, a judge of another model family) and the sample minimums may be raised, never lowered." +
        (art50
          ? " The plan holds the research's criteria that GenAI marking evidence decides, with their methodology bands: " +
            art50.genai.preRegistered
              .map((c) => c.id + " " + art50BandText(c))
              .join("; ") +
            ". Where the provider declares a rate, set the band from it before freezing." +
            (art50.genai.notDecided.length
              ? " Not pre-registered (descriptive or attribute sampling the auditor records): " +
                art50.genai.notDecided.map((c) => c.id).join(", ") +
                "."
              : "") +
            " " +
            art50CriteriaSource.caveat
          : ""),
      action: "Freeze plan",
      fields: [
        {
          name: "procedureId",
          label: "Procedure",
          type: "select",
          options: art50
            ? procedureOptions.filter((o) => o.value === art50.procedure.id)
            : procedureOptions,
          value: art50?.procedure.id,
        },
        {
          name: "plan",
          label: "Plan (JSON)",
          type: "area",
          value: art50
            ? JSON.stringify(art50.genai.plan, null, 2)
            : PLAN_TEMPLATE,
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
      fields: queueIngestFields(procedures, view),
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
  const attestRerun = () =>
    setForm({
      title: "Attest an auditor re-run",
      description:
        "Record that you ran the evaluation yourself and that the pinned files are its unmodified output. A result reaches L3 only when the engine also recomputed it on an enrolled worker (L2) and one attestation pins every input of that result.",
      action: "Record attestation",
      fields: [
        {
          name: "artifactIds",
          label: "Files the re-run produced",
          type: "checklist",
          ids: [],
          options: attestable.map((a) => ({
            value: a.id,
            label:
              a.name +
              (pinnedInputs.has(a.sha256) ? " · input of a GenAI result" : ""),
          })),
        },
        { name: "harnessName", label: "Harness name" },
        { name: "harnessVersion", label: "Harness version" },
        {
          name: "imageDigest",
          label: "Harness image digest",
          optional: true,
          hint: "sha256: followed by 64 hexadecimal characters, if the harness ran from an image.",
        },
        {
          name: "endpointHost",
          label: "System under test: endpoint host",
          hint: "The host only (for example api.example.com), without a path or credentials.",
        },
        { name: "snapshot", label: "System under test: model snapshot" },
        {
          name: "start",
          label: "Run started (UTC)",
          hint: "For example 2026-11-05T09:00",
        },
        {
          name: "end",
          label: "Run ended (UTC)",
          hint: "For example 2026-11-05T11:30",
        },
        {
          name: "environment",
          label: "Environment",
          type: "area",
          optional: true,
          maxLength: 2000,
          hint: "Where and how the run was made, in at most 2,000 characters; never paste secrets.",
        },
        {
          name: "statement",
          label: "Statement",
          type: "select",
          options: [{ value: RERUN_STATEMENT, label: RERUN_STATEMENT }],
        },
      ],
      save: (v) => run("attestGenaiRerun", attestationPayload(v, e.artifacts)),
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
            <IntakeActions
              view={view}
              busy={busy}
              canFreeze={procedureOptions.length > 0}
              canImport={envelopes.length > 0}
              canAttest={attestable.length > 0}
              onFreeze={() => freezePlan()}
              onDeclare={declareBundle}
              onQueue={queueIngest}
              onImport={importEnvelope}
              onAttest={attestRerun}
            />
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
            {[
              count(view.plans.length, "frozen plan"),
              count(view.bundles.length, "declared bundle"),
              count(view.jobs.length, "ingest job"),
              count(view.acknowledgements.length, "acknowledgement"),
              count(view.attestations.length, "re-run attestation"),
            ].join(" · ")}
          </p>
        )}
        {writer && view && !ingestAvailable && (
          <p className="subtle" data-genai-no-ingest-worker>
            No active worker of this engagement is enrolled with the
            genai_ingest capability, so the engine&apos;s ingest cannot be
            queued yet. Until one is, import envelopes made with the engine CLI.
          </p>
        )}
        {writer && art50Plans.length > 0 && (
          <div data-testid="art50-genai-plans">
            <p className="subtle">
              Art 50 criteria that GenAI marking evidence decides can be
              pre-registered in a plan for the procedure; review the bands, then
              freeze it.
            </p>
            <ul>
              {art50Plans.map((a) => (
                <li key={a.procedure.id} className="row-actions">
                  {a.procedure.templateId} ·{" "}
                  {a.genai.preRegistered.map((c) => c.id).join(", ")}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => freezePlan(a)}
                  >
                    Pre-register in a plan
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {writer && view && (
          <FinishedIngests
            jobs={view.jobs}
            imported={imported}
            procedures={e.workflow?.procedures ?? []}
            busy={busy}
            onCompile={(jobId) => void act("compileGenaiResult", { jobId })}
          />
        )}
        {genai.loading && <ViewLoading label="Loading GenAI evidence" />}
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
            plan={resultPlanLabel(
              r,
              view?.jobs ?? [],
              e.workflow?.procedures ?? [],
            )}
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
