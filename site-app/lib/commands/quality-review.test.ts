import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { roles, type Engagement, type Report, type Role } from "../domain";
import {
  qualityReviewReleaseProblem,
  standBackChecklist,
} from "../domain/quality-review";
import { ApiError } from "../http";
import { canBeAssigned } from "../permissions";
import type { Context } from "../tenancy";
import { sqliteD1 } from "../test-d1";
import {
  assertReviewerIndependent,
  assertSignerActive,
} from "../quality-review-records";
import {
  acceptedRecord,
  approvedWorkflow,
  artifact,
  engagement,
  paper,
} from "../workflow/test-fixtures";
import { dispatch } from ".";

const settings = env as { DB?: D1Database };
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
});

/** An audit event for a command `actor` issued on `engagementId`. */
function auditEvent(
  engagementId: string,
  actor: string,
  action: string,
  createdAt = new Date().toISOString(),
) {
  sqlite
    .prepare(
      "INSERT INTO audit_events(tenant_id,engagement_id,id,actor,action,previous_hash,hash,created_at,details) VALUES('tenant-1',?,?,?,?,'p','h',?,'{}')",
    )
    .run(engagementId, crypto.randomUUID(), actor, action, createdAt);
}
/** An assurance record `actor` wrote on `engagementId`. */
function assuranceRecord(engagementId: string, actor: string) {
  sqlite
    .prepare(
      "INSERT INTO assurance_records(tenant_id,engagement_id,id,kind,body,sha256,created_at,actor) VALUES('tenant-1',?,?,'observation','{}','s',?,?)",
    )
    .run(engagementId, crypto.randomUUID(), new Date().toISOString(), actor);
}
const teamRefusal = {
  status: 409,
  message:
    "This person is on the engagement team (a preparer, reviewer or Lead of this engagement) and cannot be its quality reviewer",
};

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

  it("rejects a reviewer who only commented on a paper or only uploaded evidence", async () => {
    const commented = engagement({
      papers: [
        paper({
          comments: [
            {
              id: "C1",
              authorId: "eqr",
              text: "Check the sample",
              resolved: false,
              createdAt: "2026-11-01T09:00:00Z",
            },
          ],
        }),
      ],
    });
    expect(await refusal(appoint(commented))).toEqual(teamRefusal);
    const responded = engagement({
      papers: [
        paper({
          comments: [
            {
              id: "C1",
              authorId: "auditor",
              text: "Check the sample",
              resolved: true,
              createdAt: "2026-11-01T09:00:00Z",
              responses: [
                { actor: "eqr", at: "2026-11-02T09:00:00Z", text: "Done" },
              ],
            },
          ],
        }),
      ],
    });
    expect(await refusal(appoint(responded))).toEqual(teamRefusal);
    const uploaded = engagement({
      artifacts: [artifact({ uploadedBy: "eqr" })],
    });
    expect(await refusal(appoint(uploaded))).toEqual(teamRefusal);
  });

  it("rejects a reviewer whose work is recorded only in audit events or assurance records", async () => {
    // Work the engagement record does not show (a run, a removed comment).
    member("eqr-ran", "Engagement Quality Reviewer");
    member("eqr-observed", "Engagement Quality Reviewer");
    auditEvent("ENG-1", "eqr-ran", "startRun");
    assuranceRecord("ENG-1", "eqr-observed");
    expect(await refusal(appoint(engagement(), "eqr-ran"))).toEqual(
      teamRefusal,
    );
    expect(await refusal(appoint(engagement(), "eqr-observed"))).toEqual(
      teamRefusal,
    );
    // The reviewer's own checklist saves and sign-offs are not team work.
    auditEvent("ENG-1", "eqr", "saveQualityReview");
    auditEvent("ENG-1", "eqr", "signOffQualityReview");
    await appoint(engagement());
  });

  it("applies the cooling-off period to recorded work on the client's other engagements", async () => {
    storedEngagement("ENG-0", "client", engagement({ id: "ENG-0" }));
    storedEngagement("ENG-9", "other-client", engagement({ id: "ENG-9" }));
    auditEvent("ENG-9", "eqr", "comment");
    auditEvent(
      "ENG-0",
      "eqr",
      "comment",
      new Date(Date.now() - 900 * 86_400_000).toISOString(),
    );
    const e = engagement();
    // Only old work for this client and work for another client: eligible.
    await appoint(e);
    delete e.qualityReview;
    auditEvent(
      "ENG-0",
      "eqr",
      "editPaper",
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
    );
    expect(await refusal(appoint(e))).toEqual({
      status: 409,
      message:
        "This person served on the team of ENG-0 for the same client within the 730-day cooling-off period and is not yet eligible",
    });
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

  it("accepts exactly the members the browser's reviewer picker offers", async () => {
    // Parity with app/quality-review-panel.tsx, which offers the members
    // canBeAssigned(role, "qualityReviewer") admits: every other role is
    // refused for the role, before any access or independence check.
    for (const role of roles) {
      const userId = "member-" + role.replace(/\W/g, "-");
      member(userId, role);
      const e = engagement();
      if (canBeAssigned(role, "qualityReviewer"))
        expect(await appoint(e, userId), role).toMatchObject({
          details: { reviewerId: userId },
        });
      else
        expect(await refusal(appoint(e, userId)), role).toEqual({
          status: 400,
          message:
            "Select an active member with the Engagement Quality Reviewer role",
        });
    }
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
    // The practice policy (setQualityReviewPolicy) sets the period.
    sqlite
      .prepare("UPDATE tenants SET eqr_cooling_off_days=14 WHERE id='tenant-1'")
      .run();
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

/** Changes a member's role the way updateMember does: grants withdrawn first. */
function changeRole(userId: string, role: Role, at: string) {
  sqlite
    .prepare(
      "UPDATE engagement_access SET active=0,actor='lead',updated_at=? WHERE tenant_id='tenant-1' AND user_id=? AND active=1",
    )
    .run(at, userId);
  sqlite
    .prepare(
      "UPDATE memberships SET role=? WHERE tenant_id='tenant-1' AND user_id=?",
    )
    .run(role, userId);
}
/** Grants (or re-grants) access to an engagement, as every grant path does. */
function grant(engagementId: string, userId: string, at: string) {
  sqlite
    .prepare(
      "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES('tenant-1',?,?,1,'lead',?) ON CONFLICT(tenant_id,engagement_id,user_id) DO UPDATE SET active=1,actor=excluded.actor,updated_at=excluded.updated_at",
    )
    .run(engagementId, userId, at);
}
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

describe("team membership the engagement record does not show", () => {
  it("counts everyone the acceptance record names, before they record any work", async () => {
    member("eqr-named", "Engagement Quality Reviewer");
    const workflow = approvedWorkflow();
    workflow.acceptance = {
      ...acceptedRecord(),
      team: ["lead", "eqr-named"],
    };
    expect(
      await refusal(appoint(engagement({ workflow }), "eqr-named")),
    ).toEqual(teamRefusal);
  });

  it("counts an engagement grant held under another role, even after a re-grant as reviewer", async () => {
    // A second Lead with access but no recorded work, later made a reviewer.
    member("lead-2", "Lead Auditor");
    changeRole("lead-2", "Engagement Quality Reviewer", daysAgo(1));
    grant("ENG-1", "lead-2", new Date().toISOString());
    expect(await refusal(appoint(engagement(), "lead-2"))).toEqual(teamRefusal);
    // A grant given only under the reviewer role is what appointment needs.
    await appoint(engagement());
  });

  it("applies the cooling-off period to grants on the client's other engagements", async () => {
    storedEngagement("ENG-0", "client", engagement({ id: "ENG-0" }));
    storedEngagement("ENG-9", "other-client", engagement({ id: "ENG-9" }));
    member("former", "Auditor", false);
    // An Auditor on another client's engagement, still: not a conflict.
    grant("ENG-9", "former", daysAgo(30));
    // An Auditor on this client's ENG-0 until 900 days ago: cooled off.
    grant("ENG-0", "former", daysAgo(1000));
    sqlite
      .prepare(
        "UPDATE engagement_access SET active=0,updated_at=? WHERE engagement_id='ENG-0' AND user_id='former'",
      )
      .run(daysAgo(900));
    changeRole("former", "Engagement Quality Reviewer", daysAgo(2));
    grant("ENG-1", "former", daysAgo(1));
    const e = engagement();
    await appoint(e, "former");
    delete e.qualityReview;
    // Re-granted to ENG-0 as an Auditor 30 days ago and withdrawn 10 days
    // ago: the period runs from the withdrawal.
    changeRole("former", "Auditor", daysAgo(31));
    grant("ENG-0", "former", daysAgo(30));
    changeRole("former", "Engagement Quality Reviewer", daysAgo(10));
    grant("ENG-1", "former", daysAgo(9));
    expect(await refusal(appoint(e, "former"))).toEqual({
      status: 409,
      message:
        "This person served on the team of ENG-0 for the same client within the 730-day cooling-off period and is not yet eligible",
    });
  });

  it("counts a grant of unknown role recorded before the history existed", async () => {
    storedEngagement("ENG-0", "client", engagement({ id: "ENG-0" }));
    sqlite
      .prepare(
        "INSERT INTO engagement_access_history(tenant_id,engagement_id,user_id,active,role,actor,at) VALUES('tenant-1','ENG-0','eqr',0,NULL,'migration',?)",
      )
      .run(daysAgo(100));
    expect(await refusal(appoint(engagement()))).toMatchObject({
      status: 409,
      message: expect.stringContaining("served on the team of ENG-0"),
    });
  });

  it("keeps the grant history immutable", () => {
    expect(() =>
      sqlite.prepare("DELETE FROM engagement_access_history").run(),
    ).toThrow(/immutable/);
    expect(() =>
      sqlite.prepare("UPDATE engagement_access_history SET role='x'").run(),
    ).toThrow(/immutable/);
  });
});

describe("the practice's cooling-off policy", () => {
  it("applies the practice's period, or two years while it has set none", async () => {
    storedEngagement(
      "ENG-0",
      "client",
      engagement({
        id: "ENG-0",
        papers: [paper({ authorId: "eqr", updatedAt: daysAgo(30) })],
      }),
    );
    const e = engagement();
    expect(await refusal(appoint(e))).toMatchObject({
      status: 409,
      message: expect.stringContaining("730-day cooling-off period"),
    });
    sqlite
      .prepare("UPDATE tenants SET eqr_cooling_off_days=0 WHERE id='tenant-1'")
      .run();
    // 0 checks only the engagement's own team; the appointment records it.
    expect(await appoint(e)).toEqual({
      details: { reviewerId: "eqr", coolingOffDays: 0 },
    });
    expect(e.qualityReview?.coolingOffDays).toBe(0);
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

describe("recorded team work after the appointment", () => {
  it("refuses the reviewer's checklist, capture and release", async () => {
    const e = engagement({ reports: [finalPackage()] });
    await appoint(e);
    await dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr);
    // The reviewer later did team work, say under another role.
    auditEvent("ENG-1", "eqr", "comment");
    expect(
      await refusal(
        dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr),
      ),
    ).toMatchObject({ status: 409 });
    expect(await refusal(assertReviewerIndependent(lead, e))).toEqual({
      status: 409,
      message:
        "The engagement quality reviewer is on the engagement team; appoint an eligible reviewer",
    });
  });

  it("lets capture and release proceed while the reviewer did no team work", async () => {
    const e = engagement({ reports: [finalPackage()] });
    await appoint(e);
    await dispatch(e, "saveQualityReview", { items: allSatisfied }, eqr);
    auditEvent("ENG-1", "eqr", "saveQualityReview");
    auditEvent("ENG-1", "lead", "appointQualityReviewer");
    await assertReviewerIndependent(lead, e);
  });
});

describe("the signer at release", () => {
  it("must still be an active member with the Engagement Quality Reviewer role", async () => {
    const e = engagement({ reports: [finalPackage()] });
    await appoint(e);
    await assertSignerActive(lead, e);
    const refused = {
      status: 409,
      message:
        "The engagement quality reviewer is no longer an active member with the Engagement Quality Reviewer role; appoint a reviewer and obtain their sign-off before release",
    };
    changeRole("eqr", "Reviewer", new Date().toISOString());
    expect(await refusal(assertSignerActive(lead, e))).toEqual(refused);
    changeRole("eqr", "Engagement Quality Reviewer", new Date().toISOString());
    await assertSignerActive(lead, e);
    sqlite
      .prepare(
        "UPDATE memberships SET status='revoked' WHERE tenant_id='tenant-1' AND user_id='eqr'",
      )
      .run();
    expect(await refusal(assertSignerActive(lead, e))).toEqual(refused);
    // Without a reviewer there is no signer to check.
    await assertSignerActive(lead, engagement());
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
