// The client request commands beyond their role check (#52): the happy path,
// each refusal and the state each leaves. A refused command leaves the
// engagement exactly as it was.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Engagement, EvidenceRequest } from "../domain/types";
import { workflowCommand } from "./dispatch";
import type { ClientGrant, Submission } from "../workflow-types";
import {
  approvedWorkflow,
  at,
  command,
  context,
  engagement,
  evidenceRequest,
  expectFailure,
  people,
} from "./test-fixtures";

const grantInput = {
  userId: "contributor",
  requestId: "REQ-1",
  prompt: "Validation population",
  instructions: "Upload the anonymized extract",
  category: "Dataset",
  handlingBasis: "anonymized",
  expiresAt: "2026-12-31T23:59:59.000Z",
};

function withRequest(status: EvidenceRequest["status"] = "open"): Engagement {
  return engagement({
    workflow: approvedWorkflow(),
    evidenceRequests: [evidenceRequest({ status })],
  });
}

function grant(overrides: Partial<ClientGrant> = {}): ClientGrant {
  return {
    ...grantInput,
    handlingBasis: "anonymized",
    id: "GRANT-1",
    active: true,
    actor: "lead",
    at,
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "SUB-1",
    requestId: "REQ-1",
    grantId: "GRANT-1",
    actor: "contributor",
    at,
    evidenceIds: ["evidence"],
    note: "Extract attached",
    delivery: "complete",
    remaining: "",
    ...overrides,
  };
}

function withGrant(g: Partial<ClientGrant> = {}, s: Submission[] = []) {
  const e = withRequest();
  e.workflow!.clientGrants = [grant(g)];
  e.workflow!.submissions = s;
  return e;
}

/** Expects the command to fail with this status and to change nothing. */
async function refused(
  e: Engagement,
  run: () => Promise<unknown>,
  status: number,
  message?: string,
) {
  const before = structuredClone(e);
  await expectFailure(run(), status, message);
  expect(e).toEqual(before);
}

const notLead = ["auditor", "reviewer", "viewer", "contributor"];
const notWriter = ["reviewer", "viewer", "contributor", "quality-reviewer"];

describe("grantClientRequest", () => {
  it("lets a Lead grant a client contributor one outstanding request", async () => {
    const e = withRequest();
    const details = await command(
      e,
      "grantClientRequest",
      { ...grantInput, requestedItems: ["2026 extract"] },
      "lead",
    );
    expect(details).toEqual({ requestId: "REQ-1" });
    expect(e.workflow!.clientGrants).toEqual([
      {
        ...grantInput,
        requestedItems: ["2026 extract"],
        id: expect.stringMatching(/^GRANT-/),
        active: true,
        actor: "lead",
        at,
      },
    ]);
  });

  it.each(notLead)(
    "refuses %s: only a Lead grants client access",
    async (u) => {
      const e = withRequest();
      await refused(
        e,
        () => command(e, "grantClientRequest", grantInput, u),
        403,
        "A Lead Auditor must authorize this decision",
      );
    },
  );

  it.each([
    ["an internal member", "auditor"],
    ["a client viewer", "viewer"],
    ["an unknown person", "nobody"],
  ])("refuses a grant to %s", async (_, userId) => {
    const e = withRequest();
    await refused(
      e,
      () => command(e, "grantClientRequest", { ...grantInput, userId }, "lead"),
      400,
      "Select an active authorized person with the required role",
    );
  });

  it("refuses a grant to a revoked contributor", async () => {
    const e = withRequest();
    await refused(
      e,
      () =>
        workflowCommand(e, "grantClientRequest", grantInput, {
          ...context("lead"),
          member: async (id) =>
            id === "contributor"
              ? { ...people.contributor, status: "revoked" }
              : (people[id] ?? null),
        }),
      400,
      "Select an active authorized person with the required role",
    );
  });

  it("refuses a contributor of another client", async () => {
    const e = withRequest();
    await refused(
      e,
      () =>
        workflowCommand(e, "grantClientRequest", grantInput, {
          ...context("lead"),
          member: async (id) =>
            id === "contributor"
              ? { ...people.contributor, client_id: "other-client" }
              : (people[id] ?? null),
        }),
      400,
      "The contributor must belong to this client",
    );
  });

  it.each(["accepted", "waived"] as const)(
    "refuses a request that is already %s",
    async (status) => {
      const e = withRequest(status);
      await refused(
        e,
        () => command(e, "grantClientRequest", grantInput, "lead"),
        400,
        "Choose an outstanding request from this engagement",
      );
    },
  );

  it("refuses a request of another engagement", async () => {
    const e = withRequest();
    await refused(
      e,
      () =>
        command(
          e,
          "grantClientRequest",
          { ...grantInput, requestId: "REQ-elsewhere" },
          "lead",
        ),
      400,
      "Choose an outstanding request from this engagement",
    );
  });

  it.each([
    ["now", at],
    ["in the past", "2026-11-01T00:00:00.000Z"],
    ["more than a year ahead", "2027-11-07T10:00:00.000Z"],
  ])("refuses access that expires %s", async (_, expiresAt) => {
    const e = withRequest();
    await refused(
      e,
      () =>
        command(e, "grantClientRequest", { ...grantInput, expiresAt }, "lead"),
      400,
      "Access must expire within the next year",
    );
  });

  it("refuses the 201st grant of an engagement", async () => {
    const e = withRequest();
    e.workflow!.clientGrants = Array.from({ length: 200 }, (_, i) =>
      grant({ id: "GRANT-" + i }),
    );
    await refused(
      e,
      () => command(e, "grantClientRequest", grantInput, "lead"),
      413,
      "Request grant limit reached",
    );
  });

  it("refuses an engagement without the structured workflow", async () => {
    const e = engagement({
      evidenceRequests: [evidenceRequest({ status: "open" })],
    });
    await refused(
      e,
      () => command(e, "grantClientRequest", grantInput, "lead"),
      409,
      "Adopt the engagement workflow first",
    );
  });

  it("refuses unknown fields and a handling basis other than synthetic or anonymized", async () => {
    const e = withRequest();
    const before = structuredClone(e);
    await expect(
      command(e, "grantClientRequest", { ...grantInput, extra: 1 }, "lead"),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      command(
        e,
        "grantClientRequest",
        { ...grantInput, handlingBasis: "personal" },
        "lead",
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(e).toEqual(before);
  });
});

describe("updateClientRequest", () => {
  const update = {
    grantId: "GRANT-1",
    prompt: "Population and period",
    instructions: "Use the 2026 data",
  };

  it("revises the instructions and keeps the earlier ones in the history", async () => {
    const e = withGrant({ requestedItems: ["2026 extract"] });
    const details = await command(e, "updateClientRequest", update, "lead");
    expect(details).toEqual({ grantId: "GRANT-1" });
    const g = e.workflow!.clientGrants[0];
    expect(g).toMatchObject({
      prompt: "Population and period",
      instructions: "Use the 2026 data",
      // Items the update leaves out stay as they were.
      requestedItems: ["2026 extract"],
      active: true,
    });
    expect(g.history).toEqual([
      {
        actor: "lead",
        at,
        prompt: "Validation population",
        instructions: "Upload the anonymized extract",
        requestedItems: ["2026 extract"],
      },
    ]);
    await command(
      e,
      "updateClientRequest",
      { ...update, requestedItems: ["Q3 extract"] },
      "lead",
    );
    expect(e.workflow!.clientGrants[0].requestedItems).toEqual(["Q3 extract"]);
    expect(e.workflow!.clientGrants[0].history).toHaveLength(2);
  });

  it.each(notLead)("refuses %s", async (u) => {
    const e = withGrant();
    await refused(
      e,
      () => command(e, "updateClientRequest", update, u),
      403,
      "A Lead Auditor must authorize this decision",
    );
  });

  it("refuses an unknown grant", async () => {
    const e = withGrant();
    await refused(
      e,
      () =>
        command(
          e,
          "updateClientRequest",
          { ...update, grantId: "GRANT-9" },
          "lead",
        ),
      404,
      "Grant not found",
    );
  });

  it.each([
    ["revoked", { active: false }],
    ["expired", { expiresAt: at }],
  ])("refuses a %s grant", async (_, g) => {
    const e = withGrant(g);
    await refused(
      e,
      () => command(e, "updateClientRequest", update, "lead"),
      409,
      "Create a new grant for expired or revoked access",
    );
  });

  it("refuses a grant whose contributor's membership was revoked", async () => {
    const e = withGrant();
    await refused(
      e,
      () =>
        workflowCommand(e, "updateClientRequest", update, {
          ...context("lead"),
          member: async (id) =>
            id === "contributor"
              ? { ...people.contributor, status: "revoked" }
              : (people[id] ?? null),
        }),
      409,
      "This grant lapsed when the contributor's access changed. Assign the request again.",
    );
  });

  it("refuses a 31st revision of the instructions", async () => {
    const e = withGrant({
      history: Array.from({ length: 30 }, () => ({
        actor: "lead",
        at,
        prompt: "Earlier",
        instructions: "Earlier",
      })),
    });
    await refused(
      e,
      () => command(e, "updateClientRequest", update, "lead"),
      413,
      "Instruction revision limit reached",
    );
  });
});

describe("revokeClientRequest", () => {
  const revoke = { grantId: "GRANT-1", reason: "Request answered elsewhere" };

  it("deactivates the grant and records who revoked it and when", async () => {
    const e = withGrant();
    const details = await command(e, "revokeClientRequest", revoke, "lead");
    expect(details).toEqual({
      grantId: "GRANT-1",
      reason: "Request answered elsewhere",
    });
    expect(e.workflow!.clientGrants[0]).toMatchObject({
      active: false,
      revokedAt: at,
      revokedBy: "lead",
    });
  });

  it.each(notLead)("refuses %s", async (u) => {
    const e = withGrant();
    await refused(
      e,
      () => command(e, "revokeClientRequest", revoke, u),
      403,
      "A Lead Auditor must authorize this decision",
    );
  });

  it("refuses an unknown grant", async () => {
    const e = withGrant();
    await refused(
      e,
      () =>
        command(
          e,
          "revokeClientRequest",
          { ...revoke, grantId: "GRANT-9" },
          "lead",
        ),
      404,
      "Grant not found",
    );
  });

  it.each([
    [
      "revoked",
      { active: false, revokedAt: "2026-11-02T00:00:00.000Z", revokedBy: "x" },
    ],
    ["expired", { expiresAt: "2026-11-01T00:00:00.000Z" }],
  ])("refuses a %s grant and keeps its record (#240 item 5)", async (_, g) => {
    const e = withGrant(g);
    await refused(
      e,
      () => command(e, "revokeClientRequest", revoke, "lead"),
      409,
      "This grant is no longer active",
    );
  });

  it("needs a reason", async () => {
    const e = withGrant();
    await expect(
      command(
        e,
        "revokeClientRequest",
        { grantId: "GRANT-1", reason: " " },
        "lead",
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(e.workflow!.clientGrants[0].active).toBe(true);
  });
});

describe("publishClientClarification", () => {
  const clarify = { grantId: "GRANT-1", text: "Please include the period" };

  it.each(["auditor", "lead"])(
    "lets %s add a clarification to the request thread",
    async (u) => {
      const e = withGrant();
      const details = await command(
        e,
        "publishClientClarification",
        clarify,
        u,
      );
      expect(details).toEqual({ grantId: "GRANT-1" });
      expect(e.workflow!.clientGrants[0].communications).toEqual([
        {
          id: expect.stringMatching(/^MSG-/),
          actor: u,
          at,
          kind: "clarification",
          text: "Please include the period",
        },
      ]);
    },
  );

  it.each(notWriter)("refuses %s", async (u) => {
    const e = withGrant();
    await refused(
      e,
      () => command(e, "publishClientClarification", clarify, u),
      403,
      "An Auditor or Lead Auditor must record this audit work",
    );
  });

  it("refuses an unknown assignment", async () => {
    const e = withGrant();
    await refused(
      e,
      () =>
        command(
          e,
          "publishClientClarification",
          { ...clarify, grantId: "GRANT-9" },
          "auditor",
        ),
      404,
      "Request assignment not found",
    );
  });

  it.each([
    ["revoked", { active: false }, "This grant was revoked"],
    [
      "expired",
      { expiresAt: "2026-11-01T00:00:00.000Z" },
      "The client assignment has expired",
    ],
  ])("refuses a %s assignment (#240 item 6)", async (_, g, message) => {
    const e = withGrant(g);
    await refused(
      e,
      () => command(e, "publishClientClarification", clarify, "auditor"),
      409,
      message,
    );
  });

  it("refuses a grant whose contributor was re-granted access since", async () => {
    const e = withGrant();
    await refused(
      e,
      () =>
        workflowCommand(e, "publishClientClarification", clarify, {
          ...context("auditor"),
          member: async (id) =>
            id === "contributor"
              ? {
                  ...people.contributor,
                  access_since: "2026-11-06T09:00:00.000Z",
                }
              : (people[id] ?? null),
        }),
      409,
      "This grant lapsed when the contributor's access changed. Assign the request again.",
    );
  });

  it("refuses the 81st message of a thread", async () => {
    const e = withGrant({
      communications: Array.from({ length: 80 }, (_, i) => ({
        id: "MSG-" + i,
        actor: "auditor",
        at,
        kind: "clarification" as const,
        text: "Earlier",
      })),
    });
    await refused(
      e,
      () => command(e, "publishClientClarification", clarify, "auditor"),
      413,
      "Open a follow-up request to continue this thread",
    );
  });
});

describe("acknowledgeClientSubmission", () => {
  const acknowledge = { submissionId: "SUB-1", note: "Received complete" };

  it("records the receipt of a client submission", async () => {
    const e = withGrant({}, [submission()]);
    const details = await command(
      e,
      "acknowledgeClientSubmission",
      acknowledge,
      "auditor",
    );
    expect(details).toEqual({ submissionId: "SUB-1", requestId: "REQ-1" });
    expect(e.workflow!.submissions[0].receipt).toEqual({
      actor: "auditor",
      at,
      note: "Received complete",
    });
  });

  it.each(notWriter)("refuses %s", async (u) => {
    const e = withGrant({}, [submission()]);
    await refused(
      e,
      () => command(e, "acknowledgeClientSubmission", acknowledge, u),
      403,
      "An Auditor or Lead Auditor must record this audit work",
    );
  });

  it("refuses an unknown submission", async () => {
    const e = withGrant({}, [submission()]);
    await refused(
      e,
      () =>
        command(
          e,
          "acknowledgeClientSubmission",
          { ...acknowledge, submissionId: "SUB-9" },
          "auditor",
        ),
      404,
      "Submission not found",
    );
  });

  it("refuses to acknowledge a package twice", async () => {
    const e = withGrant({}, [
      submission({ receipt: { actor: "lead", at, note: "Received" } }),
    ]);
    await refused(
      e,
      () => command(e, "acknowledgeClientSubmission", acknowledge, "auditor"),
      409,
      "This package is already acknowledged",
    );
  });
});
