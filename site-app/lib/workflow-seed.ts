import catalog from "./catalog.json";
import { templateCriterion } from "./catalog-criteria";
import type { Workflow } from "./workflow-types";
export function seedWorkflow(userId: string, at: string): Workflow {
  return {
    schemaVersion: "1.0",
    adoptedBy: userId,
    adoptedAt: at,
    program: {
      revision: 1,
      briefRevision: 0,
      status: "draft",
      contributors: [userId],
      updatedBy: userId,
      updatedAt: at,
      history: [],
    },
    procedures: catalog.items
      .filter((t) => t.kind === "working_paper")
      .map((t) => ({
        id: "PROC-" + t.id,
        templateId: t.id,
        title: t.title,
        stage: t.stage,
        objective: t.objective,
        instructions: structuredClone(t.procedures),
        expectedEvidence: [...t.evidenceRequired],
        candidateRefs: [...t.regulatoryRefs],
        selected: false,
        applicability: "pending",
        rationale: "",
        criterion: templateCriterion(t),
        sourceVersion: t.regulatoryRefs.length
          ? catalog.regulatorySnapshot.celex
          : catalog.methodologyVersion,
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
      })),
    clientGrants: [],
    submissions: [],
    monitoring: [],
  };
}
