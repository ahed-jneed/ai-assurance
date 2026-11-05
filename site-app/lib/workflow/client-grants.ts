// Client request commands: time-limited grants that let a client
// contributor answer one evidence request, their instructions and
// clarifications, and the acknowledgement of what the client submitted.
import { z } from "zod";
import { fail, short, text, type WorkflowHandler } from "./command";
export const clientGrantCommands: Record<string, WorkflowHandler> = {
  async grantClientRequest({ e, c, lead, authorized, w }, data) {
    lead();
    const a = z
        .object({
          userId: short,
          requestId: short,
          prompt: text,
          instructions: text,
          category: z.enum([
            "Dataset",
            "Model",
            "Training log",
            "Validation",
            "Pipeline code",
            "Governance",
            "Instructions",
            "Oversight",
            "Security",
            "Other",
          ]),
          handlingBasis: z.enum(["synthetic", "anonymized"]),
          expiresAt: z.string().datetime(),
          requestedItems: z.array(short).max(30).optional(),
        })
        .strict()
        .parse(data),
      member = await authorized(a.userId, ["Client Contributor"]);
    if (member.client_id !== e.clientId)
      fail(400, "The contributor must belong to this client");
    if (
      !e.evidenceRequests?.some(
        (r) =>
          r.id === a.requestId && !["accepted", "waived"].includes(r.status),
      )
    )
      fail(400, "Choose an outstanding request from this engagement");
    if (
      Date.parse(a.expiresAt) <= Date.parse(c.at) ||
      Date.parse(a.expiresAt) > Date.parse(c.at) + 366 * 86400000
    )
      fail(400, "Access must expire within the next year");
    const x = w();
    if (x.clientGrants.length >= 200) fail(413, "Request grant limit reached");
    x.clientGrants.push({
      ...a,
      id: c.id("GRANT"),
      active: true,
      actor: c.userId,
      at: c.at,
    });
    return { requestId: a.requestId };
  },
  async updateClientRequest({ c, lead, w }, data) {
    lead();
    const a = z
        .object({
          grantId: short,
          prompt: text,
          instructions: text,
          requestedItems: z.array(short).max(30).optional(),
        })
        .strict()
        .parse(data),
      g =
        w().clientGrants.find((g) => g.id === a.grantId) ??
        fail(404, "Grant not found");
    if (!g.active || Date.parse(g.expiresAt) <= Date.parse(c.at))
      fail(409, "Create a new grant for expired or revoked access");
    g.history ??= [];
    if (g.history.length >= 30) fail(413, "Instruction revision limit reached");
    g.history.push({
      actor: c.userId,
      at: c.at,
      prompt: g.prompt,
      instructions: g.instructions,
      requestedItems: g.requestedItems ? [...g.requestedItems] : undefined,
    });
    g.prompt = a.prompt;
    g.instructions = a.instructions;
    if (a.requestedItems) g.requestedItems = a.requestedItems;
    return { grantId: g.id };
  },
  async revokeClientRequest({ c, lead, w }, data) {
    lead();
    const a = z.object({ grantId: short, reason: text }).strict().parse(data),
      g =
        w().clientGrants.find((g) => g.id === a.grantId) ??
        fail(404, "Grant not found");
    g.active = false;
    g.revokedAt = c.at;
    g.revokedBy = c.userId;
    return { grantId: g.id, reason: a.reason };
  },
  async publishClientClarification({ c, writer, w }, data) {
    writer();
    const a = z.object({ grantId: short, text: text }).strict().parse(data),
      g =
        w().clientGrants.find((g) => g.id === a.grantId) ??
        fail(404, "Request assignment not found");
    if (!g.active || Date.parse(g.expiresAt) <= Date.parse(c.at))
      fail(409, "The client assignment has expired");
    g.communications ??= [];
    if (g.communications.length >= 80)
      fail(413, "Open a follow-up request to continue this thread");
    g.communications.push({
      id: c.id("MSG"),
      actor: c.userId,
      at: c.at,
      kind: "clarification",
      text: a.text,
    });
    return { grantId: g.id };
  },
  async acknowledgeClientSubmission({ c, writer, w }, data) {
    writer();
    const a = z
        .object({ submissionId: short, note: text })
        .strict()
        .parse(data),
      s =
        w().submissions.find((s) => s.id === a.submissionId) ??
        fail(404, "Submission not found");
    if (s.receipt) fail(409, "This package is already acknowledged");
    s.receipt = { actor: c.userId, at: c.at, note: a.note };
    return { submissionId: s.id, requestId: s.requestId };
  },
};
