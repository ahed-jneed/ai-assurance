// The acceptance panel's forms: each opens the workflow dialog for one
// acceptance or independence command.
import type { Engagement } from "@/lib/domain/types";
import { canBeAssigned } from "@/lib/permissions";
import {
  currentDeclaration,
  declaredConflict,
  latestDeclaration,
} from "@/lib/workflow/acceptance";
import {
  acceptancePreconditions,
  accessLevels,
  competenceAreas,
  competenceLevels,
  exclusionKinds,
  threatKinds,
  type Declaration,
  type ExclusionKind,
  type ThreatKind,
} from "@/lib/workflow-types";
import type { WorkspaceData } from "../workspace-types";
import {
  accessLabels,
  areaLabels,
  exclusionLabels,
  preconditionLabels,
  threatHints,
  threatLabels,
  yesNo,
} from "./acceptance-labels";
import type { Field, Form, WorkflowAct } from "./workflow-dialog";

/** How the team checklist marks a person the server refuses to assign. */
export const conflictMarks = {
  excluded: "Cannot be assigned: declared a disqualifying relationship",
  threat: "Cannot be assigned: unresolved independence threat",
} as const;

/** The form openers of the acceptance panel, for the engagement in `data`. */
export function acceptanceForms({
  data,
  act,
  onForm,
  name,
}: {
  data: WorkspaceData;
  act: WorkflowAct;
  onForm: (form: Form) => void;
  /** The display name of a member. */
  name: (id: string) => string;
}) {
  const e = data.engagement as Engagement,
    w = e.workflow!,
    a = w.acceptance,
    uid = data.identity.id;

  function acceptanceForm() {
    const b = w.brief,
      people = data.people
        .filter((m) => m.status === "active" && canBeAssigned(m.role, "team"))
        .map((m) => {
          // Mark whom the server would refuse to put on the team, and why.
          const conflict = declaredConflict(w, m.user_id);
          return {
            value: m.user_id,
            label:
              m.display_name +
              " · " +
              m.role +
              (conflict ? " · " + conflictMarks[conflict] : ""),
          };
        });
    const fields: Field[] = [
      {
        name: "decision",
        label: "Decision",
        type: "select",
        value: a?.decision ?? "acceptance",
        options: [
          { value: "acceptance", label: "Acceptance of a new engagement" },
          { value: "continuance", label: "Continuance of an engagement" },
        ],
      },
      ...acceptancePreconditions.flatMap((k): Field[] => [
        {
          name: "met." + k,
          label: "Precondition: " + preconditionLabels[k],
          type: "select",
          options: yesNo,
          value: a ? String(a.preconditions[k].met) : "",
        },
        {
          name: "basis." + k,
          label: "Basis for that view",
          type: "area",
          value: a?.preconditions[k].basis ?? "",
        },
      ]),
      {
        name: "scope",
        label: "Engagement scope",
        type: "area",
        value: a?.scope ?? "",
      },
      {
        name: "periodStart",
        label: "Period from",
        type: "date",
        value: a?.periodStart ?? b?.periodStart ?? "",
      },
      {
        name: "periodEnd",
        label: "Period to",
        type: "date",
        value: a?.periodEnd ?? b?.periodEnd ?? "",
      },
      {
        name: "systemBoundary",
        label: "System boundary",
        type: "area",
        value: a?.systemBoundary ?? b?.boundary ?? "",
      },
      {
        name: "accessLevel",
        label: "Access level",
        type: "select",
        value: a?.accessLevel ?? "",
        options: accessLevels.map((v) => ({
          value: v,
          label: accessLabels[v],
        })),
      },
      {
        name: "engagementLetter",
        label: "Engagement letter reference",
        type: "text",
        value: a?.engagementLetter ?? "",
      },
      {
        name: "team",
        label: "Engagement team",
        type: "checklist",
        options: people,
        ids: a?.team ?? [uid],
        hint: "Preparers and reviewers of selected procedures join the team automatically. Everyone on it declares independence and competence.",
      },
      {
        name: "competenceConclusion",
        label: "Conclusion on the team's collective competence",
        type: "area",
        value: a?.competenceConclusion ?? "",
      },
      ...(a?.status === "approved"
        ? [
            {
              name: "changeReason",
              label: "Why the approved record changes",
              type: "area" as const,
            },
          ]
        : []),
    ];
    onForm({
      title: a ? "Revise acceptance and continuance" : "Record acceptance",
      action: "Save acceptance draft",
      description:
        "Record the ISAE 3000 preconditions and the engagement terms. A Lead Auditor approves the record before fieldwork starts.",
      fields,
      save: (v) =>
        act("saveAcceptance", {
          decision: v.decision,
          preconditions: Object.fromEntries(
            acceptancePreconditions.map((k) => [
              k,
              { met: v["met." + k] === "true", basis: v["basis." + k] },
            ]),
          ),
          scope: v.scope,
          periodStart: v.periodStart,
          periodEnd: v.periodEnd,
          systemBoundary: v.systemBoundary,
          accessLevel: v.accessLevel,
          engagementLetter: v.engagementLetter,
          team: v.team,
          competenceConclusion: v.competenceConclusion,
          changeReason: v.changeReason ?? "",
        }),
    });
  }

  function declarationForm() {
    const d = currentDeclaration(w, uid),
      latest = latestDeclaration(w, uid);
    const threat = (k: ThreatKind) => d?.threats.find((t) => t.kind === k);
    const fields: Field[] = [
      {
        name: "priorWork",
        label:
          "Earlier implementation or governance work on this system (leave empty if none)",
        type: "area",
        value: d?.priorWork ?? "",
        optional: true,
        hint: "Such work creates a self-review threat: declare it below.",
      },
      ...threatKinds.flatMap((k): Field[] => [
        {
          name: "threat." + k,
          label: threatLabels[k] + " threat",
          type: "select",
          value: threat(k) ? "present" : "none",
          options: [
            { value: "none", label: "None identified" },
            { value: "present", label: "Present" },
          ],
          hint: threatHints[k],
        },
        {
          name: "description." + k,
          label: threatLabels[k] + ": circumstances",
          type: "area",
          value: threat(k)?.description ?? "",
          optional: true,
        },
        {
          name: "safeguards." + k,
          label: threatLabels[k] + ": safeguards proposed",
          type: "area",
          value: threat(k)?.safeguards ?? "",
          optional: true,
        },
      ]),
      {
        name: "exclusions",
        label: "Disqualifying relationships",
        type: "checklist",
        options: exclusionKinds.map((k) => ({
          value: k,
          label: exclusionLabels[k],
        })),
        // Relationships stand across periods: start from the latest
        // declaration in any period, which holds the ones not withdrawn.
        ids: latest?.exclusions ?? [],
        hint: "Modelled on the NYC Local Law 144 independent-auditor exclusions and applied to every engagement; pending legal review. No safeguard resolves them, and a renewal cannot remove one: a Lead Auditor or Reviewer other than you withdraws a relationship declared in error. A renewal also keeps every threat nobody has resolved.",
      },
      ...competenceAreas.map((k): Field => ({
        name: "competence." + k,
        label: "Competence: " + areaLabels[k],
        type: "select",
        value: d?.competence[k] ?? "",
        options: competenceLevels.map((l) => ({
          value: l,
          label: l[0].toUpperCase() + l.slice(1),
        })),
      })),
      {
        name: "expertField",
        label:
          "Field in which you act as practitioner's expert (leave empty if not)",
        type: "text",
        value: d?.expertField ?? "",
        optional: true,
      },
      {
        name: "confirmed",
        label: "Confirmation",
        type: "checklist",
        options: [
          {
            value: "yes",
            label:
              "This declaration is complete and accurate for the engagement period",
          },
        ],
      },
    ];
    onForm({
      title: d ? "Renew your declaration" : "Declare independence",
      action: "Sign declaration",
      description:
        "Your declaration is dated and covers this engagement period. Renew it whenever the engagement team changes.",
      fields,
      save: async (v) => {
        if (!(v.confirmed as string[]).includes("yes"))
          throw new Error("Confirm the declaration before signing it");
        return act("saveDeclaration", {
          priorWork: v.priorWork,
          threats: threatKinds
            .filter((k) => v["threat." + k] === "present")
            .map((k) => ({
              kind: k,
              description: v["description." + k],
              safeguards: v["safeguards." + k],
            })),
          exclusions: v.exclusions,
          competence: Object.fromEntries(
            competenceAreas.map((k) => [k, v["competence." + k]]),
          ),
          expertField: v.expertField,
          confirmed: true,
        });
      },
    });
  }

  function resolveForm(d: Declaration, kind: ThreatKind) {
    onForm({
      title: "Resolve " + threatLabels[kind].toLowerCase() + " threat",
      action: "Record evaluation",
      description:
        "Evaluate whether the safeguards reduce the threat to an acceptable level for " +
        name(d.userId) +
        ". If they do not, remove the person from the team instead.",
      fields: [
        {
          name: "reason",
          label: "Evaluation of the threat and its safeguards",
          type: "area",
        },
      ],
      save: (v) =>
        act("resolveDeclaredThreat", {
          declarationId: d.id,
          kind,
          reason: v.reason,
        }),
    });
  }

  function withdrawForm(d: Declaration, kind: ExclusionKind) {
    onForm({
      title: "Withdraw a disqualifying relationship",
      action: "Withdraw relationship",
      description:
        name(d.userId) +
        " declared: " +
        exclusionLabels[kind] +
        ". Withdraw it only if it was declared in error or does not exist; no safeguard resolves it.",
      fields: [
        {
          name: "reason",
          label: "Why the relationship does not exist",
          type: "area",
        },
      ],
      save: (v) =>
        act("withdrawDeclaredExclusion", {
          declarationId: d.id,
          kind,
          reason: v.reason,
        }),
    });
  }

  function approveForm() {
    onForm({
      title: "Approve acceptance revision " + a!.revision,
      action: "Accept engagement",
      description:
        "Approving accepts the engagement on these terms. A declared threat that nobody resolved blocks acceptance.",
      fields: [
        {
          name: "reason",
          label: "Acceptance decision and rationale",
          type: "area",
        },
      ],
      save: (v) =>
        act("approveAcceptance", { revision: a!.revision, reason: v.reason }),
    });
  }

  return {
    acceptanceForm,
    declarationForm,
    resolveForm,
    withdrawForm,
    approveForm,
  };
}
