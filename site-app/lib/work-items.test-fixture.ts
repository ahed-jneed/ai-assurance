/* eslint-disable @typescript-eslint/no-explicit-any -- the fixture is a partial engagement, as the workspace receives it. */
// The engagement the work-item tests share: one submitted procedure whose
// compiled paper is in review, prepared by "preparer" and assigned to
// "reviewer" (ported from scripts/work-items-check.mjs, #52).
export const at = "2026-10-10T09:00:00.000Z";
export const today = "2026-10-10";
export function fixture(): any {
  return {
    id: "engagement",
    title: "System assurance",
    clientId: "client",
    stage: "Fieldwork",
    dueDate: "2026-10-20",
    papers: [
      {
        id: "paper",
        templateId: "WP-10",
        title: "Data assurance",
        kind: "working_paper",
        stage: "Fieldwork",
        articleRefs: ["Art. 10"],
        required: true,
        revision: 2,
        authorId: "preparer",
        contributors: ["preparer"],
        updatedAt: at,
        status: "in_review",
        body: {
          results: "Checks performed",
          conclusion: "Supported by accepted records",
          conclusionStatus: "supported",
          criteria: "Data quality criteria",
        },
        evidenceIds: ["evidence"],
        runIds: [],
        comments: [],
        reviews: [],
        signatures: [],
        history: [],
      },
    ],
    artifacts: [
      { id: "evidence", name: "Validation record", status: "accepted" },
    ],
    evidenceRequests: [],
    findings: [],
    reports: [],
    runs: [],
    models: [],
    workflow: {
      adoptedBy: "preparer",
      brief: {
        revision: 2,
        status: "approved",
        contributors: ["preparer"],
        updatedBy: "preparer",
      },
      program: {
        revision: 3,
        briefRevision: 2,
        status: "approved",
        contributors: ["preparer"],
        updatedBy: "preparer",
      },
      procedures: [
        {
          id: "procedure",
          title: "Data assurance",
          templateId: "WP-10",
          selected: true,
          applicability: "applicable",
          stage: "Fieldwork",
          ownerId: "preparer",
          reviewerId: "reviewer",
          dueDate: "2026-10-09",
          revision: 4,
          contributors: ["preparer"],
          paperId: "paper",
          paperRevision: 2,
          state: "submitted",
          history: [],
          execution: {
            id: "execution",
            revision: 1,
            briefRevision: 2,
            programRevision: 3,
            procedureRevision: 4,
            evidenceIds: ["evidence"],
            assessment: {
              conclusion: "Supported",
              outcome: "supported",
              actor: "preparer",
              at,
            },
          },
        },
      ],
      monitoring: [],
    },
  };
}
