import { describe, expect, it } from "vitest";
import { workflowCommand } from "../workflow-service";
import { clientGrantLapsed } from "../workflow-state";
import {
  at,
  context,
  evidenceRequest,
  expectFailure,
  people,
  structuredEngagement,
  workflowOf,
} from "./test-fixtures";

const later = "2026-11-06T09:00:00.000Z";

describe("lapsed client request grants (#95)", () => {
  const grant = { active: true, at };
  it("lapse with a revoked membership or a grant that began after them", () => {
    expect(clientGrantLapsed(grant, { status: "active" })).toBe(false);
    expect(
      clientGrantLapsed(grant, { status: "active", access_since: at }),
    ).toBe(false);
    expect(
      clientGrantLapsed(grant, { status: "active", access_since: later }),
    ).toBe(true);
    expect(clientGrantLapsed(grant, { status: "revoked" })).toBe(true);
    expect(clientGrantLapsed(grant, null)).toBe(true);
    // A revoked request grant is inactive, not lapsed.
    expect(
      clientGrantLapsed(
        { active: false, at },
        { status: "active", access_since: later },
      ),
    ).toBe(false);
  });

  it("refuses to update or clarify a grant whose contributor was re-granted since", async () => {
    const e = structuredEngagement({
      evidenceRequests: [evidenceRequest({ status: "open" })],
    });
    await workflowCommand(
      e,
      "grantClientRequest",
      {
        userId: "contributor",
        requestId: "REQ-1",
        prompt: "Validation population",
        instructions: "Upload the anonymized extract",
        category: "Dataset",
        handlingBasis: "anonymized",
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      context("lead"),
    );
    const grantId = workflowOf(e).clientGrants[0].id;
    const regranted = (userId: string) => ({
      ...context(userId),
      member: async (id: string) =>
        id === "contributor"
          ? { ...people.contributor, access_since: later }
          : (people[id] ?? null),
    });
    const lapsed =
      "This grant lapsed when the contributor's access changed. Assign the request again.";
    await expectFailure(
      workflowCommand(
        e,
        "updateClientRequest",
        { grantId, prompt: "Population", instructions: "Use the 2026 data" },
        regranted("lead"),
      ),
      409,
      lapsed,
    );
    await expectFailure(
      workflowCommand(
        e,
        "publishClientClarification",
        { grantId, text: "Please include the period" },
        regranted("auditor"),
      ),
      409,
      lapsed,
    );
    // While the membership is unchanged the grant is still live.
    await workflowCommand(
      e,
      "updateClientRequest",
      { grantId, prompt: "Population", instructions: "Use the 2026 data" },
      context("lead"),
    );
    expect(workflowOf(e).clientGrants[0].prompt).toBe("Population");
  });
});
