import { describe, expect, it } from "vitest";
import { sanitize } from "../client-projection";
import { caller } from "../commands/test-fixtures";
import { finalReportGates, type Engagement, type Report } from "../domain";
import { engagementWork } from "../work-items";
import {
  approvedWorkflow,
  at,
  command,
  completedQualityReview,
  engagement,
  expectFailure,
  paper,
} from "../workflow/test-fixtures";
import {
  checklistProblem,
  coolingOffConflicts,
  engagementTeam,
  qualityReviewGates,
  qualityReviewReleaseProblem,
  qualityReviewRequired,
} from "./quality-review";

/** A captured attestation package the reviewer approved independently. */
function approvedPackage(id = "R1"): Report {
  return {
    id,
    kind: "final",
    createdAt: at,
    actor: "lead",
    sha256: id + "-internal",
    snapshot: {
      opinion: "Unmodified",
      terms: {
        engagementType: "attestation",
        assuranceLevel: "limited",
        conclusion: "unmodified",
      },
    },
    clientSnapshot: { contractVersion: "2.0" },
    clientSha256: id + "-client",
    release: {
      state: "approved",
      approval: {
        userId: "reviewer",
        at,
        internalHash: id + "-internal",
        clientHash: id + "-client",
        reason: "Both packages reviewed",
      },
      history: [],
    },
  };
}
const signOff = (r: Report, revision = 2) => ({
  reportId: r.id,
  internalHash: r.sha256,
  clientHash: r.clientSha256!,
  checklistRevision: revision,
  conclusion: "Nothing came to my attention",
  userId: "quality-reviewer",
  at,
});
const release = (e: Engagement) =>
  command(
    e,
    "releaseReport",
    {
      reportId: "R1",
      recipientScope: "Client board",
      reason: "Authorized release",
    },
    "lead",
  );
const ids = (e: Engagement, type?: "attestation" | "readiness") =>
  qualityReviewGates(e, type).map((g) => g.title);

describe("engagement team", () => {
  it("names every preparer, reviewer and Lead of the engagement's work", () => {
    const e = engagement({
      workflow: approvedWorkflow(),
      papers: [
        paper({
          authorId: "auditor",
          reviews: [{ userId: "reviewer", revision: 1, at }],
          signatures: [{ userId: "lead", revision: 1, at, hash: "h" }],
        }),
      ],
    });
    const team = engagementTeam(e);
    for (const id of ["auditor", "reviewer", "lead"])
      expect(team.has(id), id).toBe(true);
    expect(team.has("quality-reviewer")).toBe(false);
    // The quality review itself is not team work.
    e.qualityReview = completedQualityReview();
    expect(engagementTeam(e).has("quality-reviewer")).toBe(false);
  });

  it("finds team service on the client's other engagements within the cooling-off period", () => {
    const earlier = engagement({
      id: "ENG-0",
      papers: [
        paper({ authorId: "former", updatedAt: "2025-06-01T09:00:00Z" }),
      ],
    });
    expect(
      coolingOffConflicts([earlier], "former", 730, "2026-11-05T10:00:00Z"),
    ).toEqual([
      { id: "ENG-0", title: earlier.title, last: "2025-06-01T09:00:00Z" },
    ]);
    // After the cooling-off period, or with none, the person is eligible.
    expect(
      coolingOffConflicts([earlier], "former", 365, "2026-11-05T10:00:00Z"),
    ).toEqual([]);
    expect(
      coolingOffConflicts([earlier], "someone", 730, "2026-11-05T10:00:00Z"),
    ).toEqual([]);
  });
});

describe("quality review gates", () => {
  it("is required for assurance engagement types and whenever a reviewer is appointed", () => {
    const e = engagement();
    expect(qualityReviewRequired(e, "attestation")).toBe(true);
    expect(qualityReviewRequired(e, "certification")).toBe(true);
    expect(qualityReviewRequired(e, "readiness")).toBe(false);
    expect(qualityReviewRequired(e, "agreed_upon_procedures")).toBe(false);
    expect(qualityReviewRequired(e)).toBe(false);
    e.qualityReview = completedQualityReview();
    expect(qualityReviewRequired(e, "readiness")).toBe(true);
  });

  it("blocks final capture until an independent reviewer completes the checklist", () => {
    const e = engagement();
    expect(ids(e, "readiness")).toEqual([]);
    expect(ids(e, "attestation")).toEqual([
      "Appoint an engagement quality reviewer",
    ]);
    e.qualityReview = completedQualityReview({ items: [] });
    expect(ids(e, "attestation")).toEqual(["Complete the quality review"]);
    e.qualityReview.items = completedQualityReview().items.map((i) =>
      i.id === "report" ? { ...i, status: "concern" as const } : i,
    );
    expect(checklistProblem(e.qualityReview)).toBe(
      "The engagement quality reviewer has raised concerns that remain open",
    );
    e.qualityReview.items = completedQualityReview().items.map((i) =>
      i.id === "report" ? { ...i, notes: " " } : i,
    );
    expect(ids(e, "attestation")).toEqual(["Complete the quality review"]);
    e.qualityReview = completedQualityReview();
    expect(ids(e, "attestation")).toEqual([]);
    // The gate is part of final issuance.
    expect(
      finalReportGates(e, {
        engagementType: "attestation",
        assuranceLevel: "limited",
        conclusion: "qualified",
      }).filter((g) => g.kind === "quality_review"),
    ).toEqual([]);
  });

  it("rejects a reviewer who is on the engagement team", () => {
    const e = engagement({
      qualityReview: completedQualityReview(),
      papers: [paper({ contributors: ["quality-reviewer"] })],
    });
    expect(ids(e, "attestation")).toEqual([
      "Appoint an independent engagement quality reviewer",
    ]);
    const r = approvedPackage();
    e.qualityReview!.signOffs.push(signOff(r));
    expect(qualityReviewReleaseProblem(e, r)).toBe(
      "The engagement quality reviewer is on the engagement team; appoint an eligible reviewer",
    );
  });
});

describe("report release", () => {
  const releasable = () =>
    engagement({
      workflow: approvedWorkflow(),
      stage: "Sign-off",
      reports: [approvedPackage()],
      qualityReview: completedQualityReview(),
    });

  it("is blocked until the quality reviewer signs off both exact packages", async () => {
    const e = releasable();
    await expectFailure(
      release(e),
      409,
      "The engagement quality reviewer must sign off both exact packages before release",
    );
    expect(e.reports[0].release!.state).toBe("approved");
    // A sign-off of other hashes, an earlier checklist revision or by someone
    // else covers nothing.
    const r = e.reports[0];
    e.qualityReview!.signOffs.push(
      { ...signOff(r), clientHash: "other" },
      signOff(r, 1),
      { ...signOff(r), userId: "someone-else" },
    );
    await expectFailure(release(e), 409);
    e.qualityReview!.signOffs.push(signOff(r));
    await release(e);
    expect(e.reports[0].release!.state).toBe("released");
  });

  it("is blocked for an assurance package without any reviewer", async () => {
    const e = releasable();
    delete e.qualityReview;
    await expectFailure(
      release(e),
      409,
      "Appoint an engagement quality reviewer and obtain their sign-off before release",
    );
  });

  it("needs no quality review for a readiness package unless a reviewer is appointed", async () => {
    const e = releasable();
    delete e.qualityReview;
    e.reports[0].snapshot.terms = {
      engagementType: "readiness",
      assuranceLevel: null,
      conclusion: "readiness",
    };
    await release(e);
    expect(e.reports[0].release!.state).toBe("released");
  });
});

describe("quality review records", () => {
  it("never reach a client", () => {
    const e = engagement({ qualityReview: completedQualityReview() });
    for (const role of ["Client Viewer", "Client Contributor"] as const)
      expect(
        JSON.stringify(sanitize(e, { ...caller(role), clientId: "client" })),
      ).not.toContain("quality-reviewer");
    expect(
      sanitize(e, caller("Engagement Quality Reviewer")).qualityReview,
    ).toEqual(e.qualityReview);
  });

  it("put the review and the sign-off in the reviewer's own work", () => {
    const e = engagement({
      qualityReview: completedQualityReview({ items: [] }),
      reports: [approvedPackage()],
    });
    const work = (userId: string) =>
      engagementWork(e, "Engagement Quality Reviewer", userId)
        .filter((i) => i.title === "Engagement quality review")
        .map((i) => i.action);
    expect(work("quality-reviewer")).toEqual([
      "Complete the stand-back checklist",
    ]);
    expect(work("another-reviewer")).toEqual([]);
    e.qualityReview = completedQualityReview();
    expect(work("quality-reviewer")).toEqual(["Sign off final package"]);
    e.qualityReview.signOffs.push(signOff(e.reports[0]));
    expect(work("quality-reviewer")).toEqual([]);
  });
});
