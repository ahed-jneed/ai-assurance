import { templateCriterion } from "./catalog-criteria";
import { displayRefs, type Resolved } from "./criteria/projection";
import type { Procedure, Workflow } from "./workflow-types";
/**
 * The initial workflow of an engagement on a criteria pack: one planned,
 * unselected procedure per working paper of the pack, in programme order
 * (docs/design/criteria-model.md section 7).
 */
export function seedWorkflow(
  resolved: Pick<Resolved, "pack" | "frameworks">,
  userId: string,
  at: string,
): Workflow {
  const { pack } = resolved;
  const editions = pack.criteria
    .filter((s) => s.role === "primary")
    .map((s) => s.edition)
    .join("; ");
  return {
    schemaVersion: "1.0",
    adoptedBy: userId,
    adoptedAt: at,
    // New workflows leave Planning only through the acceptance gate.
    acceptanceRequired: true,
    program: {
      revision: 1,
      briefRevision: 0,
      status: "draft",
      contributors: [userId],
      updatedBy: userId,
      updatedAt: at,
      history: [],
    },
    procedures: pack.items
      .filter((t) => t.kind === "working_paper")
      .map((t): Procedure => {
        const refs = displayRefs(resolved, t);
        return {
          id: "PROC-" + t.id,
          templateId: t.id,
          title: t.title,
          stage: t.stage,
          objective: t.objective,
          instructions: structuredClone(t.procedures),
          expectedEvidence: [...t.evidenceRequired],
          candidateRefs: refs,
          selected: false,
          applicability: "pending",
          rationale: "",
          criterion: templateCriterion({ ...t, regulatoryRefs: refs }),
          sourceVersion: refs.length ? editions : pack.methodologyVersion,
          periodAnalysis: "",
          population: "",
          sampling: "",
          ownerId: userId,
          reviewerId: "",
          dueDate: "",
          method: "manual",
          modelId: "",
          datasetId: "",
          profileId: "",
          revision: 1,
          contributors: [userId],
          updatedBy: userId,
          updatedAt: at,
          state: "planned",
          history: [],
        };
      }),
    clientGrants: [],
    submissions: [],
    monitoring: [],
  };
}
