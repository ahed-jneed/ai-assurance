import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Engagement, EvidenceRequest, Finding, Paper } from "@/lib/domain";
import type { Procedure } from "@/lib/workflow-types";
import type { WorkspaceData } from "../../workspace-types";

const gates = vi.hoisted(() => ({ open: [] as unknown[] }));
vi.mock("@/lib/domain", async (original) => ({
  ...(await original<typeof import("@/lib/domain")>()),
  finalReportGates: () => gates.open,
}));

import { classificationDefaults } from "./classification";
import { classificationPayload, formRules } from "./classification-form";
import { requestFormDefaults } from "./evidence-request";
import { procedureFindingDefaults } from "./finding";
import { remediationDefaults } from "./finding-edit";
import { modalDefinition, modalKinds } from "./index";
import type { ModalFieldsProps, ModalSubmitContext } from "./types";

const draftPaper = {
    id: "p1",
    status: "draft",
    evidenceIds: ["a0"],
    body: { results: "" },
  },
  signedPaper = { id: "p2", status: "signed", evidenceIds: [], body: {} };
const engagement = {
  id: "e1",
  papers: [draftPaper, signedPaper],
  artifacts: [{ id: "a0" }, { id: "a1" }],
  evidenceRequests: [
    {
      id: "q1",
      paperIds: ["p1"],
      evidenceIds: ["a1"],
      deliveryComplete: false,
    },
  ],
  classification: {
    operatorRole: "Deployer",
    annexRoute: "Article 50 only",
    prohibited: false,
    highRisk: true,
    transparency: true,
    profiling: false,
    answers: {
      deployerGeneratesDeepFakes: { value: true },
      deployerUsesEmotionRecognition: { value: false },
      smeStatus: { value: "sme" },
      placedOnMarketDate: { value: "2026-05-01" },
    },
  },
} as unknown as Engagement;
const data = {
  tenantId: "t1",
  engagement,
} as unknown as WorkspaceData;

function context(
  kind: string,
  over: Partial<ModalSubmitContext> = {},
): ModalSubmitContext {
  return {
    kind,
    form: {} as HTMLFormElement,
    values: {},
    choices: {},
    checks: {},
    finding: null,
    data,
    engagement,
    act: vi.fn(async () => ({ engagement })),
    manage: vi.fn(async () => ({ details: {} as Record<string, string> })),
    load: vi.fn(async () => null),
    setBusy: vi.fn(),
    followUps: {
      showCreatedPaper: vi.fn(),
      openPaperWithEvidence: vi.fn(() => true),
      showClient: vi.fn(),
      showEngagementOverview: vi.fn(),
    },
    ...over,
  };
}
const validate = (kind: string, over: Partial<ModalSubmitContext> = {}) =>
  modalDefinition(kind)!.validate?.(context(kind, over));
const submit = (kind: string, ctx: ModalSubmitContext) =>
  modalDefinition(kind)!.submit?.(ctx);
beforeEach(() => {
  gates.open = [];
});

describe("modal definitions", () => {
  it("titles and labels every form", () => {
    expect(
      Object.fromEntries(
        modalKinds.map((kind) => [
          kind,
          [modalDefinition(kind)!.title, modalDefinition(kind)!.submitLabel],
        ]),
      ),
    ).toEqual({
      paper: ["New working paper or memo", "Create paper"],
      linkEvidence: ["Link evidence to a paper", "Open paper"],
      client: ["New client", "Create client"],
      clientEdit: ["Edit client", "Save client details"],
      engagement: ["New engagement", "Create engagement"],
      rename: ["Engagement settings", "Save engagement"],
      member: ["Add member", "Add member"],
      memberEdit: ["Edit access", "Update access"],
      memberRevoke: ["Revoke practice access", "Revoke access"],
      invite: ["Invite by email", "Save invitation"],
      invitationCancel: ["Cancel invitation", "Cancel invitation"],
      practiceRename: ["Rename practice", "Save name"],
      adminGrant: ["Grant practice administration", "Grant administration"],
      adminRevoke: ["Remove practice administration", "Remove administration"],
      adminTransfer: [
        "Transfer practice administration",
        "Transfer administration",
      ],
      upload: ["Upload evidence", "Upload for acceptance"],
      classification: [
        "Guided regulatory classification",
        "Save classification",
      ],
      finding: ["Record audit finding", "Record finding"],
      findingEdit: ["Remediation & retest", "Save remediation"],
      report: ["Create immutable report snapshot", "Create snapshot"],
      request: ["Request evidence", "Create request"],
      requestEdit: ["Edit evidence request", "Save request"],
      requestResponse: ["Record received evidence", "Record receipt"],
      requestAssess: ["Assess evidence", "Record assessment"],
      requestClose: [
        "Record limitation / scope change",
        "Record disposition & draft memo",
      ],
      requestReopen: ["Reopen evidence request", "Reopen request"],
    });
  });

  it("has no definition for unknown or inherited names", () => {
    expect(modalDefinition("")).toBeUndefined();
    expect(modalDefinition("toString")).toBeUndefined();
  });

  it("reports only upload failures to the workspace", () => {
    expect(
      modalKinds.filter((kind) => modalDefinition(kind)!.reportsToWorkspace),
    ).toEqual(["upload"]);
  });
});

describe("form validation", () => {
  it("requires the choices each form depends on", () => {
    expect(() => validate("paper")).toThrow(
      "Choose a methodology template before creating the paper.",
    );
    expect(() => validate("engagement")).toThrow(
      "Choose a client for this engagement.",
    );
    expect(() => validate("requestAssess")).toThrow(
      "Choose whether evidence is sufficient or needs follow-up.",
    );
    expect(() => validate("requestClose")).toThrow(
      "Choose the reason for closing this request.",
    );
    expect(() =>
      validate("paper", { choices: { templateId: "WP-1" } }),
    ).not.toThrow();
  });

  it("requires a linked paper for new and edited requests", () => {
    for (const kind of ["request", "requestEdit"]) {
      expect(() => validate(kind)).toThrow(
        "Link at least one working paper supported by this request.",
      );
      expect(() =>
        validate(kind, { checks: { "paper:p1": true } }),
      ).not.toThrow();
    }
  });

  it("checks a receipt's delivery state before its files", () => {
    expect(() =>
      validate("requestResponse", { checks: { "evidence:a1": true } }),
    ).toThrow("Record whether the delivery is complete or partial.");
    expect(() =>
      validate("requestResponse", { choices: { deliveryComplete: "true" } }),
    ).toThrow(
      "Select the received evidence files. Upload them in the vault first if needed.",
    );
  });

  it("asks members for a role, and client roles for a client", () => {
    expect(() => validate("member")).toThrow("Choose a role for this member.");
    expect(() =>
      validate("memberEdit", { choices: { role: "Client Viewer" } }),
    ).toThrow("Choose the client this viewer can access.");
    expect(() =>
      validate("member", { choices: { role: "Auditor" } }),
    ).not.toThrow();
  });

  it("refuses a final report while completion gates are open", () => {
    gates.open = [{ message: "Open" }];
    const fields = (kind: string) =>
      ({ choices: { kind }, engagement }) as unknown as ModalFieldsProps;
    expect(modalDefinition("report")!.blocked!(fields("final"))).toBe(true);
    expect(modalDefinition("report")!.blocked!(fields("draft"))).toBe(false);
    expect(() => validate("report", { choices: { kind: "final" } })).toThrow(
      "Resolve the final-report requirements or choose a draft snapshot.",
    );
    expect(() =>
      validate("report", { choices: { kind: "draft" } }),
    ).not.toThrow();
    gates.open = [];
    expect(() =>
      validate("report", { choices: { kind: "final" } }),
    ).not.toThrow();
  });
});

describe("form submission", () => {
  it("sends request payloads with the linked papers and files", async () => {
    const request = context("requestEdit", {
      choices: { requestId: "q1" },
      checks: { "paper:p1": true, "paper:p2": false },
      values: { subject: "Model card", dueDate: "2026-12-01" },
    });
    await submit("requestEdit", request);
    expect(request.act).toHaveBeenCalledWith("updateEvidenceRequest", {
      requestId: "q1",
      subject: "Model card",
      description: undefined,
      responsibleParty: undefined,
      periodVersion: undefined,
      handling: undefined,
      dueDate: "2026-12-01",
      paperIds: ["p1"],
    });
    const receipt = context("requestResponse", {
      choices: { requestId: "q1", deliveryComplete: "false" },
      checks: { "evidence:a1": true },
      values: { response: "Sent", remainingItems: "Log" },
    });
    await submit("requestResponse", receipt);
    expect(receipt.act).toHaveBeenCalledWith("recordEvidenceResponse", {
      requestId: "q1",
      response: "Sent",
      deliveryComplete: false,
      remainingItems: "Log",
      evidenceIds: ["a1"],
    });
  });

  it("grants and updates member access", async () => {
    const grant = context("member", {
      choices: { role: "Auditor" },
      values: { userId: "u9", displayName: "Avery" },
    });
    await submit("member", grant);
    expect(grant.manage).toHaveBeenCalledWith("grantMember", {
      userId: "u9",
      displayName: "Avery",
      role: "Auditor",
      clientId: null,
      engagementIds: [],
    });
    const update = context("memberEdit", {
      choices: {
        userId: "u9",
        role: "Client Viewer",
        originalRole: "Auditor",
        clientId: "c1",
      },
      values: { displayName: "Avery" },
    });
    await submit("memberEdit", update);
    expect(update.manage).toHaveBeenCalledWith("updateMember", {
      userId: "u9",
      displayName: "Avery",
      role: "Client Viewer",
      clientId: "c1",
    });
  });

  // F-24: a restore or a role change lists the engagements explicitly; an
  // edit of the name alone sends none, so grants are kept.
  it("lists engagements only when access starts afresh", async () => {
    const restore = context("member", {
      choices: { userId: "u9", role: "Reviewer" },
      checks: { "engagement:e1": true, "engagement:e2": false },
      values: { displayName: "Avery" },
    });
    await submit("member", restore);
    expect(restore.manage).toHaveBeenCalledWith("grantMember", {
      userId: "u9",
      displayName: "Avery",
      role: "Reviewer",
      clientId: null,
      engagementIds: ["e1"],
    });
    const rename = context("memberEdit", {
      choices: { userId: "u9", role: "Auditor", originalRole: "Auditor" },
      checks: { "engagement:e1": true },
      values: { displayName: "Avery B." },
    });
    await submit("memberEdit", rename);
    expect(rename.manage).toHaveBeenCalledWith("updateMember", {
      userId: "u9",
      displayName: "Avery B.",
      role: "Auditor",
      clientId: null,
    });
    const promote = context("memberEdit", {
      choices: { userId: "u9", role: "Reviewer", originalRole: "Auditor" },
      checks: {},
      values: { displayName: "Avery" },
    });
    await submit("memberEdit", promote);
    expect(promote.manage).toHaveBeenCalledWith("updateMember", {
      userId: "u9",
      displayName: "Avery",
      role: "Reviewer",
      clientId: null,
      engagementIds: [],
    });
  });

  it("invites by email with the role's scope", async () => {
    const internal = context("invite", {
      choices: { role: "Auditor" },
      checks: { "engagement:e1": true },
      values: { email: "nia@example.test", displayName: " " },
    });
    await submit("invite", internal);
    expect(internal.manage).toHaveBeenCalledWith("inviteMember", {
      email: "nia@example.test",
      role: "Auditor",
      engagementIds: ["e1"],
    });
    const viewer = context("invite", {
      choices: { role: "Client Viewer", clientId: "c1" },
      values: { email: "v@example.test", displayName: "Vic" },
    });
    await submit("invite", viewer);
    expect(viewer.manage).toHaveBeenCalledWith("inviteMember", {
      email: "v@example.test",
      displayName: "Vic",
      role: "Client Viewer",
      clientId: "c1",
    });
    expect(() =>
      validate("invite", { choices: { role: "Client Viewer" } }),
    ).toThrow("Choose the client this person belongs to.");
  });

  it("opens a created paper and a created engagement", async () => {
    const created = { id: "p3" };
    const paper = context("paper", {
      choices: { templateId: "WP-1" },
      act: vi.fn(async () => ({
        engagement: { ...engagement, papers: [created] } as Engagement,
        details: { paperId: "p3" },
      })),
    });
    await submit("paper", paper);
    expect(paper.act).toHaveBeenCalledWith("createPaper", {
      templateId: "WP-1",
    });
    expect(paper.followUps.showCreatedPaper).toHaveBeenCalledWith(created);

    const opened = context("engagement", {
      choices: { clientId: "c1" },
      values: { title: "FY27 audit" },
      manage: vi.fn(async () => ({ details: { engagementId: "e2" } })),
    });
    await submit("engagement", opened);
    expect(opened.load).toHaveBeenCalledWith("t1", "e2");
    expect(opened.followUps.showEngagementOverview).toHaveBeenCalled();
  });

  it("opens the linked paper as an unsaved edit, or stays open", () => {
    const allowed = context("linkEvidence", {
      choices: { paperId: "p1", artifactId: "a1" },
    });
    expect(submit("linkEvidence", allowed)).toBeUndefined();
    const [paper, draft] = vi.mocked(allowed.followUps.openPaperWithEvidence)
      .mock.calls[0] as [Paper, Paper];
    expect(paper).toBe(draftPaper);
    expect(draft.evidenceIds).toEqual(["a0", "a1"]);
    expect(draftPaper.evidenceIds).toEqual(["a0"]);

    const refused = context("linkEvidence", {
      choices: { paperId: "p1", artifactId: "a0" },
    });
    vi.mocked(refused.followUps.openPaperWithEvidence).mockReturnValue(false);
    expect(submit("linkEvidence", refused)).toBe("keep-open");
    expect(
      vi.mocked(refused.followUps.openPaperWithEvidence).mock.calls[0][1]
        .evidenceIds,
    ).toEqual(["a0"]);

    expect(() =>
      submit(
        "linkEvidence",
        context("linkEvidence", { choices: { paperId: "p2" } }),
      ),
    ).toThrow("Choose an unsigned paper");
  });

  it("saves a remediation only for an open finding", async () => {
    const none = context("findingEdit");
    expect(submit("findingEdit", none)).toBeUndefined();
    expect(none.act).not.toHaveBeenCalled();
  });
});

describe("form defaults", () => {
  it("opens request forms from the current request or a paper", () => {
    const stale = { id: "q1", paperIds: [], evidenceIds: [] };
    expect(
      requestFormDefaults(engagement, stale as unknown as EvidenceRequest),
    ).toEqual({
      choices: {
        requestId: "q1",
        decision: "",
        disposition: "",
        deliveryComplete: "false",
      },
      checks: { "paper:p1": true, "evidence:a1": true },
    });
    expect(
      requestFormDefaults(
        engagement,
        undefined,
        draftPaper as unknown as Paper,
      ),
    ).toEqual({
      choices: {
        requestId: "",
        decision: "",
        disposition: "",
        deliveryComplete: "",
      },
      checks: { "paper:p1": true },
    });
  });

  it("opens a remediation from the finding's status and retest files", () => {
    expect(
      remediationDefaults({
        status: "open",
        retestEvidenceIds: ["a1"],
      } as unknown as Finding),
    ).toEqual({ choices: { status: "in_progress" }, checks: { a1: true } });
    expect(
      remediationDefaults({
        status: "remediated",
        retestEvidenceIds: [],
      } as unknown as Finding).choices.status,
    ).toBe("remediated");
  });

  it("opens the classification from the engagement's current one", () => {
    // Tri-state answers open as choices; dates are named fields.
    expect(classificationDefaults(engagement)).toEqual({
      choices: {
        operatorRole: "Deployer",
        annexRoute: "Article 50 only",
        "fact:deployerGeneratesDeepFakes": "yes",
        "fact:deployerUsesEmotionRecognition": "no",
        "fact:smeStatus": "sme",
      },
      checks: {},
    });
    expect(classificationDefaults(undefined)).toEqual({
      choices: { operatorRole: "Provider", annexRoute: "Unassessed" },
      checks: {},
    });
    // A free-text route from before #19 opens as Unassessed.
    expect(
      classificationDefaults({
        ...engagement,
        classification: {
          ...engagement.classification,
          annexRoute: "Annex III point 5(b)",
        },
      }).choices.annexRoute,
    ).toBe("Unassessed");
  });

  it("submits only the facts the form asks for the role and answers", () => {
    const rules = formRules(null);
    const payload = classificationPayload(
      rules,
      {
        operatorRole: "Deployer",
        annexRoute: "Article 50 only",
        "fact:deployerGeneratesDeepFakes": "yes",
        "fact:personalNonProfessionalUseOnly": "yes",
        // A provider fact left over from an earlier role is not sent.
        "fact:interactsDirectlyWithNaturalPersons": "yes",
        // Hidden while emotion recognition is answered no.
        "fact:lawEnforcementPermittedErBc": "yes",
        "fact:deployerUsesEmotionRecognition": "no",
      },
      {
        intendedPurpose: "Marketing videos",
        rationale: "Deep fakes in campaigns",
        "evidence:personalNonProfessionalUseOnly": "EV-2",
        "date:placedOnMarketDate": "2026-05-01",
      },
    );
    expect(payload).toMatchObject({
      operatorRole: "Deployer",
      annexRoute: "Article 50 only",
      evidence: { personalNonProfessionalUseOnly: "EV-2" },
    });
    expect(payload.facts).toMatchObject({
      deployerGeneratesDeepFakes: "yes",
      deployerUsesEmotionRecognition: "no",
      deployerUsesBiometricCategorisation: "unknown",
      placedOnMarketDate: "2026-05-01",
      putIntoServiceDate: "",
      smeStatus: "unknown",
    });
    expect(payload.facts).not.toHaveProperty(
      "interactsDirectlyWithNaturalPersons",
    );
    expect(payload.facts).not.toHaveProperty("lawEnforcementPermittedErBc");
    expect(payload.derogation).toBeUndefined();
  });

  it("prefills a procedure exception's finding", () => {
    const procedure = {
      id: "pr1",
      title: "Bias test",
      criterion: "Parity within 0.1",
      candidateRefs: ["ISO 42001 8.2", "Article 15(1)"],
      execution: { results: "Gap 0.2" },
    } as unknown as Procedure;
    expect(procedureFindingDefaults(procedure)).toEqual({
      procedureId: "pr1",
      title: "Bias test — exception",
      condition: "Gap 0.2",
      criteria: "Parity within 0.1",
      article: "15",
      likelihood: "3",
      impact: "3",
      visibility: "internal",
    });
    expect(
      procedureFindingDefaults({
        ...procedure,
        candidateRefs: [],
        execution: undefined,
      } as unknown as Procedure),
    ).toMatchObject({ article: "10", condition: "" });
  });
});
