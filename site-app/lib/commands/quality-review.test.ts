import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Engagement, Report, Role } from "../domain";
import {
  qualityReviewReleaseProblem,
  standBackChecklist,
} from "../domain/quality-review";
import { ApiError } from "../http";
import type { Context } from "../tenancy";
import { sqliteD1 } from "../test-d1";
import { engagement, paper } from "../workflow/test-fixtures";
import { dispatch } from ".";

const settings = env as { DB?: D1Database; EQR_COOLING_OFF_DAYS?: string };
let sqlite: DatabaseSync;

function as(userId: string, role: Role): Context {
  return {
    user: { userId, displayName: userId, email: userId + "@fixture.invalid" },
    tenantId: "tenant-1",
    role,
    clientId: null,
    practiceAdmin: false,
  };
}
const lead = as("lead", "Lead Auditor"),
  eqr = as("eqr", "Engagement Quality Reviewer");

function member(userId: string, role: Role, access = true) {
  sqlite
    .prepare(
      "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES('tenant-1',?,?,NULL,?,'active')",
    )
    .run(userId, role, userId);
  if (access)
    sqlite
      .prepare(
        "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('tenant-1','ENG-1',?,1,'lead','2026-11-01T00:00:00Z')",
      )
      .run(userId);
}
/** Another engagement of the practice, stored with this body. */
function storedEngagement(id: string, clientId: string, body: Engagement) {
  sqlite
    .prepare(
      "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES(?,'tenant-1',?,'Audit',1,?,'init')",
    )
    .run(id, clientId, JSON.stringify(body));
}

beforeEach(() => {
  const d1 = sqliteD1();
  settings.DB = d1.db;
  sqlite = d1.sqlite;
  const at = "2026-01-01T00:00:00.000Z";
  sqlite
    .prepare("INSERT INTO tenants(id,name,created_at) VALUES('tenant-1','P',?)")
    .run(at);
  for (const client of ["client", "other-client"])
    sqlite
      .prepare(
        "INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES(?,'tenant-1','Client','Finance',?)",
      )
      .run(client, at);
  storedEngagement("ENG-1", "client", engagement());
  member("lead", "Lead Auditor");
  member("eqr", "Engagement Quality Reviewer");
});
afterEach(() => {
  delete settings.DB;
  delete settings.EQR_COOLING_OFF_DAYS;
});

const appoint = (e: Engagement, userId = "eqr", ctx = lead) =>
  dispatch(e, "appointQualityReviewer", { userId, reason: "Independent" }, ctx);
async function refusal(result: Promise<unknown>) {
  const error = await result.then(
    () => {
      throw new Error("Expected a refusal");
    },
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ApiError);
  return {
    status: (error as ApiError).status,
    message: (error as Error).message,
  };
}
const allSatisfied = standBackChecklist.map((i) => ({
  id: i.id,
  status: "satisfied",
  notes: "Evaluated " + i.id,
}));
function finalPackage(): Report {
  return {
    id: "R1",
    kind: "final",
    createdAt: "2026-11-05T10:00:00.000Z",
    actor: "lead",
    sha256: "internal-hash",
    snapshot: {
      terms: {
        engagementType: "direct",
        assuranceLevel: "reasonable",
        conclusion: "unmodified",
      },
    },
    clientSnapshot: { contractVersion: "2.0" },
    clientSha256: "client-hash",
    release: { state: "internal", history: [] },
  };
}

describe("appointing the engagement quality reviewer", () => {
  it("appoints an eligible reviewer and records the cooling-off rule applied", async () => {
    const e = engagement();
    const result = await appoint(e);
    expect(result).toEqual({
      details: { reviewerId: "eqr", coolingOffDays: 730 },
    });
    expect(e.qualityReview).toMatchObject({
      reviewerId: "eqr",
      appointedBy: "lead",
      reason: "Independent",
      coolingOffDays: 730,
      items: [],
      history: [{ action: "appoint", actor: "lead", reviewerId: "eqr" }],
    });
  });

  it("rejects a reviewer who is on the engagement team", async () => {
    // Someone who prepared this engagement's work, then took the EQR role.
    const e = engagement({ papers: [paper({ authorId: "eqr" })] });
    expect(await refusal(appoint(e))).toEqual({
      status: 409,
      message:
        "This person is on the engagement team (a preparer, reviewer or Lead of this engagement) and cannot be its quality reviewer",
    });
    expect(e.qualityReview).toBeUndefined();
  });

  it("rejects members without the role or without engagement access", async () => {
    member("reviewer", "Reviewer");
    member("eqr-without-access", "Engagement Quality Reviewer", false);
    const e = engagement();
    expect(await refusal(appoint(e, "reviewer"))).toMatchObject({
      status: 400,
      message:
        "Select an active member with the Engagement Quality Reviewer role",
    });
    expect(await refusal(appoint(e, "eqr-without-access"))).toMatchObject({
      status: 400,
      message:
        "Grant the reviewer access to this engagement in Users & access first",
    });
    expect(
      await refusal(appoint(e, "eqr", as("auditor", "Auditor"))),
    ).toMatchObject({ status: 403 });
  });

  it("applies the cooling-off period to the client's other engagements", async () => {
    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString();
    storedEngagement(
      "ENG-0",
      "client",
      engagement({
        id: "ENG-0",
        papers: [paper({ authorId: "eqr", updatedAt: recent })],
      }),
    );
    // Team service for another client does not count.
    storedEngagement(
      "ENG-9",
      "other-client",
      engagement({ id: "ENG-9", papers: [paper({ authorId: "eqr" })] }),
    );
    const e = engagement();
    expect(await refusal(appoint(e))).toEqual({
      status: 409,
      message:
        "This person served on the team of ENG-0 for the same client within the 730-day cooling-off period and is not yet eligible",
    });
    settings.EQR_COOLING_OFF_DAYS = "14";
    await appoint(e);
    expect(e.qualityReview?.coolingOffDays).toBe(14);
  });

  it("replaces a reviewer with a fresh checklist and keeps the history", async () => {
    member("eqr-2", "Engagement Quality Reviewer");
    const e = engagement();
    await appoint(e);
    await dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr);
    expect(await refusal(appoint(e))).toMatchObject({ status: 409 });
    const result = await appoint(e, "eqr-2");
    expect(result).toMatchObject({ details: { replaces: "eqr" } });
    expect(e.qualityReview).toMatchObject({ reviewerId: "eqr-2", items: [] });
    expect(e.qualityReview!.history.map((h) => h.action)).toEqual([
      "appoint",
      "save",
      "replace",
    ]);
  });
});

describe("the reviewer's checklist and sign-off", () => {
  it("lets only the appointed reviewer record the review", async () => {
    member("eqr-2", "Engagement Quality Reviewer");
    const e = engagement();
    expect(
      await refusal(dispatch(e, "saveQualityReview", { items: [] }, eqr)),
    ).toMatchObject({ status: 409 });
    await appoint(e);
    expect(
      await refusal(
        dispatch(
          e,
          "saveQualityReview",
          { items: [] },
          as("eqr-2", "Engagement Quality Reviewer"),
        ),
      ),
    ).toMatchObject({ status: 403 });
    expect(
      await refusal(dispatch(e, "saveQualityReview", { items: [] }, lead)),
    ).toEqual({ status: 403, message: "Your role cannot perform this action" });
    const saved = await dispatch(
      e,
      "saveQualityReview",
      { items: allSatisfied.slice(1) },
      eqr,
    );
    expect(saved).toEqual({ details: { revision: 2, complete: false } });
  });

  it("signs off both exact packages once the checklist is complete", async () => {
    const e = engagement({ reports: [finalPackage()] });
    await appoint(e);
    const data = {
      reportId: "R1",
      internalHash: "internal-hash",
      clientHash: "client-hash",
      conclusion: "Nothing came to my attention",
    };
    expect(
      await refusal(dispatch(e, "signOffQualityReview", data, eqr)),
    ).toEqual({
      status: 409,
      message:
        "The engagement quality reviewer must complete the stand-back checklist",
    });
    await dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr);
    expect(
      await refusal(
        dispatch(
          e,
          "signOffQualityReview",
          { ...data, clientHash: "stale" },
          eqr,
        ),
      ),
    ).toEqual({ status: 409, message: "Review both exact package hashes" });
    await dispatch(e, "signOffQualityReview", data, eqr);
    expect(qualityReviewReleaseProblem(e, e.reports[0])).toBe("");
    // Changing the checklist afterwards needs a new sign-off.
    await dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr);
    expect(qualityReviewReleaseProblem(e, e.reports[0])).toBe(
      "The engagement quality reviewer must sign off both exact packages before release",
    );
  });

  it("refuses a reviewer who joined the engagement team", async () => {
    const e = engagement({ reports: [finalPackage()] });
    await appoint(e);
    e.papers.push(paper({ contributors: ["eqr"] }));
    expect(
      await refusal(
        dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr),
      ),
    ).toMatchObject({ status: 409 });
  });
});

describe("an Engagement Quality Reviewer", () => {
  it("cannot edit, create or sign papers", async () => {
    const p = paper({ id: "WP-1" });
    const e = engagement({ papers: [p] }),
      before = JSON.stringify(e);
    for (const [op, data] of [
      ["editPaper", { paperId: "WP-1", body: { results: "Changed" } }],
      ["createPaper", { templateId: "WP-A10-01" }],
      ["submitPaper", { paperId: "WP-1" }],
      ["reviewPaper", { paperId: "WP-1" }],
      ["signPaper", { paperId: "WP-1" }],
      ["comment", { paperId: "WP-1", text: "A note" }],
    ] as const)
      expect(await refusal(dispatch(e, op, data, eqr)), op).toEqual({
        status: 403,
        message:
          "An Engagement Quality Reviewer reviews the engagement but cannot change its audit work",
      });
    expect(JSON.stringify(e)).toBe(before);
  });
});
