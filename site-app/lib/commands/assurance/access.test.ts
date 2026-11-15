// Engagement access for the Engagement Quality Reviewer against SQLite D1
// (#225 item 1): the EQR is a staff role, so a Lead Auditor finds them among
// the members Team & runtime offers and grants them access with setAccess,
// after which the quality review can appoint them. Client members stay
// refused.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getEngagement } from "../../engagement-repo";
import { ApiError } from "../../http";
import { assuranceView } from "../../read-models/assurance-view";
import {
  engagementWithParts,
  member,
  practice,
  tenantId,
} from "../../test-storage";
import { dispatch } from "../index";
import { dispatchAssurance } from "./index";
import { assuranceTarget } from "./target";

afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

const lead = () => member("lead", "Lead Auditor");
async function setup() {
  const e = engagementWithParts("ENG-Q", "Quality audit");
  // No paper history: the quality review reads the recorded team from it.
  e.papers = [];
  const { sqlite } = await practice([e]);
  for (const [userId, role] of [
    ["eqr", "Engagement Quality Reviewer"],
    ["reviewer", "Reviewer"],
  ])
    sqlite
      .prepare(
        "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) VALUES(?,?,?,NULL,?,'active')",
      )
      .run(tenantId, userId, role, "Name of " + userId);
  return sqlite;
}
type Sqlite = Awaited<ReturnType<typeof setup>>;
const setAccess = async (userId: string, active = true) =>
  dispatchAssurance(
    assuranceTarget(await getEngagement(lead(), "ENG-Q"), lead()),
    "setAccess",
    { userId, active, reason: "Quality review of the engagement" },
    lead(),
  );
const access = (sqlite: Sqlite, userId: string) =>
  sqlite
    .prepare(
      "SELECT active FROM engagement_access WHERE engagement_id='ENG-Q' AND user_id=?",
    )
    .get(userId)?.active;
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

describe("engagement access for the Engagement Quality Reviewer", () => {
  it("offers every active staff member in Team & runtime, the EQR included", async () => {
    await setup();
    const view = await assuranceView(lead(), "ENG-Q");
    expect(
      view.eligibleMembers
        .map((m) => [m.user_id, m.role])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["auditor", "Auditor"],
      ["eqr", "Engagement Quality Reviewer"],
      ["lead", "Lead Auditor"],
      ["reviewer", "Reviewer"],
    ]);
  });

  it("grants and revokes the EQR's access, and refuses client members", async () => {
    const sqlite = await setup();
    expect(access(sqlite, "eqr")).toBeUndefined();
    await setAccess("eqr");
    expect(access(sqlite, "eqr")).toBe(1);
    await setAccess("eqr", false);
    expect(access(sqlite, "eqr")).toBe(0);
    // The revoked member keeps their name in the workbench (#244 item 5).
    expect((await assuranceView(lead(), "ENG-Q")).memberNames).toContainEqual({
      user_id: "eqr",
      display_name: "Name of eqr",
    });
    for (const userId of ["contributor", "viewer", "nobody"]) {
      const error = await refusal(setAccess(userId));
      expect(error, userId).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe("Select an active staff member");
    }
  });

  it("lets the quality review appoint the EQR once access is granted", async () => {
    await setup();
    const e = await getEngagement(lead(), "ENG-Q");
    const appoint = () =>
      dispatch(
        e,
        "appointQualityReviewer",
        { userId: "eqr", reason: "Independent of the engagement team" },
        lead(),
      );
    expect(((await refusal(appoint())) as Error).message).toBe(
      "Grant the reviewer access to this engagement in Users & access first",
    );
    await setAccess("eqr");
    expect(await appoint()).toMatchObject({
      details: { reviewerId: "eqr" },
    });
    expect(e.qualityReview?.reviewerId).toBe("eqr");
  });
});
