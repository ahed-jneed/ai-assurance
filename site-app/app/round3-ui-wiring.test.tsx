// Round-3 UI fixes (#221), as the components render them: the execution
// requests and the Cancel execution options name a GenAI ingest job by its
// plan, the Access log row says how many expired invitations a re-invitation
// replaced, and the GenAI result card and Queue ingest dialog use the shared
// labels. The helpers themselves are in genai-ingest-labels.test.ts and
// round3-ui.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccessLogPage } from "@/lib/read-models/access-log";
import type { GenaiView } from "@/lib/read-models/genai-view";
import { AccessLog } from "./access-log";
import { ExecutionSection } from "./assurance-workbench/execution-section";
import {
  activeJobOptions,
  type Engagement,
  type Snapshot,
} from "./assurance-workbench/types";
import { queueIngestFields, ResultCard } from "./genai-evidence";
import { stamp } from "./genai-ingest-labels";
import type { WorkspaceData } from "./workspace-types";

// The Access log reads its page through the query cache; here it is given.
const page = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/hooks/use-assurance-query", () => ({
  useAssuranceQuery: () => ({
    data: page.current,
    error: "",
    loading: false,
    fetching: false,
    reload: async () => {},
  }),
}));
// The execution planner is covered elsewhere and needs a full engagement.
vi.mock("./testing-readiness", () => ({ ExecutionPlanner: () => null }));

const noop = () => {};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const procedures = [
  { id: "PRC-1", templateId: "WP-GA-01", title: "Accuracy of answers" },
];
const job = (over: Partial<Snapshot["jobs"][number]>) =>
  ({
    id: "JOB-1",
    state: "queued",
    mode: "genai_ingest",
    system_name: null,
    // Cancelled-and-requeued fences move on; the row shows real attempts (#233).
    fence: 2,
    attempts: 1,
    created_at: "2026-11-05T09:00:00.000Z",
    model_format: null,
    positive_label: null,
    negative_label: null,
    decision_threshold: null,
    prediction_kind: null,
    error: null,
    procedure_id: "PRC-1",
    plan_criteria: 2,
    plan_created_at: "2026-11-03T09:15:00.000Z",
    ...over,
  }) as Snapshot["jobs"][number];
const ingest = job({}),
  tabular = job({
    id: "JOB-2",
    state: "running",
    mode: "auditor_model",
    system_name: "Credit model",
    procedure_id: null,
    plan_criteria: null,
    plan_created_at: null,
  }),
  finished = job({ id: "JOB-3", state: "succeeded" });
const planName = `WP-GA-01 Accuracy of answers · 2 criteria · ${stamp("2026-11-03T09:15:00.000Z")}`;

describe("the execution requests name a GenAI ingest job by its plan", () => {
  it("shows the plan label and 'GenAI ingest', never null", () => {
    const out = text(
      renderToStaticMarkup(
        <ExecutionSection
          snapshot={
            {
              jobs: [ingest, tabular],
              workers: [],
              telemetry: { total: 2, queued: 1, running: 1, stalled: 0 },
            } as unknown as Snapshot
          }
          records={[]}
          engagement={{ workflow: { procedures } } as unknown as Engagement}
          role="Lead Auditor"
          writer
          busy={false}
          open={noop}
          act={async () => ({}) as never}
          onSystems={noop}
          onNavigate={noop}
          onHosted={noop}
          onCompiled={noop}
        />,
      ),
    );
    expect(out).toContain(planName + " GenAI ingest · 1 attempt");
    expect(out).toContain("Credit model Auditor model · 1 attempt");
    expect(out).not.toContain("attempt 2");
    expect(out).not.toContain("null");
  });

  it("names the queued and running jobs alike in the Cancel execution options", () => {
    expect(activeJobOptions([ingest, tabular, finished], procedures)).toEqual([
      { value: "JOB-1", label: planName + " · JOB-1" },
      { value: "JOB-2", label: "Credit model · JOB-2" },
    ]);
  });
});

describe("the Access log row of a re-invitation", () => {
  it("says how many expired invitations it replaced", () => {
    const event = (
      id: string,
      details: Record<string, unknown> | null,
    ): AccessLogPage["events"][number] => ({
      id,
      created_at: "2026-11-05T09:00:00.000Z",
      action: "inviteMember",
      actor: "lead",
      actor_name: "Lena Lead",
      subject: null,
      subject_name: "new@client.test",
      role: "Auditor",
      details,
    });
    page.current = {
      events: [
        event("EV-1", { expiredInvitations: ["INV-1", "INV-2"] }),
        event("EV-2", { email: "new@client.test" }),
      ],
      next: null,
      actors: [],
      people: [],
      actions: [],
    } satisfies AccessLogPage;
    const out = text(
      renderToStaticMarkup(
        <AccessLog
          data={
            {
              tenantId: "t-1",
              managementVersion: 1,
            } as unknown as WorkspaceData
          }
        />,
      ),
    );
    expect(out).toContain(
      "Invitation sent (replaced 2 expired invitations) Lena Lead",
    );
    expect(out.match(/Invitation sent /g)).toHaveLength(2);
  });
});

describe("the GenAI result card and the Queue ingest dialog", () => {
  it("counts one member in the singular in the result card", () => {
    const member = (memberId: string) => ({
      memberId,
      metric: "accuracy",
      n: 30,
      estimate: 0.9,
      interval: null,
      se: null,
      status: "ok",
      reasons: [],
    });
    const criterion = (id: string, members: unknown[], omitted?: number) => ({
      id,
      kind: "genai_mean",
      role: "primary",
      outcome: "pass",
      sampleSize: 30,
      pValue: null,
      adjustedPValue: null,
      reasons: [],
      members,
      membersOmitted: omitted,
    });
    const result = {
      id: "AS-result",
      artifactId: "ART-1",
      createdAt: "2026-11-05T09:00:00.000Z",
      custody: "worker",
      attested: false,
      summary: {
        computationSha256: "a".repeat(64),
        origin: "auditee_supplied",
        engine: { version: "1.4.0" },
        overallOutcome: "pass",
        criteria: [
          criterion("C1", [member("m1")]),
          criterion("C2", [member("m1"), member("m2")], 3),
        ],
        runs: [],
        inputs: [],
      },
      readiness: {
        effectiveLevel: "L2",
        blockers: [],
        claimScope: [],
        pendingAcknowledgements: [],
        runs: [],
      },
    } as unknown as GenaiView["results"][number];
    const out = renderToStaticMarkup(
      <ResultCard
        result={result}
        reviewer={false}
        busy={false}
        onAcknowledge={noop}
      />,
    );
    expect(out).toContain("<summary>C1: 1 member</summary>");
    expect(out).toContain(
      "<summary>C2: 2 members (3 more in the computation)</summary>",
    );
  });

  it("offers same-day plans and bundles by distinct labels", () => {
    const plan = (id: string, createdAt: string) => ({
      id,
      createdAt,
      actor: "lead",
      procedureId: "PRC-1",
      plan: { criteria: [{}, {}] },
    });
    const bundle = (id: string, createdAt: string) => ({
      id,
      createdAt,
      actor: "lead",
      origin: "auditee_supplied",
      inputs: [{ name: "judged_qa_30.eval" }],
      inputArtifactIds: ["ART-1"],
    });
    const fields = queueIngestFields(procedures, {
      plans: [
        plan("AS-plan-aaaaaa", "2026-11-03T09:15:00.000Z"),
        plan("AS-plan-bbbbbb", "2026-11-03T09:15:30.000Z"),
        plan("AS-plan-cccccc", "2026-11-03T14:02:00.000Z"),
      ],
      bundles: [
        bundle("AS-bun-111111", "2026-11-03T09:15:00.000Z"),
        bundle("AS-bun-333333", "2026-11-03T09:15:45.000Z"),
        bundle("AS-bun-222222", "2026-11-03T10:40:00.000Z"),
      ],
    });
    const options = Object.fromEntries(
      fields.map((f) => [f.name, f.options!.map((o) => o.label)]),
    );
    expect(options).toEqual({
      procedureId: ["WP-GA-01 · Accuracy of answers"],
      planRecordId: [
        planName + " · aaaaaa",
        planName + " · bbbbbb",
        `WP-GA-01 Accuracy of answers · 2 criteria · ${stamp("2026-11-03T14:02:00.000Z")}`,
      ],
      bundleRecordId: [
        `judged_qa_30.eval · ${stamp("2026-11-03T09:15:00.000Z")} · 111111`,
        `judged_qa_30.eval · ${stamp("2026-11-03T09:15:00.000Z")} · 333333`,
        `judged_qa_30.eval · ${stamp("2026-11-03T10:40:00.000Z")}`,
      ],
    });
  });
});
