// The audit program's forms: each opens the workflow dialog for one command.
import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceData } from "../workspace-types";
import {
  isReleaseTimeRecord,
  releaseTimeAssignmentNote,
} from "@/lib/domain/gates";
import { opinionLabel } from "@/lib/domain/report-model";
import type { PaperSuggestion } from "@/lib/domain/art50-papers";
import type {
  BriefFields,
  Procedure,
  ProcedurePlan,
} from "@/lib/workflow-types";
import {
  procedureDraftRevision,
  runBindsProcedure,
} from "@/lib/workflow-state";
import { canBeAssigned, type Assignment } from "@/lib/permissions";
import type { DraftScope } from "../recoverable-draft";
import { area, choice, evidence, options } from "./fields";
import type { Field, Form, WorkflowAct } from "./workflow-dialog";
export type ProgramForms = ReturnType<typeof programForms>;
/** The form openers of the audit program, for the engagement in `data`. */
export function programForms({
  data,
  act,
  setForm,
  batchIds,
  setBatchIds,
}: {
  data: WorkspaceData;
  act: WorkflowAct;
  setForm: Dispatch<SetStateAction<Form | null>>;
  /** The procedures selected for bulk assignment. */
  batchIds: string[];
  setBatchIds: Dispatch<SetStateAction<string[]>>;
}) {
  const e = data.engagement!,
    w = e.workflow,
    uid = data.identity.id;
  const people = (assignment: Assignment) =>
    data.people
      .filter((m) => m.status === "active" && canBeAssigned(m.role, assignment))
      .map((m) => ({
        value: m.user_id,
        label: m.display_name + " · " + m.role,
      }));
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
          : procedureDraftRevision(w!, p!, kind),
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
    const labels: Record<Exclude<keyof BriefFields, "independence">, string> = {
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
      // Competence and independence are declared per person in the
      // acceptance panel; the brief no longer records them as free text.
      save: (v) =>
        act("saveBrief", { ...v, independence: b?.independence ?? "" }),
    });
  }
  function planForm(p: Procedure, suggestion?: PaperSuggestion) {
    // A release-time record needs no assignment, deadline, population or
    // sampling: the release records it against the final package.
    const releaseTime = isReleaseTimeRecord(p.templateId);
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
        suggestion?.applicability ?? p.applicability,
      ),
      area(
        "rationale",
        "Applicability and selection rationale",
        suggestion
          ? [suggestion.rationale, p.rationale].filter(Boolean).join("\n\n")
          : p.rationale,
      ),
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
      area("population", "Population and scope", p.population, releaseTime),
      area(
        "sampling",
        "Sampling approach and rationale",
        p.sampling,
        releaseTime,
      ),
      choice("ownerId", "Preparer", people("preparer"), p.ownerId, releaseTime),
      choice(
        "reviewerId",
        "Independent reviewer",
        // Saving makes you a contributor, so you cannot review it either.
        people("reviewer").filter(
          (x) =>
            x.value !== p.ownerId &&
            x.value !== uid &&
            !p.contributors.includes(x.value),
        ),
        p.reviewerId,
        releaseTime,
      ),
      {
        name: "dueDate",
        label: "Due date",
        type: "date",
        value: p.dueDate,
        optional: releaseTime,
      },
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
      description:
        (suggestion
          ? "The applicability and a rationale are filled in from the classification's suggestion; review them, then save or cancel. "
          : "") +
        (releaseTime ? releaseTimeAssignmentNote + ". " : "") +
        "Changing what this procedure tests or how returns an approved program to draft and requires this procedure's work to be performed again. Preparer, reviewer and due-date changes keep the program approval and recorded work.",
      fields,
      save: (v) =>
        act("saveProcedurePlan", {
          procedureId: p.id,
          // The assignment this form shows: a save read before another
          // change to it is refused instead of reverting that change.
          assignmentRevision: p.assignmentRevision ?? 1,
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
              (r) => r.state === "succeeded" && runBindsProcedure(e, p, r),
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
      action: "Save assignments",
      description:
        "Only the fields you choose will change. The program approval and recorded work stay valid; reviewed work keeps its reviewer.",
      fields: [
        choice("ownerId", "Preparer", people("preparer"), "", true),
        choice(
          "reviewerId",
          "Independent reviewer",
          people("reviewer").filter((x) => x.value !== uid),
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
        choice("ownerId", "Responsible auditor", people("preparer")),
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
                opinionLabel(r.snapshot),
            })),
          "",
          true,
        ),
      ],
      {},
      "Create case",
    );
  }
  return {
    command,
    brief,
    planForm,
    execute,
    evaluate,
    bulk,
    staffing,
    monitoring,
  };
}
