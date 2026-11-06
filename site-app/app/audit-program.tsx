"use client";
import { packageStatusLabel } from "@/lib/report-presentation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardList,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement, Paper, Report, Role, Finding } from "@/lib/domain";
import type {
  BriefFields,
  Procedure,
  ProcedurePlan,
} from "@/lib/workflow-types";
import {
  currentExecution,
  procedureLabel,
  releaseState,
} from "@/lib/workflow-state";
import type { WorkspaceData } from "./workspace-types";
import { FrozenReportDetails } from "./report-details";
import { ProcedureContext } from "./procedure-context";
import { ProcedureComparison } from "./revision-comparison";
import {
  DraftRecovery,
  useRecoverableDraft,
  type DraftScope,
} from "./recoverable-draft";
import { procedureWork } from "@/lib/work-items";
type Option = {
  value: string;
  label: string;
};
type Field = {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "date" | "area" | "select" | "checklist";
  options?: Option[];
  ids?: string[];
  optional?: boolean;
  hint?: string;
};
export type WorkflowAct = (
  op: string,
  data: Record<string, unknown>,
) => Promise<{
  engagement: Engagement;
  details?: Record<string, string>;
}>;
type Form = {
  title: string;
  draft?: DraftScope;
  description?: string;
  action: string;
  fields: Field[];
  save: (values: Record<string, string | string[]>) => Promise<unknown>;
};
const label = (s: string) => s.replaceAll("_", " ").replace(/([A-Z])/g, " $1");
export function WorkflowDialog({
  form,
  onClose,
  busy,
  onEditing,
}: {
  form: Form | null;
  onClose: () => void;
  busy: boolean;
  onEditing?: (v: boolean) => void;
}) {
  const [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false),
    [values, setValues] = useState<Record<string, string | string[]>>({});
  const recovery = useRecoverableDraft(
    form?.draft,
    values,
    dirty,
    !!form?.draft,
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialises the editor fields each time another form opens
    setError("");
    setDirty(false);
    setConfirm(false);
    setValues(
      Object.fromEntries(
        form?.fields.map((f) => [
          f.name,
          f.type === "checklist" ? (f.ids ?? []) : (f.value ?? ""),
        ]) ?? [],
      ),
    );
    onEditing?.(!!form);
    return () => onEditing?.(false);
  }, [form, onEditing]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget),
      v: Record<string, string | string[]> = {};
    for (const f of form!.fields)
      v[f.name] =
        f.type === "checklist"
          ? fields.getAll(f.name).map(String)
          : String(fields.get(f.name) ?? "");
    try {
      setError("");
      await form!.save(v);
      setDirty(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }
  function close() {
    if (busy) return;
    if (dirty) setConfirm(true);
    else onClose();
  }
  return (
    <Dialog
      open={!!form}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {form && (
        <DialogContent className="audit-dialog workflow-dialog">
          <DialogHeader>
            <DialogTitle>{form.title}</DialogTitle>
            <DialogDescription>
              {form.description ??
                "Changes are recorded with your identity and the current engagement version."}
            </DialogDescription>
          </DialogHeader>
          <DraftRecovery
            draft={recovery}
            onRestore={(v) => {
              setValues(v as Record<string, string | string[]>);
              setDirty(true);
            }}
          />
          <form
            onSubmit={submit}
            onChange={(ev) => {
              setDirty(true);
              const fd = new FormData(ev.currentTarget);
              setValues(
                Object.fromEntries(
                  form.fields.map((f) => [
                    f.name,
                    f.type === "checklist"
                      ? fd.getAll(f.name).map(String)
                      : String(fd.get(f.name) ?? ""),
                  ]),
                ),
              );
            }}
          >
            <fieldset disabled={busy}>
              {form.fields.map((f) => (
                <div className="workflow-field" key={f.name}>
                  {f.type === "checklist" ? (
                    <fieldset>
                      <legend>{f.label}</legend>
                      <div className="workflow-checklist">
                        {f.options?.map((o) => (
                          <label key={o.value}>
                            <input
                              type="checkbox"
                              name={f.name}
                              value={o.value}
                              checked={
                                Array.isArray(values[f.name]) &&
                                (values[f.name] as string[]).includes(o.value)
                              }
                              readOnly
                            />
                            <span>{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <label>
                      {f.label}
                      {f.type === "area" ? (
                        <Textarea
                          name={f.name}
                          value={String(values[f.name] ?? "")}
                          onChange={() => {}}
                          required={!f.optional}
                          maxLength={8000}
                        />
                      ) : f.type === "select" ? (
                        <select
                          name={f.name}
                          value={String(values[f.name] ?? "")}
                          onChange={() => {}}
                          required={!f.optional}
                        >
                          <option value="">Choose…</option>
                          {f.options?.map((o) => (
                            <option value={o.value} key={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          name={f.name}
                          type={f.type === "date" ? "date" : "text"}
                          value={String(values[f.name] ?? "")}
                          onChange={() => {}}
                          required={!f.optional}
                          maxLength={f.type === "date" ? undefined : 300}
                        />
                      )}
                    </label>
                  )}
                  {f.hint && <small className="subtle">{f.hint}</small>}
                </div>
              ))}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {confirm && (
                <p className="form-error" role="alert">
                  Discard your unsaved changes?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setDirty(false);
                      onClose();
                    }}
                  >
                    Discard changes
                  </button>{" "}
                  <button type="button" onClick={() => setConfirm(false)}>
                    Keep editing
                  </button>
                </p>
              )}
              <div className="form-footer">
                <span className="subtle">
                  {dirty ? recovery.status || "Unsaved changes" : ""}
                </span>
                <div className="row-actions">
                  <Button type="button" variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {busy ? "Saving…" : form.action}
                  </Button>
                </div>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
function WorkflowStep({
  number,
  title,
  status,
  done = false,
  onClick,
}: {
  number: string;
  title: string;
  status: string;
  done?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={done ? "done" : ""} onClick={onClick}>
      <span>{number}</span>
      <div>
        <b>{title}</b>
        <small>{status}</small>
      </div>
    </button>
  );
}
const programViewMemory = new Map<
  string,
  {
    tab: string;
    query: string;
    filter: string;
    section: string;
  }
>();
const procedureSections = ["plan", "execute", "evaluate", "review"];
const programSections = ["brief", "program", "review", "followup"];
const options = (items: string[]) =>
  items.map((value) => ({ value, label: label(value) }));
const area = (
  name: string,
  title: string,
  value = "",
  optional = false,
): Field => ({ name, label: title, value, type: "area", optional });
const choice = (
  name: string,
  title: string,
  opts: Option[],
  value = "",
  optional = false,
): Field => ({
  name,
  label: title,
  options: opts,
  value,
  type: "select",
  optional,
});
const reason = () => [area("reason", "Review decision and rationale")];
const evidence = (e: Engagement, ids: string[] = []): Field => ({
  name: "evidenceIds",
  label: "Accepted supporting evidence",
  type: "checklist",
  options: e.artifacts
    .filter((a) => a.status === "accepted")
    .map((a) => ({ value: a.id, label: a.name + " · " + a.category })),
  ids,
  hint: "File acceptance and evidential sufficiency are separate decisions.",
});
export function AuditProgram({
  data,
  busy,
  act,
  onPaper,
  onRequest,
  onNavigate,
  onEditing,
  initialProcedure,
  initialSection,
  onLocation,
  onRecord,
  onFollowup,
  onContext,
  onFinding,
  onQueuedRun,
}: {
  onFinding: (p: Procedure) => void;
  onContext: (id: string) => void;
  /** A planned evaluation of the procedure was queued as `runId`. */
  onQueuedRun: (procedureId: string, runId: string) => void;
  data: WorkspaceData;
  busy: boolean;
  act: WorkflowAct;
  onPaper: (p: Paper) => void;
  onRequest: (p: Paper) => void;
  onNavigate: (v: string) => void;
  onEditing: (v: boolean) => void;
  initialProcedure?: string;
  initialSection?: string;
  onLocation: (id: string | undefined, section: string) => void;
  onRecord: (title: string, value: unknown) => void;
  onFollowup: (id: string) => void;
}) {
  const e = data.engagement!,
    w = e.workflow,
    uid = data.identity.id,
    role = data.identity.role,
    writer = ["Auditor", "Lead Auditor"].includes(role),
    lead = role === "Lead Auditor",
    reviewer = ["Reviewer", "Lead Auditor"].includes(role);
  const memoryKey = data.tenantId + ":" + uid + ":" + e.id,
    memory = programViewMemory.get(memoryKey);
  const availableInitialProcedure =
    initialProcedure && w?.procedures.some((p) => p.id === initialProcedure)
      ? initialProcedure
      : undefined;
  const requestedProcedureSection =
    availableInitialProcedure &&
    procedureSections.includes(initialSection ?? "")
      ? initialSection
      : undefined;
  const requestedProgramTab = requestedProcedureSection
    ? requestedProcedureSection === "review"
      ? "review"
      : "program"
    : programSections.includes(initialSection ?? "")
      ? initialSection
      : undefined;
  const [tab, setTab] = useState(
      requestedProgramTab ?? memory?.tab ?? "program",
    ),
    [query, setQuery] = useState(memory?.query ?? ""),
    [filter, setFilter] = useState(memory?.filter ?? "selected"),
    [selected, setSelected] = useState<string | undefined>(
      availableInitialProcedure,
    ),
    [form, setForm] = useState<Form | null>(null),
    [section, setSection] = useState(
      requestedProcedureSection ?? memory?.section ?? "plan",
    ),
    [batchIds, setBatchIds] = useState<string[]>([]);
  const restoringLocation = useRef<{
      id: string | undefined;
      section: string;
    } | null>(null),
    onLocationRef = useRef(onLocation);
  // eslint-disable-next-line react-hooks/refs -- latest-callback ref read by the URL-sync effects; writing it during render is the current behaviour
  onLocationRef.current = onLocation;
  useEffect(() => {
    programViewMemory.set(memoryKey, { tab, query, filter, section });
  }, [memoryKey, tab, query, filter, section]);
  useEffect(() => {
    if (form) return;
    // Hold URL updates until both parts of an incoming procedure link are applied.
    restoringLocation.current = {
      id: availableInitialProcedure,
      section: requestedProcedureSection ?? section,
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- applies an incoming procedure deep link
    setSelected(availableInitialProcedure);
    if (requestedProcedureSection) setSection(requestedProcedureSection);
    if (requestedProgramTab) setTab(requestedProgramTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-applied only when the linked procedure, section or open form changes; the tab and current section are read at that moment
  }, [availableInitialProcedure, initialSection, form]);
  useEffect(() => {
    if (form) return;
    const restoring = restoringLocation.current;
    if (
      restoring &&
      (restoring.id !== selected || restoring.section !== section)
    )
      return;
    restoringLocation.current = null;
    if (selected) onLocationRef.current(selected, section);
  }, [selected, section, availableInitialProcedure, initialSection, form]);
  const p = w?.procedures.find((p) => p.id === selected),
    people = (allowed: Role[]) =>
      data.people
        .filter((m) => m.status === "active" && allowed.includes(m.role))
        .map((m) => ({
          value: m.user_id,
          label: m.display_name + " · " + m.role,
        }));
  const name = (id: string) =>
    data.people.find((m) => m.user_id === id)?.display_name ??
    (id ? "Unknown or inactive member" : "Unassigned");
  function draftScope(
    kind: DraftScope["kind"],
    recordId: string,
    p?: Procedure,
  ): DraftScope {
    return {
      tenantId: data.tenantId,
      engagementId: e.id,
      kind,
      recordId,
      baseRevision:
        kind === "brief"
          ? String(w?.brief?.revision ?? 0)
          : [
              p!.revision,
              p!.execution?.revision ?? 0,
              w!.program.revision,
              w?.brief?.revision ?? 0,
            ].join(":"),
    };
  }
  function command(
    title: string,
    op: string,
    fields: Field[],
    fixed: Record<string, unknown> = {},
    action = "Save decision",
  ) {
    setForm({
      title,
      action,
      fields,
      save: (v) => act(op, { ...fixed, ...v }),
    });
  }
  function brief() {
    const b = w?.brief;
    const labels: Record<keyof BriefFields, string> = {
      systemName: "AI system and version",
      intendedUse: "Intended use and decision context",
      boundary: "Audit boundary and exclusions",
      periodStart: "Period from",
      periodEnd: "Period to",
      actorResponsibilities:
        "Provider, deployer and other actor responsibilities",
      audience: "Intended report users",
      deliverables: "Deliverables and assurance limitations",
      basis: "Regulatory source, applicable dates and assurance criteria",
      constraints: "Access, data rights and engagement constraints",
      independence: "Competence, independence and conflicts assessment",
      changeImpact: "Scope change and impact on earlier work",
    };
    setForm({
      title: b ? "Revise engagement brief" : "Complete engagement brief",
      action: "Save scope draft",
      draft: draftScope("brief", "brief"),
      description:
        "Define what the audit covers before planning or testing. Approval is independent of preparation.",
      fields: Object.entries(labels).map(([name, title]) => ({
        name,
        label: title,
        type: name.startsWith("period")
          ? "date"
          : name === "systemName"
            ? "text"
            : "area",
        value: b?.[name as keyof BriefFields] ?? "",
        optional: name === "changeImpact",
      })),
      save: (v) => act("saveBrief", v),
    });
  }
  function planForm(p: Procedure) {
    const fields: Field[] = [
      choice(
        "selected",
        "Agreed scope",
        options(["true", "false"]),
        String(p.selected),
      ),
      choice(
        "applicability",
        "Regulatory applicability",
        options(["pending", "applicable", "readiness", "not_applicable"]),
        p.applicability,
      ),
      area("rationale", "Applicability and selection rationale", p.rationale),
      area("criterion", "Audit criterion and requirement", p.criterion),
      {
        name: "sourceVersion",
        label: "Source and version",
        value: p.sourceVersion,
      },
      area(
        "periodAnalysis",
        "Applicability during this audit period",
        p.periodAnalysis,
      ),
      area("population", "Population and scope", p.population),
      area("sampling", "Sampling approach and rationale", p.sampling),
      choice(
        "ownerId",
        "Preparer",
        people(["Auditor", "Lead Auditor"]),
        p.ownerId,
      ),
      choice(
        "reviewerId",
        "Independent reviewer",
        people(["Reviewer", "Lead Auditor"]).filter(
          (x) => x.value !== p.ownerId && !p.contributors.includes(x.value),
        ),
        p.reviewerId,
      ),
      { name: "dueDate", label: "Due date", type: "date", value: p.dueDate },
      choice(
        "method",
        "Execution method",
        options(["manual", "automated", "mixed"]),
        p.method,
      ),
      choice(
        "modelId",
        "Model version",
        e.models.map((m) => ({
          value: m.id,
          label: m.name + " · " + m.version,
        })),
        p.modelId,
        true,
      ),
      choice(
        "datasetId",
        "Dataset",
        e.artifacts
          .filter((a) => a.category === "Dataset" && a.status === "accepted")
          .map((a) => ({ value: a.id, label: a.name })),
        p.datasetId,
        true,
      ),
      choice(
        "profileId",
        "Evaluation protocol",
        e.evaluationProfiles?.map((p) => ({
          value: p.id,
          label: p.name + " · " + p.version,
        })) ?? [],
        p.profileId,
        true,
      ),
    ];
    setForm({
      title: "Plan · " + p.templateId,
      action: "Save plan revision",
      draft: draftScope("procedure-plan", p.id, p),
      fields,
      save: (v) =>
        act("saveProcedurePlan", {
          procedureId: p.id,
          plan: {
            ...v,
            selected: v.selected === "true",
          } as unknown as ProcedurePlan,
        }),
    });
  }
  function execute(p: Procedure) {
    const v = p.execution;
    setForm({
      title: "Record work performed · " + p.templateId,
      action: "Save execution",
      draft: draftScope("procedure-execution", p.id, p),
      description:
        "Record actual work. Planned guidance is not proof that a step was performed.",
      fields: [
        area("performed", "What you actually performed", v?.performed),
        ...p.instructions.flatMap((i) => [
          choice(
            "step:" + i.id,
            i.text,
            options(["performed", "not_performed"]),
            v?.steps.find((s) => s.id === i.id)?.state ?? "",
          ),
          area(
            "note:" + i.id,
            "Step notes / explanation if omitted",
            v?.steps.find((s) => s.id === i.id)?.notes ?? "",
            true,
          ),
        ]),
        area("sampling", "Actual sample and selection", v?.sampling),
        area("results", "Observed results and exceptions", v?.results),
        area(
          "limitations",
          "Limitations and unfinished work",
          v?.limitations,
          true,
        ),
        evidence(e, v?.evidenceIds),
        {
          name: "runIds",
          label: "Completed evaluations for this procedure",
          type: "checklist",
          ids: v?.runIds,
          options: e.runs
            .filter(
              (r) =>
                r.state === "succeeded" &&
                r.procedureBinding?.procedureId === p.id &&
                r.procedureBinding.procedureRevision === p.revision &&
                r.procedureBinding.programRevision === w?.program.revision,
            )
            .map((r) => ({
              value: r.id,
              label: new Date(r.createdAt).toLocaleString() + " · " + r.outcome,
            })),
        },
      ],
      save: (f) =>
        act("recordProcedureExecution", {
          procedureId: p.id,
          performed: f.performed,
          sampling: f.sampling,
          results: f.results,
          limitations: f.limitations,
          evidenceIds: f.evidenceIds,
          runIds: f.runIds,
          steps: p.instructions.map((i) => ({
            id: i.id,
            state: f["step:" + i.id],
            notes: f["note:" + i.id],
          })),
        }),
    });
  }
  function evaluate(p: Procedure) {
    const a = p.execution?.assessment;
    command(
      "Evaluate evidence · " + p.templateId,
      "evaluateProcedure",
      [
        area("relevance", "Relevance to the criterion", a?.relevance),
        area("reliability", "Reliability and provenance", a?.reliability),
        area(
          "coverage",
          "Coverage, sample sufficiency and currency",
          a?.coverage,
        ),
        area(
          "contradictions",
          "Contradictory evidence and how it was resolved",
          a?.contradictions,
        ),
        area("conclusion", "Reasoned auditor conclusion", a?.conclusion),
        choice(
          "outcome",
          "Conclusion status",
          options(["supported", "qualified", "not_supported"]),
          a?.outcome,
        ),
      ],
      { procedureId: p.id },
      "Save evaluation",
    );
    setForm((f) =>
      f ? { ...f, draft: draftScope("procedure-assessment", p.id, p) } : f,
    );
  }
  function bulk() {
    setForm({
      title: "Assess methodology candidates",
      action: "Save scope decisions",
      description:
        "Choose procedures explicitly. The same documented rationale and period analysis will be applied to those candidates; review individual criteria before program approval.",
      fields: [
        {
          name: "procedureIds",
          label: "Procedures",
          type: "checklist",
          options: w!.procedures.map((p) => ({
            value: p.id,
            label: p.templateId + " · " + p.title,
          })),
        },
        choice(
          "selected",
          "Include in agreed audit scope",
          options(["true", "false"]),
        ),
        choice(
          "applicability",
          "Applicability decision",
          options(["applicable", "readiness", "not_applicable"]),
        ),
        area("rationale", "Reason for applicability and scope selection"),
        area(
          "periodAnalysis",
          "Applicable duties and dates during the audit period",
        ),
      ],
      save: (v) =>
        act("scopeProgramCandidates", {
          ...v,
          selected: v.selected === "true",
        }),
    });
  }
  function staffing() {
    setForm({
      title: "Assign selected procedures",
      action: "Save planning revision",
      description:
        "Only the fields you choose will change. Planning changes require renewed program approval.",
      fields: [
        choice(
          "ownerId",
          "Preparer",
          people(["Auditor", "Lead Auditor"]),
          "",
          true,
        ),
        choice(
          "reviewerId",
          "Independent reviewer",
          people(["Reviewer", "Lead Auditor"]),
          "",
          true,
        ),
        { name: "dueDate", label: "Due date", type: "date", optional: true },
      ],
      save: async (v) => {
        const patch = Object.fromEntries(
          Object.entries(v).filter(([, value]) => value !== ""),
        );
        if (!Object.keys(patch).length)
          throw Error("Choose a preparer, reviewer or due date");
        await act("bulkPlanProcedures", { procedureIds: batchIds, patch });
        setBatchIds([]);
      },
    });
  }
  function monitoring() {
    command(
      "New follow-up case",
      "createMonitoringCase",
      [
        choice(
          "kind",
          "Case type",
          options(["monitoring", "change", "incident", "remediation"]),
        ),
        { name: "title", label: "Subject" },
        area("description", "Trigger, risk and work needed"),
        choice(
          "ownerId",
          "Responsible auditor",
          people(["Auditor", "Lead Auditor"]),
        ),
        { name: "dueDate", label: "Due date", type: "date" },
        choice(
          "cadence",
          "Monitoring cadence",
          options(["one_off", "monthly", "quarterly", "annual"]),
          "one_off",
        ),
        choice(
          "findingId",
          "Related finding",
          e.findings.map((f) => ({ value: f.id, label: f.title })),
          "",
          true,
        ),
        choice(
          "reportId",
          "Baseline report",
          e.reports
            .filter((r) => r.kind === "final")
            .map((r) => ({
              value: r.id,
              label:
                new Date(r.createdAt).toLocaleDateString() +
                " · " +
                String(r.snapshot.opinion),
            })),
          "",
          true,
        ),
      ],
      {},
      "Create case",
    );
  }
  if (!w)
    return (
      <section className="workflow-start">
        <ClipboardList size={30} />
        <h2>Set up the audit program</h2>
        <p>
          Review scope, select the procedures that apply, then carry each
          procedure through execution and independent review.
        </p>
        <p className="subtle">
          Existing papers and signatures stay in their history. Adoption links
          them to draft methodology candidates for a fresh scope review.
        </p>
        {lead ? (
          <Button
            disabled={busy}
            onClick={() => void act("adoptWorkflow", {}).catch(() => {})}
          >
            Adopt workflow
          </Button>
        ) : (
          <p>A Lead Auditor can adopt the workflow for this engagement.</p>
        )}
      </section>
    );
  const rows = w.procedures.filter(
    (p) =>
      ((filter === "waiting" && procedureWork(e, p.id)!.waiting) ||
        (filter === "corrections" && procedureWork(e, p.id)!.corrections) ||
        (filter === "overdue" && procedureWork(e, p.id)!.overdue) ||
        (filter === "ready" && procedureWork(e, p.id)!.readyToEvaluate) ||
        filter === "all" ||
        (filter === "selected" && p.selected) ||
        (filter === "pending" && p.applicability === "pending") ||
        (filter === "mine" && p.ownerId === uid) ||
        (filter === "review" &&
          p.state === "submitted" &&
          p.reviewerId === uid)) &&
      (!query ||
        (p.title + " " + p.templateId)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const completed = w.procedures.filter(
      (p) => p.selected && p.state === "reviewed",
    ).length,
    inScope = w.procedures.filter((p) => p.selected).length;
  const b = w.brief;
  return (
    <>
      <div className="workflow-spine">
        <WorkflowStep
          number="1"
          title="Engagement brief"
          status={b?.status ?? "Not started"}
          done={b?.status === "approved"}
          onClick={() => setTab("brief")}
        />
        <WorkflowStep
          number="2"
          title="Audit program"
          status={w.program.status}
          done={w.program.status === "approved"}
          onClick={() => setTab("program")}
        />
        <WorkflowStep
          number="3"
          title="Execute & evaluate"
          status={completed + " / " + inScope + " reviewed"}
          onClick={() => {
            setTab("program");
            setFilter("selected");
          }}
        />
        <WorkflowStep
          number="4"
          title="Independent review"
          status={
            w.procedures.filter((p) => p.state === "submitted").length +
            " pending"
          }
          onClick={() => setTab("review")}
        />
        <WorkflowStep
          number="5"
          title="Report & release"
          status="Open reports"
          onClick={() => onNavigate("Reports & sign-off")}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="program">Program</TabsTrigger>
          <TabsTrigger value="brief">Engagement brief</TabsTrigger>
          <TabsTrigger value="review">Review inbox</TabsTrigger>
          <TabsTrigger value="followup">Follow-up</TabsTrigger>
        </TabsList>
        <TabsContent value="brief">
          <section className="panel workflow-document">
            <div className="panel-head">
              <h2>{b?.systemName ?? "Engagement scope"}</h2>
              <span className="badge neutral">
                {b ? b.status + " · revision " + b.revision : "Draft needed"}
              </span>
            </div>
            {b ? (
              <>
                <dl className="document-properties">
                  <div>
                    <dt>Period</dt>
                    <dd>
                      {b.periodStart} — {b.periodEnd}
                    </dd>
                  </div>
                  <div>
                    <dt>Updated by</dt>
                    <dd>{name(b.updatedBy)}</dd>
                  </div>
                  <div>
                    <dt>Approval</dt>
                    <dd>
                      {b.approval
                        ? name(b.approval.userId) +
                          " · " +
                          new Date(b.approval.at).toLocaleString()
                        : "Independent approval needed"}
                    </dd>
                  </div>
                </dl>
                {[
                  ["intendedUse", "Intended use"],
                  ["boundary", "Boundary and exclusions"],
                  ["actorResponsibilities", "Actor responsibilities"],
                  ["basis", "Applicable criteria and dates"],
                  ["deliverables", "Deliverables"],
                  ["audience", "Report audience"],
                  ["constraints", "Constraints"],
                  ["independence", "Competence and independence"],
                  ["changeImpact", "Change impact"],
                ].map(
                  ([k, t]) =>
                    b[k as keyof BriefFields] && (
                      <section className="readable-section" key={k}>
                        <h3>{t}</h3>
                        <p className="record-text">
                          {b[k as keyof BriefFields]}
                        </p>
                      </section>
                    ),
                )}
                {b.approval && (
                  <p className="record-text">
                    Review rationale: {b.approval.reason}
                  </p>
                )}
                <details className="provenance">
                  <summary>Scope revision history ({b.history.length})</summary>
                  {b.history.map((h, i) => (
                    <div className="comment-box" key={i}>
                      <b>
                        Revision {h.revision} · {h.status}
                      </b>
                      <p>{h.boundary}</p>
                      <p>{h.changeImpact}</p>
                      <small>
                        {name(h.updatedBy)} ·{" "}
                        {new Date(h.updatedAt).toLocaleString()}
                      </small>
                    </div>
                  ))}
                </details>
              </>
            ) : (
              <p className="empty-result">
                Define the AI system, audit period, responsibilities and
                criteria.
              </p>
            )}
            <div className="row-actions">
              {writer &&
                b?.status !== "submitted" &&
                (b?.status !== "approved" || lead) && (
                  <Button disabled={busy} onClick={brief}>
                    {b ? "Revise scope" : "Complete brief"}
                  </Button>
                )}
              {writer && b?.status === "draft" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act("submitBrief", {}).catch(() => {})}
                >
                  Submit for review
                </Button>
              )}
              {reviewer && b?.status === "submitted" && (
                <>
                  <Button
                    disabled={busy || b.contributors.includes(uid)}
                    onClick={() =>
                      command(
                        "Approve scope revision " + b.revision,
                        "approveBrief",
                        reason(),
                        { revision: b.revision },
                        "Approve scope",
                      )
                    }
                  >
                    Approve scope
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      command(
                        "Return scope for correction",
                        "returnBrief",
                        reason(),
                      )
                    }
                  >
                    Request changes
                  </Button>
                </>
              )}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="program">
          <section className="panel">
            <div className="workflow-toolbar">
              <div>
                <b>Program revision {w.program.revision}</b>
                <small className="subtle block">
                  {w.program.status} · scope revision{" "}
                  {w.program.briefRevision || "not bound"} · {inScope} selected
                </small>
              </div>
              <div className="row-actions">
                {writer && (w.program.status === "draft" || lead) && (
                  <Button variant="outline" disabled={busy} onClick={bulk}>
                    Assess candidates
                  </Button>
                )}
                {writer && w.program.status === "draft" && (
                  <Button
                    disabled={busy || b?.status !== "approved"}
                    title={
                      b?.status !== "approved"
                        ? "Approve the engagement brief first"
                        : undefined
                    }
                    onClick={() =>
                      void act("submitProgram", {}).catch(() => {})
                    }
                  >
                    Submit program
                  </Button>
                )}
                {reviewer && w.program.status === "submitted" && (
                  <>
                    <Button
                      disabled={busy || w.program.contributors.includes(uid)}
                      onClick={() =>
                        command(
                          "Approve program revision " + w.program.revision,
                          "approveProgram",
                          reason(),
                          { revision: w.program.revision },
                          "Approve program",
                        )
                      }
                    >
                      Approve program
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        command(
                          "Return program for correction",
                          "returnProgram",
                          reason(),
                        )
                      }
                    >
                      Request changes
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="workflow-toolbar">
              <div className="workflow-filters">
                {[
                  ["selected", "In scope"],
                  ["pending", "Decisions needed"],
                  ["mine", "Assigned to me"],
                  ["review", "My reviews"],
                  ["waiting", "Waiting on evidence"],
                  ["corrections", "Corrections"],
                  ["overdue", "Overdue"],
                  ["ready", "Ready to evaluate"],
                  ["all", "All candidates"],
                ].map(([v, t]) => (
                  <button
                    className={v === filter ? "active" : ""}
                    key={v}
                    onClick={() => setFilter(v)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <label className="workflow-search">
                <Search size={15} />
                <Input
                  aria-label="Search audit procedures"
                  placeholder="Find a procedure…"
                  value={query}
                  onChange={(v) => setQuery(v.target.value)}
                />
              </label>
            </div>
            {writer && (
              <div className="planning-selection">
                <label>
                  <input
                    type="checkbox"
                    checked={
                      rows.length > 0 &&
                      rows.every((p) => batchIds.includes(p.id))
                    }
                    onChange={(ev) =>
                      setBatchIds(
                        ev.target.checked
                          ? [
                              ...new Set([
                                ...batchIds,
                                ...rows.map((p) => p.id),
                              ]),
                            ]
                          : batchIds.filter(
                              (id) => !rows.some((p) => p.id === id),
                            ),
                      )
                    }
                  />
                  Select visible procedures
                </label>
                <span>{batchIds.length} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    !batchIds.length ||
                    (w.program.status !== "draft" && !lead)
                  }
                  onClick={staffing}
                >
                  Assign & schedule
                </Button>
                {!!batchIds.length && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBatchIds([])}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
            )}
            <div className="workflow-table">
              <table className="compact-register">
                <thead>
                  <tr>
                    <th scope="col">Procedure</th>
                    <th scope="col">Applicability</th>
                    <th scope="col">Owner / due</th>
                    <th scope="col">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {writer && (
                          <input
                            type="checkbox"
                            aria-label={"Select " + p.templateId}
                            checked={batchIds.includes(p.id)}
                            onChange={(ev) =>
                              setBatchIds((ids) =>
                                ev.target.checked
                                  ? [...ids, p.id]
                                  : ids.filter((id) => id !== p.id),
                              )
                            }
                          />
                        )}
                        <button
                          className="paper-link"
                          onClick={() => {
                            setSelected(p.id);
                            setSection(p.execution ? "execute" : "plan");
                          }}
                        >
                          <small className="subtle block">
                            {p.templateId} · {p.stage}
                          </small>
                          <b>{p.title}</b>
                        </button>
                      </td>
                      <td data-label="Applicability">
                        {label(p.applicability)}
                      </td>
                      <td data-label="Owner & due date">
                        {name(p.ownerId)}
                        <small className="subtle block">
                          {p.dueDate || "Deadline needed"}
                        </small>
                      </td>
                      <td data-label="Next step">
                        <button
                          className="workflow-next"
                          onClick={() => {
                            setSelected(p.id);
                            setSection(
                              p.state === "submitted"
                                ? "review"
                                : p.state === "executed"
                                  ? "evaluate"
                                  : p.execution
                                    ? "execute"
                                    : "plan",
                            );
                          }}
                        >
                          {procedureLabel(e, p)}
                          <ArrowUpRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="empty-state">
                <ClipboardList size={28} />
                <h3>
                  {filter === "selected"
                    ? "Choose the procedures this audit needs"
                    : "No matching procedures"}
                </h3>
                <p>
                  {filter === "selected"
                    ? "Start with the engagement brief, then assess methodology candidates."
                    : "Choose another view or clear the search."}
                </p>
                {writer && filter === "selected" && (
                  <Button variant="outline" onClick={() => setFilter("all")}>
                    Review all candidates
                  </Button>
                )}
              </div>
            )}
            <details className="provenance workflow-history">
              <summary>Program approval and revision history</summary>
              {w.program.approval && (
                <p>
                  Approved by {name(w.program.approval.userId)} ·{" "}
                  {w.program.approval.reason}
                </p>
              )}
              {w.program.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <p key={i}>
                    Revision {h.revision} · {h.status} · scope {h.briefRevision}{" "}
                    · {new Date(h.at).toLocaleString()} · {name(h.actor)}
                  </p>
                ))}
            </details>
          </section>
        </TabsContent>
        <TabsContent value="review">
          <section className="panel">
            <div className="panel-head">
              <h2>Review inbox</h2>
              <span className="subtle">Current revisions only</span>
            </div>
            {b?.status === "submitted" && (
              <button className="attention-row" onClick={() => setTab("brief")}>
                <span>
                  <b>Engagement brief · revision {b.revision}</b>
                  <small className="block subtle">
                    Independent scope approval
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            )}
            {w.program.status === "submitted" && (
              <button
                className="attention-row"
                onClick={() => setTab("program")}
              >
                <span>
                  <b>Audit program · revision {w.program.revision}</b>
                  <small className="block subtle">
                    Selection, applicability and execution plan
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            )}
            {w.procedures
              .filter(
                (p) =>
                  p.state === "submitted" ||
                  (p.state === "reviewed" &&
                    e.papers.find((q) => q.id === p.paperId)?.status !==
                      "signed"),
              )
              .map((p) => (
                <button
                  key={p.id}
                  className="attention-row"
                  onClick={() => {
                    setSelected(p.id);
                    setSection("review");
                  }}
                >
                  <span>
                    <b>
                      {p.templateId} · {p.title}
                    </b>
                    <small className="block subtle">
                      {p.state === "reviewed"
                        ? "Lead sign-off needed"
                        : "Assigned to " + name(p.reviewerId)}{" "}
                      · paper revision {p.paperRevision}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            {e.papers
              .filter(
                (q) =>
                  q.status === "in_review" &&
                  !w.procedures.some((p) => p.paperId === q.id),
              )
              .map((q) => (
                <button
                  key={q.id}
                  className="attention-row"
                  onClick={() => onPaper(q)}
                >
                  <span>
                    <b>{q.title}</b>
                    <small className="block subtle">
                      Supplementary paper · revision {q.revision}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            {!w.procedures.some(
              (p) =>
                p.state === "submitted" ||
                (p.state === "reviewed" &&
                  e.papers.find((q) => q.id === p.paperId)?.status !==
                    "signed"),
            ) &&
              b?.status !== "submitted" &&
              w.program.status !== "submitted" &&
              !e.papers.some((p) => p.status === "in_review") && (
                <p className="empty-result">No work is awaiting review.</p>
              )}
          </section>
        </TabsContent>
        <TabsContent value="followup">
          <section className="panel">
            <div className="panel-head">
              <h2>Monitoring, changes & incidents</h2>
              {writer && (
                <Button variant="outline" disabled={busy} onClick={monitoring}>
                  <Plus size={14} />
                  New case
                </Button>
              )}
            </div>
            {w.monitoring.map((m) => (
              <details className="captured-record" key={m.id}>
                <summary>
                  <span>
                    {m.title}
                    <small className="block subtle">
                      {m.kind} · {name(m.ownerId)} · due {m.dueDate} ·{" "}
                      {label(m.cadence)}
                    </small>
                  </span>
                  <span className="badge neutral">{label(m.state)}</span>
                </summary>
                <p className="record-text">{m.description}</p>
                <p>Decision: {label(m.decision)}</p>
                <p className="record-text">
                  {m.assessment || "Assessment needed"}
                </p>
                {m.closure && (
                  <p className="record-text">Closure: {m.closure}</p>
                )}
                {m.successorEngagementId && (
                  <Button
                    variant="link"
                    onClick={() => onFollowup(m.successorEngagementId!)}
                  >
                    Open successor engagement <ArrowUpRight size={14} />
                  </Button>
                )}
                <div className="row-actions">
                  {writer && m.state !== "closed" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        command(
                          "Assess follow-up case",
                          "assessMonitoringCase",
                          [
                            choice(
                              "decision",
                              "Reassessment decision",
                              options([
                                "follow_up",
                                "no_reassessment",
                                "reassessment_required",
                              ]),
                              m.decision === "not_assessed" ? "" : m.decision,
                            ),
                            area(
                              "assessment",
                              "Assessment, impact and next action",
                              m.assessment,
                            ),
                            {
                              name: "dueDate",
                              label: "Next action due",
                              type: "date",
                              value: m.dueDate,
                            },
                            evidence(e, m.evidenceIds),
                          ],
                          { caseId: m.id },
                        )
                      }
                    >
                      Record assessment
                    </Button>
                  )}
                  {lead &&
                    m.decision === "reassessment_required" &&
                    !m.successorEngagementId &&
                    m.state !== "closed" && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          command(
                            "Open successor engagement",
                            "openFollowup",
                            [
                              {
                                name: "title",
                                label: "Engagement title",
                                value: e.title + " · reassessment",
                              },
                              {
                                name: "dueDate",
                                label: "Due date",
                                type: "date",
                                value: m.dueDate,
                              },
                            ],
                            { caseId: m.id },
                            "Create linked engagement",
                          )
                        }
                      >
                        Open reassessment
                      </Button>
                    )}
                  {reviewer && m.state === "in_progress" && (
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        m.contributors.includes(uid) ||
                        m.ownerId === uid
                      }
                      onClick={() =>
                        command(
                          "Independently close case",
                          "closeMonitoringCase",
                          [area("closure", "Evidence-backed closure decision")],
                          { caseId: m.id },
                          "Close case",
                        )
                      }
                    >
                      Review closure
                    </Button>
                  )}
                  {writer &&
                    m.state === "closed" &&
                    m.cadence !== "one_off" &&
                    !m.nextCaseId && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          command(
                            "Plan next monitoring cycle",
                            "createMonitoringCase",
                            [
                              {
                                name: "title",
                                label: "Next cycle subject",
                                value: m.title,
                              },
                              area(
                                "description",
                                "Monitoring scope",
                                m.description,
                              ),
                              {
                                name: "dueDate",
                                label: "Next cycle due date",
                                type: "date",
                              },
                            ],
                            {
                              previousCaseId: m.id,
                              kind: "monitoring",
                              ownerId: m.ownerId,
                              cadence: m.cadence,
                              findingId: m.findingId,
                              reportId: m.reportId,
                            },
                            "Create next cycle",
                          )
                        }
                      >
                        Plan next cycle
                      </Button>
                    )}
                </div>
                <details className="provenance">
                  <summary>Case history</summary>
                  {m.history.map((h, i) => (
                    <p key={i}>
                      {new Date(h.at).toLocaleString()} · {name(h.actor)} ·{" "}
                      {label(h.action)} · {h.assessment}
                    </p>
                  ))}
                </details>
              </details>
            ))}
            {!w.monitoring.length && (
              <p className="empty-result">
                Record monitoring commitments, material changes, incidents and
                remediation follow-up here.
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>
      <Sheet
        open={!!p}
        onOpenChange={(v) => {
          if (!v && !form) {
            setSelected(undefined);
            onLocation(undefined, section);
          }
        }}
      >
        {p && (
          <SheetContent
            side="right"
            className="paper-sheet expanded workflow-procedure"
          >
            <SheetDescription className="sr-only">
              Procedure plan, actual execution, evidence assessment and
              independent review.
            </SheetDescription>
            <div className="peek-bar">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(undefined);
                  onLocation(undefined, section);
                }}
              >
                <ArrowLeft size={14} />
                Back to program
              </Button>
              <span>
                {p.templateId} · revision {p.revision}
              </span>
            </div>
            <div className="sheet-scroll">
              <div className="document-page">
                <SheetTitle className="document-title">{p.title}</SheetTitle>
                <p className="subtle">{procedureLabel(e, p)}</p>
                <ProcedureContext
                  tenantId={data.tenantId}
                  engagement={e}
                  procedure={p}
                  onRecord={onRecord}
                />
                <Tabs value={section} onValueChange={setSection}>
                  <TabsList>
                    <TabsTrigger value="plan">Plan</TabsTrigger>
                    <TabsTrigger value="execute">Execute</TabsTrigger>
                    <TabsTrigger value="evaluate">Evaluate</TabsTrigger>
                    <TabsTrigger value="review">Review</TabsTrigger>
                  </TabsList>
                  <TabsContent value="plan">
                    <dl className="document-properties">
                      <div>
                        <dt>Preparer</dt>
                        <dd>{name(p.ownerId)}</dd>
                      </div>
                      <div>
                        <dt>Reviewer</dt>
                        <dd>{name(p.reviewerId)}</dd>
                      </div>
                      <div>
                        <dt>Due</dt>
                        <dd>{p.dueDate || "Not set"}</dd>
                      </div>
                      <div>
                        <dt>Scope</dt>
                        <dd>
                          {p.selected ? "Selected" : "Outside agreed scope"} ·{" "}
                          {label(p.applicability)}
                        </dd>
                      </div>
                      <div>
                        <dt>Method</dt>
                        <dd>{p.method}</dd>
                      </div>
                    </dl>
                    {[
                      ["Objective", p.objective],
                      ["Criterion", p.criterion],
                      ["Source", p.sourceVersion],
                      ["Applicability and scope rationale", p.rationale],
                      ["Period analysis", p.periodAnalysis],
                      ["Population", p.population],
                      ["Planned sampling", p.sampling],
                    ].map(([title, value]) => (
                      <section className="readable-section" key={title}>
                        <h3>{title}</h3>
                        <p className="record-text">
                          {value || "Needs planning"}
                        </p>
                      </section>
                    ))}
                    {writer && (w.program.status === "draft" || lead) && (
                      <Button disabled={busy} onClick={() => planForm(p)}>
                        Edit plan
                      </Button>
                    )}
                  </TabsContent>
                  <TabsContent value="execute">
                    <details className="captured-record" open={!p.execution}>
                      <summary>Planned guidance and expected evidence</summary>
                      <ol className="record-list">
                        {p.instructions.map((i) => (
                          <li key={i.id}>{i.text}</li>
                        ))}
                      </ol>
                      <h3>Expected evidence</h3>
                      <ul className="record-list">
                        {p.expectedEvidence.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </details>
                    {p.execution ? (
                      <>
                        <p className="subtle">
                          Executed by {name(p.execution.actor)} ·{" "}
                          {new Date(p.execution.at).toLocaleString()} · scope{" "}
                          {p.execution.briefRevision} / program{" "}
                          {p.execution.programRevision}
                        </p>
                        {!currentExecution(e, p) && (
                          <p className="form-error">
                            This execution predates the current scope or plan.
                            Reperform it or obtain an independent impact
                            assessment for unchanged steps.
                          </p>
                        )}
                        {[
                          ["Performed", p.execution.performed],
                          ["Sample", p.execution.sampling],
                          ["Results and exceptions", p.execution.results],
                          ["Limitations", p.execution.limitations],
                        ].map(([t, v]) => (
                          <section className="readable-section" key={t}>
                            <h3>{t}</h3>
                            <p className="record-text">
                              {v || "None recorded"}
                            </p>
                          </section>
                        ))}
                        <ul className="record-list">
                          {p.execution.steps.map((s) => (
                            <li key={s.id}>
                              {p.instructions.find((i) => i.id === s.id)?.text}{" "}
                              <b>{label(s.state)}</b>
                              <p>{s.notes}</p>
                            </li>
                          ))}
                        </ul>
                        <h3>Evidence</h3>
                        <ul className="record-list">
                          {p.execution.evidenceIds.map((id) => (
                            <li key={id}>
                              {e.artifacts.find((a) => a.id === id)?.name ??
                                "Unavailable evidence"}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="empty-result">
                        No execution has been recorded.
                      </p>
                    )}
                    <div className="row-actions">
                      {writer && (
                        <Button
                          disabled={
                            busy ||
                            w.program.status !== "approved" ||
                            b?.status !== "approved" ||
                            !p.selected ||
                            p.state === "submitted" ||
                            (p.ownerId !== uid && !lead)
                          }
                          title={
                            p.ownerId !== uid && !lead
                              ? "Assigned preparer: " + name(p.ownerId)
                              : undefined
                          }
                          onClick={() => execute(p)}
                        >
                          {p.execution
                            ? "Record new execution"
                            : "Record work performed"}
                        </Button>
                      )}
                      {writer && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act("ensureProcedurePaper", {
                              procedureId: p.id,
                            })
                              .then((r) => {
                                const q = r.engagement.papers.find(
                                  (q) => q.id === r.details?.paperId,
                                );
                                onContext(p.id);
                                setSelected(undefined);
                                if (q) onRequest(q);
                              })
                              .catch(() => {})
                          }
                        >
                          Request evidence
                        </Button>
                      )}
                      {writer && p.method !== "manual" && (
                        <Button
                          variant="outline"
                          disabled={
                            busy ||
                            w.program.status !== "approved" ||
                            !p.modelId ||
                            !p.datasetId ||
                            !p.profileId
                          }
                          onClick={() =>
                            void act("queueRun", {
                              procedureId: p.id,
                              modelId: p.modelId,
                              datasetId: p.datasetId,
                              profileId: p.profileId,
                            })
                              .then((r) => {
                                setSelected(undefined);
                                // Shows the queued run; opening the setup
                                // again would queue a duplicate.
                                if (r.details?.runId)
                                  onQueuedRun(p.id, r.details.runId);
                              })
                              .catch(() => {})
                          }
                        >
                          Queue planned evaluation
                        </Button>
                      )}
                      {reviewer &&
                        p.execution &&
                        !currentExecution(e, p) &&
                        p.execution.procedureRevision === p.revision && (
                          <Button
                            variant="outline"
                            disabled={busy || p.contributors.includes(uid)}
                            onClick={() =>
                              command(
                                "Review scope impact on previous execution",
                                "reaffirmExecution",
                                reason(),
                                { procedureId: p.id },
                              )
                            }
                          >
                            Assess scope impact
                          </Button>
                        )}
                    </div>
                    <p className="subtle workflow-note">
                      Approve scope and program before recording execution.
                      Automated methods require a completed evaluation using the
                      pinned model, dataset and protocol.
                    </p>
                  </TabsContent>
                  <TabsContent value="evaluate">
                    {p.execution?.assessment ? (
                      Object.entries({
                        relevance: p.execution.assessment.relevance,
                        reliability: p.execution.assessment.reliability,
                        coverage: p.execution.assessment.coverage,
                        contradictions: p.execution.assessment.contradictions,
                        conclusion: p.execution.assessment.conclusion,
                      }).map(([k, v]) => (
                        <section className="readable-section" key={k}>
                          <h3>{label(k)}</h3>
                          <p className="record-text">{v}</p>
                        </section>
                      ))
                    ) : (
                      <p className="empty-result">
                        Evaluate relevance, reliability, coverage and
                        contradictory evidence before reaching a conclusion.
                      </p>
                    )}
                    <div className="row-actions">
                      {writer && (
                        <Button
                          disabled={
                            busy ||
                            !p.execution ||
                            !currentExecution(e, p) ||
                            p.state === "submitted" ||
                            w.program.status !== "approved"
                          }
                          onClick={() => evaluate(p)}
                        >
                          Evaluate evidence
                        </Button>
                      )}
                      {writer && p.state === "evaluated" && (
                        <Button
                          variant="outline"
                          disabled={busy || !currentExecution(e, p)}
                          onClick={() =>
                            void act("submitProcedure", { procedureId: p.id })
                              .then(() => setSection("review"))
                              .catch(() => {})
                          }
                        >
                          Compile paper & send for review
                        </Button>
                      )}
                    </div>
                    {writer && p.execution && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          onContext(p.id);
                          setSelected(undefined);
                          onFinding(p);
                        }}
                      >
                        Prepare finding from this procedure
                      </Button>
                    )}
                    <p className="subtle workflow-note">
                      Compilation creates a working-paper revision from this
                      execution and your evaluation. Existing signed revisions
                      remain preserved.
                    </p>
                  </TabsContent>
                  <TabsContent value="review">
                    <ProcedureComparison
                      procedure={p}
                      userId={uid}
                      resolve={(id) =>
                        e.artifacts.find((a) => a.id === id)?.name ??
                        e.models.find((m) => m.id === id)?.name ??
                        e.evaluationProfiles?.find((a) => a.id === id)?.name ??
                        name(id)
                      }
                    />
                    <p>
                      Assigned reviewer: <b>{name(p.reviewerId)}</b>
                    </p>
                    {p.review && (
                      <div className="comment-box">
                        <b>Reviewed by {name(p.review.userId)}</b>
                        <p>{p.review.reason}</p>
                        <small>{new Date(p.review.at).toLocaleString()}</small>
                      </div>
                    )}
                    {p.paperId && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const q = e.papers.find((q) => q.id === p.paperId);
                          onContext(p.id);
                          setSelected(undefined);
                          if (q) onPaper(q);
                        }}
                      >
                        <FileText size={15} />
                        Open working paper, comments & sign-off
                      </Button>
                    )}
                    <div className="row-actions workflow-note">
                      {reviewer && p.state === "submitted" && (
                        <>
                          <Button
                            disabled={
                              busy ||
                              p.reviewerId !== uid ||
                              p.contributors.includes(uid)
                            }
                            onClick={() =>
                              command(
                                "Approve procedure revision",
                                "reviewProcedure",
                                reason(),
                                { procedureId: p.id },
                                "Approve procedure",
                              )
                            }
                          >
                            Approve reviewed work
                          </Button>
                          <Button
                            variant="outline"
                            disabled={
                              busy ||
                              p.reviewerId !== uid ||
                              p.contributors.includes(uid)
                            }
                            onClick={() =>
                              command(
                                "Return procedure for correction",
                                "returnProcedure",
                                reason(),
                                { procedureId: p.id },
                                "Request changes",
                              )
                            }
                          >
                            Request changes
                          </Button>
                        </>
                      )}
                      {lead &&
                        p.state === "reviewed" &&
                        e.papers.find((q) => q.id === p.paperId)?.status ===
                          "reviewed" && (
                          <Button
                            disabled={
                              busy ||
                              e.papers
                                .find((q) => q.id === p.paperId)
                                ?.reviews.some((r) => r.userId === uid)
                            }
                            onClick={() =>
                              void act("signPaper", {
                                paperId: p.paperId,
                              }).catch(() => {})
                            }
                          >
                            Sign working paper
                          </Button>
                        )}
                    </div>
                    <details className="provenance">
                      <summary>
                        Procedure revision history ({p.history.length})
                      </summary>
                      {p.history
                        .slice()
                        .reverse()
                        .map((h, i) => (
                          <div className="comment-box" key={i}>
                            <b>
                              Plan {h.revision} · execution{" "}
                              {h.execution?.revision ?? "not recorded"}
                            </b>
                            <p>{h.execution?.results ?? h.plan.rationale}</p>
                            <small>
                              {name(h.actor)} ·{" "}
                              {new Date(h.at).toLocaleString()}
                            </small>
                          </div>
                        ))}
                    </details>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </>
  );
}
export function ReportRelease({
  report: r,
  role,
  userId,
  busy,
  act,
  onEditing,
  reports,
}: {
  reports: Report[];
  report: Report;
  role: Role;
  userId: string;
  busy: boolean;
  act: WorkflowAct;
  onEditing: (v: boolean) => void;
}) {
  const [preview, setPreview] = useState(false),
    [form, setForm] = useState<Form | null>(null),
    state = releaseState(r),
    lead = role === "Lead Auditor",
    reviewer = ["Reviewer", "Lead Auditor"].includes(role);
  return (
    <section className="release-controls">
      <div className="panel-head">
        <h3>
          {r.kind === "draft" ? "Client preview" : "Approval & client release"}
        </h3>
        <span className="badge neutral">{packageStatusLabel(r)}</span>
      </div>
      <p className="subtle">
        {r.kind === "draft"
          ? "Drafts are internal review snapshots."
          : "Approve both package versions before client release."}
      </p>
      <div className="row-actions">
        <Button
          variant="outline"
          disabled={busy || !r.clientSnapshot}
          title={
            !r.clientSnapshot
              ? "No client projection was captured in this package"
              : undefined
          }
          onClick={() => setPreview(true)}
        >
          Preview exact client package
        </Button>
        {reviewer &&
          r.kind === "final" &&
          ["internal", "approved"].includes(state) && (
            <Button
              disabled={busy || r.actor === userId || !r.snapshot.workflow}
              title={
                !r.snapshot.workflow
                  ? "Prepare a current final package capturing the approved scope and program"
                  : undefined
              }
              onClick={() =>
                setForm({
                  title: "Approve both exact packages",
                  action: "Approve package",
                  fields: reason(),
                  description:
                    "Review the internal report and client preview before approving their captured digests.",
                  save: (v) =>
                    act("approveReportPackage", {
                      reportId: r.id,
                      internalHash: r.sha256,
                      clientHash: r.clientSha256,
                      ...v,
                    }),
                })
              }
            >
              Approve package
            </Button>
          )}
        {lead && state === "approved" && (
          <Button
            disabled={busy || r.release?.approval?.userId === userId}
            onClick={() =>
              setForm({
                title: "Authorize client release",
                action: "Release to client",
                description:
                  "This makes the captured client package visible to authorized Client Viewers and granted Client Contributors belonging to this engagement’s client.",
                fields: [
                  area(
                    "recipientScope",
                    "Recipient scope and authorized use",
                    "Authorized members of this engagement’s client",
                  ),
                  choice(
                    "supersedes",
                    "Replace a released report",
                    reports
                      .filter(
                        (q) => q.id !== r.id && releaseState(q) === "released",
                      )
                      .map((q) => ({
                        value: q.id,
                        label:
                          new Date(q.createdAt).toLocaleDateString() +
                          " · " +
                          String(q.snapshot.opinion),
                      })),
                    "",
                    true,
                  ),
                  ...reason(),
                ],
                save: (v) => act("releaseReport", { reportId: r.id, ...v }),
              })
            }
          >
            Release to client
          </Button>
        )}
        {lead && ["approved", "released"].includes(state) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setForm({
                title: "Withdraw report package",
                action: "Withdraw package",
                fields: reason(),
                save: (v) => act("withdrawReport", { reportId: r.id, ...v }),
              })
            }
          >
            Withdraw
          </Button>
        )}
      </div>
      {r.release?.approval && (
        <p className="subtle">
          Approved {new Date(r.release.approval.at).toLocaleString()} ·{" "}
          {r.release.approval.reason}
        </p>
      )}
      {r.release?.releasedAt && (
        <p className="subtle">
          Released {new Date(r.release.releasedAt).toLocaleString()} ·{" "}
          {r.release.recipientScope}
        </p>
      )}
      <details className="provenance">
        <summary>Release history and digests</summary>
        <p className="hash-text">Internal {r.sha256}</p>
        <p className="hash-text">
          Client {r.clientSha256 ?? "No projection captured"}
        </p>
        {r.release?.history.map((h, i) => (
          <p key={i}>
            {new Date(h.at).toLocaleString()} · {h.action} · {h.reason}
          </p>
        ))}
      </details>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="audit-dialog ml-dialog">
          <DialogHeader>
            <DialogTitle>Client package preview</DialogTitle>
            <DialogDescription>
              Exact captured projection · read only
            </DialogDescription>
          </DialogHeader>
          <FrozenReportDetails
            value={{ ...r, snapshot: r.clientSnapshot, sha256: r.clientSha256 }}
          />
        </DialogContent>
      </Dialog>
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </section>
  );
}
export function FindingAssurance({
  finding: f,
  engagement: e,
  role,
  userId,
  busy,
  act,
  onEditing,
}: {
  finding: Finding;
  engagement: Engagement;
  role: Role;
  userId: string;
  busy: boolean;
  act: WorkflowAct;
  onEditing: (v: boolean) => void;
}) {
  const [form, setForm] = useState<Form | null>(null),
    writer = ["Auditor", "Lead Auditor"].includes(role),
    reviewer = ["Reviewer", "Lead Auditor"].includes(role);
  return (
    <section className="release-controls">
      <h3>Support and independent retest</h3>
      {f.support && (
        <p>
          {f.support.evidenceIds.length} evidence files ·{" "}
          {f.support.paperIds.length} papers · {f.support.runIds.length}{" "}
          evaluations ·{" "}
          {e.workflow?.procedures.find((p) => p.id === f.support?.procedureId)
            ?.title ?? "No linked procedure"}
        </p>
      )}
      {f.retest && (
        <div className="comment-box">
          <b>{label(f.retest.conclusion)}</b>
          <p>{f.retest.performed}</p>
          <p>{f.retest.results}</p>
          <p>{f.retest.rationale}</p>
          <small>{new Date(f.retest.at).toLocaleString()}</small>
        </div>
      )}
      <div className="row-actions">
        {writer && f.status !== "closed" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setForm({
                title: "Link finding support",
                action: "Save support",
                fields: [
                  choice(
                    "procedureId",
                    "Originating procedure",
                    e.workflow?.procedures.map((p) => ({
                      value: p.id,
                      label: p.templateId + " · " + p.title,
                    })) ?? [],
                    f.support?.procedureId,
                    true,
                  ),
                  evidence(e, f.support?.evidenceIds),
                  {
                    name: "paperIds",
                    label: "Working papers",
                    type: "checklist",
                    ids: f.support?.paperIds,
                    options: e.papers.map((p) => ({
                      value: p.id,
                      label: p.title,
                    })),
                  },
                  {
                    name: "runIds",
                    label: "Evaluations",
                    type: "checklist",
                    ids: f.support?.runIds,
                    options: e.runs.map((r) => ({
                      value: r.id,
                      label: r.id + " · " + r.state,
                    })),
                  },
                ],
                save: (v) =>
                  act("linkFindingSupport", { findingId: f.id, ...v }),
              })
            }
          >
            Link support
          </Button>
        )}
        {reviewer && f.status === "ready_for_retest" && (
          <Button
            disabled={
              busy || f.createdBy === userId || f.remediationBy === userId
            }
            onClick={() =>
              setForm({
                title: "Record independent remediation retest",
                action: "Save retest assessment",
                fields: [
                  area(
                    "performed",
                    "Retest procedures actually performed",
                    f.retest?.performed,
                  ),
                  area("results", "Observed results", f.retest?.results),
                  area(
                    "rationale",
                    "Evidence assessment and conclusion rationale",
                    f.retest?.rationale,
                  ),
                  evidence(e, f.retest?.evidenceIds ?? f.retestEvidenceIds),
                  choice(
                    "conclusion",
                    "Remediation effectiveness",
                    options(["effective", "not_effective"]),
                    f.retest?.conclusion,
                  ),
                ],
                save: (v) =>
                  act("recordFindingRetest", { findingId: f.id, ...v }),
              })
            }
          >
            Record independent retest
          </Button>
        )}
        {reviewer &&
          f.status === "ready_for_retest" &&
          f.retest?.conclusion === "effective" && (
            <Button
              disabled={
                busy || f.createdBy === userId || f.remediationBy === userId
              }
              onClick={() =>
                void act("closeFinding", { findingId: f.id }).catch(() => {})
              }
            >
              Close verified finding
            </Button>
          )}
        {role === "Lead Auditor" && f.status === "closed" && (
          <Button
            variant="outline"
            onClick={() =>
              setForm({
                title: "Reopen closed finding",
                action: "Reopen finding",
                fields: reason(),
                save: (v) => act("reopenFinding", { findingId: f.id, ...v }),
              })
            }
          >
            Reopen finding
          </Button>
        )}
      </div>
      <WorkflowDialog
        form={form}
        onClose={() => setForm(null)}
        busy={busy}
        onEditing={onEditing}
      />
    </section>
  );
}
