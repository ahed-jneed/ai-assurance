// What the workspace routes store for the workflow: recovery drafts of
// procedure forms (app/api/workspace-state) and engagement writes near the
// 1.5 MB metadata limit and the approval reserve kept under it
// (app/api/workspace through lib/engagement-repo.ts).
// Identity is faked; D1 is an in-memory stand-in for one engagement row and
// the recovery drafts.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as workspace } from "@/app/api/workspace/route";
import {
  GET as readDraft,
  POST as saveDraft,
} from "@/app/api/workspace-state/route";
import type { Engagement } from "@/lib/domain";
import { getEngagement } from "@/lib/engagement-repo";
import { dehydrate } from "@/lib/engagement-storage";
import { context, type Context } from "@/lib/tenancy";
import {
  approvalReserve,
  metadataLimit,
  procedureDraftRevision,
} from "@/lib/workflow-state";
import type { DraftKind } from "@/lib/workspace-state";
import { postRequest } from "../commands/test-fixtures";
import {
  approveProgram,
  artifact,
  briefInput,
  people,
  planSave,
  procedureId,
  procedureOf,
  structuredEngagement,
  workflowOf,
} from "./test-fixtures";

vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));

const tenantId = "tenant-1";
/** A practice member of the workflow fixtures, signed in. */
function signIn(userId: string): Context {
  const ctx = {
    user: { userId, displayName: userId, email: userId + "@fixture.invalid" },
    tenantId,
    role: people[userId].role,
    clientId: null,
  };
  vi.mocked(context).mockResolvedValue(ctx);
  return ctx;
}

type Draft = {
  body: string;
  base_revision: string;
  version: number;
  updated_at: string;
};
/**
 * D1 holding the engagement row and recovery drafts. A batch applies the
 * engagement update when the version it expects is still stored, like the
 * guarded update it stands for, and is recorded by the tables it writes.
 */
function storage(e: Engagement) {
  const row = { body: JSON.stringify(e), version: e.version };
  const drafts = new Map<string, Draft>(),
    batches: string[][] = [];
  const draftKey = (args: unknown[]) => args.join("|");
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...bound: unknown[]) => statement(sql, bound),
    async first() {
      if (sql.startsWith("SELECT body,version,client_id FROM engagements"))
        return { ...row, client_id: e.clientId };
      if (sql.startsWith("SELECT 1 FROM engagement_access")) return { 1: 1 };
      if (sql.startsWith("SELECT COUNT(*) AS n FROM engagement_snapshots"))
        return { n: 0 };
      if (sql.startsWith("SELECT m.role,m.client_id,m.status FROM memberships"))
        return people[String(args[1])] ?? null;
      if (sql.startsWith("SELECT body,base_revision,version,updated_at"))
        return drafts.get(draftKey(args)) ?? null;
      throw new Error("Unexpected query: " + sql);
    },
    async run() {
      if (sql.startsWith("INSERT OR IGNORE INTO workspace_drafts")) {
        const key = draftKey(args.slice(0, 5));
        if (drafts.has(key)) return { meta: { changes: 0 } };
        drafts.set(key, {
          base_revision: String(args[5]),
          body: String(args[6]),
          version: 1,
          updated_at: String(args[7]),
        });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE workspace_drafts")) {
        const key = draftKey(args.slice(3, 8)),
          draft = drafts.get(key);
        if (!draft || draft.version !== args[8])
          return { meta: { changes: 0 } };
        drafts.set(key, {
          body: String(args[0]),
          base_revision: String(args[1]),
          version: draft.version + 1,
          updated_at: String(args[2]),
        });
        return { meta: { changes: 1 } };
      }
      throw new Error("Unexpected write: " + sql);
    },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: ReturnType<typeof statement>[]) {
      batches.push(
        statements.map((s) => /(?:INTO|UPDATE) (\w+)/.exec(s.sql)?.[1] ?? ""),
      );
      const [update] = statements,
        applies =
          update.sql.startsWith("UPDATE engagements") &&
          update.args[6] === row.version;
      if (applies) {
        row.body = String(update.args[0]);
        row.version = Number(update.args[2]);
      }
      return statements.map(() => ({ meta: { changes: applies ? 1 : 0 } }));
    },
  };
  env.DB = db as unknown as D1Database;
  return { row, drafts, batches };
}
/** The engagement as stored, loaded as the workspace route loads it. */
const stored = (e: Engagement) => getEngagement(signIn("lead"), e.id);
/** A workspace command by `userId` against the stored engagement version. */
async function act(
  e: Engagement,
  userId: string,
  op: string,
  data: Record<string, unknown>,
) {
  const { version } = await stored(e);
  signIn(userId);
  return workspace(
    postRequest("/api/workspace", {
      tenantId,
      engagementId: e.id,
      expectedVersion: version,
      op,
      data,
    }),
  );
}

afterEach(() => {
  delete env.DB;
  vi.resetAllMocks();
});

describe("recovery drafts of procedure forms", () => {
  /** The draft scope the audit program's form opens with. */
  const scope = (e: Engagement, kind: DraftKind) => ({
    tenantId,
    engagementId: e.id,
    kind,
    recordId: procedureId,
    baseRevision: procedureDraftRevision(
      workflowOf(e),
      procedureOf(e, procedureId),
      kind,
    ),
  });
  type Scope = ReturnType<typeof scope>;
  async function read(draft: Scope) {
    const response = await readDraft(
      new Request(
        "https://workspace.test/api/workspace-state?" +
          new URLSearchParams(draft),
      ),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { draft: unknown }).draft;
  }
  const write = (
    draft: Scope,
    expectedVersion: number,
    content: Record<string, string>,
  ) =>
    saveDraft(
      postRequest("/api/workspace-state", {
        ...draft,
        expectedVersion,
        content,
      }),
    );

  it("stops offering a plan draft once another Lead reassigns the work", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    storage(e);
    // The Lead's open plan and execution forms keep recovery copies.
    signIn("lead");
    const plan = scope(e, "procedure-plan"),
      execution = scope(e, "procedure-execution"),
      unsaved = { sampling: "Stratified sample of 40", dueDate: "2026-11-30" };
    expect((await write(plan, 0, unsaved)).status).toBe(200);
    expect(
      (await write(execution, 0, { performed: "Inspected lineage records" }))
        .status,
    ).toBe(200);
    expect(await read(plan)).toMatchObject({ current: true, version: 1 });
    // Another Lead moves the due date, which leaves the plan revision as it
    // was.
    const moved = await act(e, "second-lead", "bulkPlanProcedures", {
      procedureIds: [procedureId],
      patch: { dueDate: "2026-12-15" },
    });
    expect(moved.status).toBe(200);
    const reassigned = await stored(e);
    expect(procedureOf(reassigned, procedureId)).toMatchObject({
      revision: procedureOf(e, procedureId).revision,
      dueDate: "2026-12-15",
    });
    // Restoring the plan draft would bring back the earlier due date, so it
    // is no longer offered, and the open form cannot save over it.
    signIn("lead");
    expect(await read(plan)).toMatchObject({
      current: false,
      baseRevision: plan.baseRevision,
      content: unsaved,
    });
    const refused = await write(plan, 1, unsaved);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error:
        "The source changed. Your recovery draft remains available; compare it with the saved revision.",
    });
    // The execution draft holds no assignment and stays current.
    expect(await read(execution)).toMatchObject({ current: true });
    // A plan form opened now replaces the recovery copy.
    const reopened = scope(reassigned, "procedure-plan");
    expect(reopened.baseRevision).not.toBe(plan.baseRevision);
    expect(
      (await write(reopened, 1, { ...unsaved, dueDate: "2026-12-15" })).status,
    ).toBe(200);
    expect(await read(reopened)).toMatchObject({ current: true, version: 2 });
  });
});

describe("the engagement metadata limit", () => {
  const tooLarge =
    "This change would take the engagement record over its 1.5 MB limit. Nothing was saved. Shorten the text you are adding, or continue in a follow-up engagement.";
  const reserveRefusal =
    "This change would need the engagement scope or audit program to be approved, but would leave less than the 100 KB that approval needs under the engagement's 1.5 MB limit. Nothing was saved, and the scope and program stay as they were. Continue in a follow-up engagement.";
  /** The bytes save() would store for the engagement as it is now. */
  const size = async (e: Engagement) =>
    new TextEncoder().encode(JSON.stringify(await dehydrate(signIn("lead"), e)))
      .byteLength;
  /**
   * An engagement with an approved scope and program whose earlier approval
   * cycles fill the record to `room` bytes (plus less than one history entry)
   * under the limit. Approval cycles count towards no history limit: each
   * submission and approval binds the plan revision and hash of every
   * procedure.
   */
  async function filled(room: number) {
    const e = structuredEngagement({ artifacts: [artifact()] });
    await approveProgram(e);
    const program = workflowOf(e).program,
      cycle = program.history,
      padding: typeof cycle = [];
    for (let bytes = await size(e), i = 0; ; i++) {
      const entry = { ...cycle[i % 2], revision: Math.floor(i / 2) + 1 },
        added = JSON.stringify(entry).length + 1;
      if (bytes + added > metadataLimit - room) break;
      padding.push(entry);
      bytes += added;
    }
    const revision = padding.at(-1)!.revision + 1;
    program.history = [...padding, ...cycle.map((h) => ({ ...h, revision }))];
    program.revision = revision;
    program.approval = { ...program.approval!, revision };
    const left = metadataLimit - (await size(e));
    expect(left).toBeGreaterThanOrEqual(room - 1_000);
    expect(left).toBeLessThan(room + 6_000);
    return { e, d1: storage(e), revision, approval: program.approval };
  }
  const resample = (e: Engagement, sampling = "Stratified sample of 40") =>
    planSave(e, { dueDate: "2026-12-15", sampling });
  const json = async (response: Response) =>
    (await response.json()) as { error?: string };

  it("refuses the write that would exceed it, stores nothing and keeps the approved program in force", async () => {
    const { e, d1, revision, approval } = await filled(2_000);
    // A due-date change still fits and is stored with its snapshot and
    // audit event in one batch.
    const moved = await act(e, "lead", "saveProcedurePlan", {
      ...planSave(e, { dueDate: "2026-12-15" }),
    });
    expect(moved.status).toBe(200);
    expect(d1.batches).toEqual([
      ["engagements", "engagement_snapshots", "audit_events"],
    ]);
    const before = { ...d1.row },
      approved = await stored(e);
    // A sampling change would return the approved program to draft, and
    // its longer plan takes the record over the limit: it is refused before
    // anything is written.
    const resampled = await act(e, "lead", "saveProcedurePlan", {
      ...planSave(approved, {
        dueDate: "2026-12-15",
        population: "Every 2026 training and validation dataset. ".repeat(170),
        sampling: "Stratified by data source and month. ".repeat(200),
      }),
    });
    expect(resampled.status).toBe(413);
    expect(await json(resampled)).toEqual({ error: tooLarge });
    expect(d1.batches).toHaveLength(1);
    expect(d1.row).toEqual(before);
    // The approved scope, program and plan stay in force as they were.
    const kept = await stored(e);
    expect(kept.workflow).toEqual(approved.workflow);
    expect(workflowOf(kept).brief?.status).toBe("approved");
    expect(workflowOf(kept).program).toMatchObject({
      status: "approved",
      revision,
      approval,
    });
    expect(procedureOf(kept, procedureId)).toMatchObject({
      dueDate: "2026-12-15",
      sampling: procedureOf(e, procedureId).sampling,
      planHash: procedureOf(e, procedureId).planHash,
    });
  });

  it("refuses, near the limit, a change that the reviewer could not approve, and keeps the approval in force", async () => {
    // A few kilobytes would fit the change, but not its submission and
    // approval, which bind every procedure.
    const { e, d1, approval } = await filled(6_000);
    const approved = await stored(e);
    const resampled = await act(
      e,
      "lead",
      "saveProcedurePlan",
      resample(approved),
    );
    expect(resampled.status).toBe(413);
    expect(await json(resampled)).toEqual({ error: reserveRefusal });
    // A change to the approved scope is refused the same way.
    const rescoped = await act(e, "lead", "saveBrief", {
      ...briefInput,
      boundary: "Scoring service, decision support and appeals",
      changeImpact: "Appeals handling is now in scope",
    });
    expect(rescoped.status).toBe(413);
    expect(await json(rescoped)).toEqual({ error: reserveRefusal });
    expect(d1.batches).toEqual([]);
    // The approved scope and program stay in force, so execution goes on.
    const kept = await stored(e);
    expect(kept.workflow).toEqual(approved.workflow);
    expect(workflowOf(kept).program).toMatchObject({
      status: "approved",
      approval,
    });
    // Changes that need no approval still fit.
    const moved = await act(e, "lead", "saveProcedurePlan", {
      ...planSave(kept, { dueDate: "2026-12-16" }),
    });
    expect(moved.status).toBe(200);
  });

  it("lets a cycle started with the reserve free complete inside it", async () => {
    // Just over the reserve is left: the change fits with the reserve free,
    // and its submission, return, resubmission and approval go into it.
    const { e, d1 } = await filled(approvalReserve + 600);
    const changed = await act(
      e,
      "lead",
      "saveProcedurePlan",
      resample(await stored(e)),
    );
    expect(changed.status).toBe(200);
    expect(workflowOf(await stored(e)).program.status).toBe("draft");
    expect((await act(e, "auditor", "submitProgram", {})).status).toBe(200);
    const submitted = await stored(e);
    expect(metadataLimit - d1.row.body.length).toBeLessThan(approvalReserve);
    // Inside the reserve, the Lead cannot withdraw the submission with a
    // further change, which would start another cycle...
    const withdrawn = await act(
      e,
      "lead",
      "saveProcedurePlan",
      resample(submitted, "All 12 datasets"),
    );
    expect(withdrawn.status).toBe(413);
    expect(await json(withdrawn)).toEqual({ error: reserveRefusal });
    // ...but the reviewer can return it, the preparers can amend and
    // resubmit it, and the reviewer can approve it.
    expect(
      (
        await act(e, "reviewer", "returnProgram", {
          reason: "Size the sample to the population",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await act(
          e,
          "lead",
          "saveProcedurePlan",
          resample(await stored(e), "Stratified sample of 60"),
        )
      ).status,
    ).toBe(200);
    expect((await act(e, "auditor", "submitProgram", {})).status).toBe(200);
    const resubmitted = workflowOf(await stored(e)).program;
    const decided = await act(e, "reviewer", "approveProgram", {
      revision: resubmitted.revision,
      reason: "Program agreed",
    });
    expect(decided.status).toBe(200);
    const done = await stored(e);
    expect(workflowOf(done).program).toMatchObject({
      status: "approved",
      revision: resubmitted.revision,
    });
    expect(procedureOf(done, procedureId).sampling).toBe(
      "Stratified sample of 60",
    );
    // The next change would need another approval, which no longer fits.
    const again = await act(
      e,
      "lead",
      "saveProcedurePlan",
      resample(done, "All 12 datasets"),
    );
    expect(again.status).toBe(413);
    expect(await json(again)).toEqual({ error: reserveRefusal });
  });
});
