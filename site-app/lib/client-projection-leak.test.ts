// No client projection carries a staff user id or an email (#201 item 1).
// The engagement is seeded through the real workflow, request, paper and
// report commands, so every place the audit team leaves its user id (papers,
// reviews, signatures, procedures, approvals, findings, evidence, the
// classification, client request grants, clarifications, receipts, report
// releases) is filled. Every staff id is then renamed to a distinctive token
// and each client projection is serialised and searched for them, so a field
// added later that carries a staff id fails here without being named.
import { describe, expect, it, vi } from "vitest";
import {
  clientArtifact,
  clientClassification,
  clientFinding,
  clientMessage,
  clientNotification,
  clientPaper,
  clientRecords,
  clientReportSnapshot,
  clientScope,
  clientSubmission,
  sanitize,
} from "./client-projection";
import { reports } from "./commands/reports";
import { caller } from "./commands/test-fixtures";
import type { Engagement, Report } from "./domain/types";
import type { Context } from "./tenancy";
import {
  artifact,
  at,
  command,
  completedQualityReview,
  evidenceRequest,
  finding,
  paper,
  people,
  procedureId,
  procedureOf,
  recordAcceptance,
  submittedProcedure,
} from "./workflow/test-fixtures";

// Report capture reads assurance records, jobs and settings from D1; none
// exist here (as in commands/reports.test.ts).
vi.mock("./assurance-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assurance-store")>()),
  assurancePins: vi.fn(async () => []),
  pendingJobCount: vi.fn(async () => 0),
  assuranceGates: vi.fn(async () => []),
}));
vi.mock("./quality-review-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./quality-review-records")>()),
  assertReviewerIndependent: vi.fn(async () => {}),
  assertSignerActive: vi.fn(async () => {}),
}));
vi.mock("./report-settings", () => ({
  practiceReportSettings: vi.fn(async () => ({
    signatory: "",
    location: "",
    qualityStatement: "",
  })),
}));

const contributorId = "contributor";
/** Every practice member of the fixtures, and the caller report capture uses. */
const staff = [
  ...Object.entries(people)
    .filter(([, m]) => !m.role.startsWith("Client"))
    .map(([id]) => id),
  caller().user.userId,
];
const token = (id: string) => "staff-id-" + id + "-q7x";
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Renames every staff id, as a string value or as a key, to its token. */
function renameStaff<T>(value: T): T {
  const ids = new Map(staff.map((id) => [id, token(id)]));
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? (ids.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [ids.get(k) ?? k, walk(x)]),
            )
          : v;
  return walk(value) as T;
}

/**
 * An engagement in Sign-off with a reviewed and signed procedure, a client
 * request answered and acknowledged, client findings and evidence, an
 * approved classification v2, and two released final reports (the first
 * superseded by the second).
 */
async function seeded(): Promise<Engagement> {
  const e = await submittedProcedure();
  await command(
    e,
    "reviewProcedure",
    { procedureId, reason: "The work supports the conclusion" },
    "reviewer",
  );
  const paperId = procedureOf(e, procedureId).paperId!;
  const signed = e.papers.find((p) => p.id === paperId)!;
  signed.status = "signed";
  signed.signatures.push({ userId: "lead", revision: 1, at, hash: "h" });
  e.stage = "Sign-off";
  e.qualityReview = completedQualityReview({
    signOffs: [
      {
        reviewerId: "quality-reviewer",
        at,
        internalHash: "i",
        clientHash: "c",
      } as never,
    ],
  });
  recordAcceptance(e);
  e.classification = {
    ...e.classification,
    model: 2,
    approvedBy: "reviewer",
    answers: {
      smeStatus: {
        value: "no",
        evidence: "Register extract",
        legalVersion: "32024R1689",
        rulePackVersion: "2026.11.2",
        answeredAt: at,
        answeredBy: "auditor",
      },
    },
    history: [
      {
        action: "approved",
        at,
        by: "reviewer",
        label: "High risk",
        legalVersion: "32024R1689",
      },
    ],
    legacy: { approvedBy: "second-lead" } as never,
  };
  e.artifacts.push(
    artifact({ id: "EV-SHARED", visibility: "client", uploadedBy: "auditor" }),
    artifact({
      id: "EV-INTERNAL",
      visibility: "internal",
      uploadedBy: "second-auditor",
    }),
  );
  e.findings.push(
    finding({
      id: "F-1",
      severity: "Medium",
      visibility: "client",
      createdBy: "auditor",
      closedBy: "lead",
    }),
    finding({
      id: "F-2",
      severity: "Medium",
      visibility: "internal",
      createdBy: "auditor",
    }),
  );
  e.papers.push(
    paper({
      id: "memo",
      templateId: "MEM-SJ-01",
      kind: "memo",
      audience: "client",
      required: false,
      status: "signed",
      authorId: "second-auditor",
      reviews: [{ userId: "second-reviewer", revision: 1, at }],
      signatures: [{ userId: "lead", revision: 1, at, hash: "h" }],
      body: { conclusion: "Shared judgement", conclusionStatus: "supported" },
    }),
  );
  // A client request: granted by the Lead, clarified by an auditor, answered
  // by the contributor and acknowledged by an auditor.
  e.evidenceRequests = [evidenceRequest({ status: "open" })];
  await command(
    e,
    "grantClientRequest",
    {
      userId: contributorId,
      requestId: "REQ-1",
      prompt: "Validation population",
      instructions: "Upload the anonymized extract",
      category: "Dataset",
      handlingBasis: "anonymized",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    "lead",
  );
  const grant = e.workflow!.clientGrants.at(-1)!;
  await command(
    e,
    "publishClientClarification",
    { grantId: grant.id, text: "Include the holdout split" },
    "auditor",
  );
  grant.communications!.push({
    id: "MSG-REPLY",
    actor: contributorId,
    at,
    kind: "reply",
    text: "Added",
  });
  e.artifacts.push(
    artifact({
      id: "EV-CLIENT",
      visibility: "internal",
      status: "unverified",
      uploadedBy: contributorId,
    }),
  );
  e.workflow!.submissions.push({
    id: "SUB-1",
    requestId: "REQ-1",
    grantId: grant.id,
    actor: contributorId,
    at,
    evidenceIds: ["EV-CLIENT"],
    note: "Extract attached",
    delivery: "complete",
    remaining: "",
  });
  await command(
    e,
    "acknowledgeClientSubmission",
    { submissionId: "SUB-1", note: "Received in full" },
    "auditor",
  );
  // The grant must be live when the projection runs, whatever today is.
  grant.expiresAt = "2999-12-31T23:59:59.000Z";
  Object.assign(e.evidenceRequests[0], {
    status: "accepted",
    disposition: "sufficient",
    updatedBy: "second-auditor",
  });
  // Two final reports, captured by the report command and released.
  const capture = async () => {
    await reports.run(
      e,
      "createReport",
      {
        kind: "final",
        engagementType: "attestation",
        assuranceLevel: "limited",
        conclusion: "unmodified",
        summary: "The criteria are met.",
        addressee: "The board of Fixture Bank AG",
        location: "Vienna, Austria",
        signatory: "Fixture Assurance GmbH",
      },
      caller(),
    );
    return e.reports.at(-1) as Report;
  };
  const release = (r: Report, extra: Partial<Report["release"]> = {}) => {
    r.release = {
      state: "released",
      approval: {
        userId: "reviewer",
        at,
        internalHash: r.sha256,
        clientHash: r.clientSha256!,
        reason: "Both packages reviewed",
      },
      recipientScope: "Authorized members of Fixture Bank AG",
      releasedBy: "lead",
      releasedAt: at,
      history: [
        { actor: "reviewer", at, action: "approve", reason: "Reviewed" },
        { actor: "lead", at, action: "release", reason: "Go" },
        {
          actor: "lead",
          at,
          action: "notify_client",
          reason: "Notify the recipients",
        },
      ],
      ...extra,
    } as Report["release"];
  };
  const first = await capture();
  const second = await capture();
  release(first, { state: "superseded", supersededBy: second.id });
  release(second, { supersedes: first.id });
  return e;
}

const viewer = (): Context => ({
  ...caller("Client Viewer", false),
  user: {
    userId: "viewer",
    displayName: "Client viewer",
    email: "viewer@client.invalid",
  },
  clientId: "client",
});
const contributor = (): Context => ({
  ...viewer(),
  role: "Client Contributor",
  user: {
    userId: contributorId,
    displayName: "Client contributor",
    email: "contributor@client.invalid",
  },
});

describe("client projections carry no staff user id or email (#201)", () => {
  it("seeds every staff id the projections must strip", async () => {
    const internal = JSON.stringify(renameStaff(await seeded()));
    for (const id of ["lead", "auditor", "reviewer", "quality-reviewer"])
      expect(internal, id).toContain(token(id));
    expect(internal).toContain(token(caller().user.userId));
  });

  it("strips them from every projection", async () => {
    const e = renameStaff(await seeded());
    const [first, second] = e.reports;
    const internal = second.snapshot as Parameters<
      typeof clientReportSnapshot
    >[1];
    const projections: Record<string, unknown> = {
      "sanitize (Client Viewer)": sanitize(e, viewer()),
      "sanitize (Client Contributor)": sanitize(e, contributor()),
      clientReportSnapshot: clientReportSnapshot(e, {
        ...internal,
        report: {},
      }),
      "captured client snapshots": e.reports.map((r) => r.clientSnapshot),
      clientClassification: clientClassification(e.classification),
      clientFinding: e.findings.map(clientFinding),
      clientArtifact: e.artifacts.map(clientArtifact),
      clientPaper: e.papers.map(clientPaper),
      clientRecords: {
        findings: clientRecords.findings(e),
        evidence: clientRecords.evidence(e),
        papers: clientRecords.papers(e),
      },
      clientScope: clientScope(e.workflow?.brief),
      clientNotification: [first, second].map(clientNotification),
      clientSubmission: e.workflow!.submissions.map(clientSubmission),
      clientMessage: e.workflow!.clientGrants.flatMap((g) =>
        (g.communications ?? []).map((m) => clientMessage(m, contributorId)),
      ),
    };
    for (const [name, projection] of Object.entries(projections)) {
      const json = JSON.stringify(projection);
      for (const id of staff)
        expect(json, name + ": " + id).not.toContain(token(id));
      expect(json.match(email)?.[0], name).toBeUndefined();
    }
    // The projections still show what the client is meant to see.
    const portal = sanitize(e, contributor()).portalRequests!;
    expect(portal[0].submissions[0].receipt).toEqual({
      actor: "",
      at,
      note: "Received in full",
    });
    expect(portal[0].communications!.map((m) => [m.kind, m.actor])).toEqual([
      ["clarification", ""],
      ["reply", contributorId],
    ]);
    expect(sanitize(e, viewer()).reports.map((r) => r.id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});
