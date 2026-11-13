// NYC Local Law 144 bias audits on the command bus (#30): the attestations
// the rule needs, the special-category gate, approval by someone other than
// the preparer, the publishable summary and who can read it.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, Engagement, Report } from "../domain";
import { getEngagement } from "../engagement-repo";
import { sha256 } from "../ids";
import {
  ll144Records,
  oneYearAfter,
  publishableSummary,
  type Ll144Audit,
} from "../ll144-audit";
import { ll144SummaryView } from "../read-models/ll144-summary";
import type { SpecialCategoryBasis } from "../special-category";
import { ll144 } from "./ll144";
import { caller, stored } from "./test-fixtures";

vi.mock("../engagement-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../engagement-repo")>()),
  getEngagement: vi.fn(),
}));

const objects = new Map<string, Uint8Array>();
const bucket = {
  async get(key: string) {
    const bytes = objects.get(key);
    return bytes
      ? { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
      : null;
  },
} as unknown as R2Bucket;

// LL-01 of schemas/fixtures/ll144-golden.json as a dataset, with "Decline"
// as an unknown value and a blank cell.
function cells() {
  const rows: string[] = [];
  const add = (sex: string, race: string, selected: number, n: number) => {
    for (let i = 0; i < n; i++)
      rows.push(`${sex},${race},${i < selected ? "advance" : "reject"}`);
  };
  add("Female", "Asian", 6, 10);
  add("Female", "Black or African American", 3, 10);
  add("Male", "Asian", 8, 10);
  add("Male", "Black or African American", 4, 10);
  add("Decline", "Asian", 2, 5);
  add("Female", "", 1, 5);
  return "gender,race,outcome\n" + rows.join("\n") + "\n";
}

const basis: SpecialCategoryBasis = {
  id: "BASIS-1",
  kind: "gdpr_art9",
  point: "g",
  statement: "Substantial public interest under national equality law",
  columns: ["race"],
  confirmedBy: "Client DPO",
  confirmedOn: "2026-11-01",
  recordedBy: "user-lead",
  recordedAt: "2026-11-02T09:00:00.000Z",
};
const input = {
  datasetId: "EV-1",
  toolName: "Resume screener 4.2",
  distributionDate: "2025-03-01",
  auditDate: "2026-11-01",
  rate: "selection",
  sexColumn: "gender",
  raceEthnicityColumn: "race",
  outcomeColumn: "outcome",
  selectedValues: ["advance"],
  unknownValues: ["Decline"],
  dataSource: {
    kind: "historical",
    source:
      "Applicants screened by the tool for the employer, 2025-03 to 2026-09.",
    explanation:
      "Every applicant the tool assessed; sex and race/ethnicity from the voluntary EEO self-identification form.",
  },
  demographicsNotInferred: true,
  demographicsStatement:
    "Sex and race/ethnicity are the applicants' own answers on the voluntary self-identification form; none was inferred or imputed.",
  acknowledgeHostedProcessing: true,
};

let e: Engagement;
beforeEach(async () => {
  const bytes = new TextEncoder().encode(cells());
  objects.clear();
  objects.set("tenant/applicants.csv", bytes);
  env.BUCKET = bucket;
  e = stored();
  e.artifacts = [
    {
      id: "EV-1",
      name: "applicants.csv",
      category: "Dataset",
      status: "accepted",
      key: "tenant/applicants.csv",
      size: bytes.byteLength,
      sha256: await sha256(bytes.buffer as ArrayBuffer),
    } as Artifact,
  ];
  e.specialCategoryBases = [basis];
});

const run = (op: string, data: Record<string, unknown>, role = "Auditor") =>
  (async () =>
    ll144.run(e, op, data, {
      ...caller(role as never),
      user: {
        userId: role === "Auditor" ? "user-auditor" : "user-reviewer",
        displayName: role,
        email: role + "@fixture.invalid",
      },
    }))();
const refusal = async (promise: unknown) => {
  try {
    await promise;
  } catch (error) {
    return error as { status: number; message: string };
  }
  throw Error("Expected a refusal");
};

describe("computeLl144Audit", () => {
  it("computes the DCWP tables from the mapped dataset and records the attestation", async () => {
    await run("computeLl144Audit", input);
    const audit = e.ll144Audits![0];
    expect(audit.status).toBe("draft");
    expect(audit.createdBy).toBe("user-auditor");
    expect(audit.dataset).toMatchObject({ artifactId: "EV-1", rows: 50 });
    const [sex, race, inter] = audit.result.tables;
    expect(sex.categories.map((c) => [c.category, c.n, c.impactRatio])).toEqual(
      [
        ["Male", 20, 1],
        ["Female", 25, 0.4 / 0.6],
      ],
    );
    expect(sex.unknownCategoryCount).toBe(5);
    expect(race.referenceCategory).toBe("Asian");
    expect(race.unknownCategoryCount).toBe(5);
    expect(inter.unknownCategoryCount).toBe(10);
    // EEO-1 categories with no individuals are listed without a rate.
    expect(race.categories.find((c) => c.category === "White")).toMatchObject({
      n: 0,
      selectionRate: null,
    });
    expect(audit.warnings).toEqual([]);
    expect(audit.limitations[0]).toMatch(
      /^Special-category column race was processed on the platform under GDPR Art 9\(2\)\(g\)/,
    );
  });

  it("refuses test data without the explanations 5-302(b) requires", async () => {
    const error = await refusal(
      run("computeLl144Audit", {
        ...input,
        dataSource: { ...input.dataSource, kind: "test" },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/why historical data was not used/);
  });

  it("refuses inferred or imputed demographic data", async () => {
    const error = await refusal(
      run("computeLl144Audit", { ...input, demographicsNotInferred: false }),
    );
    expect(error.message).toMatch(/none was inferred or imputed/);
  });

  it("needs the client's basis and an acknowledgement for a special-category column", async () => {
    e.specialCategoryBases = [];
    expect((await refusal(run("computeLl144Audit", input))).message).toMatch(
      /Record the client's basis for it/,
    );
    e.specialCategoryBases = [basis];
    expect(
      (
        await refusal(
          run("computeLl144Audit", {
            ...input,
            acknowledgeHostedProcessing: false,
          }),
        )
      ).message,
    ).toMatch(/^Acknowledge that this audit processes/);
  });

  it("refuses a future audit date and an exclusion of 2% or more", async () => {
    expect(
      (
        await refusal(
          run("computeLl144Audit", { ...input, auditDate: "2999-01-01" }),
        )
      ).message,
    ).toMatch(/future/);
    expect(
      (
        await refusal(
          run("computeLl144Audit", {
            ...input,
            exclusions: [
              {
                dimension: "sex",
                category: "Female",
                justification: "small",
              },
            ],
          }),
        )
      ).message,
    ).toMatch(/2% exclusion only allowed below 2%/);
  });

  it("warns about values that are not EEO-1 categories", async () => {
    await run("computeLl144Audit", { ...input, unknownValues: [] });
    expect(e.ll144Audits![0].warnings[0]).toMatch(
      /^Sex values that are not EEO-1 categories: Decline/,
    );
  });
});

describe("ll144Records", () => {
  const rows = [
    { s: "Female", r: "Asian", score: "0.7" },
    { s: "Male", r: "White", score: "x" },
  ];
  const mapping = {
    rate: "scoring" as const,
    sexColumn: "s",
    raceEthnicityColumn: "r",
    scoreColumn: "score",
    unknownValues: [],
  };
  it("reads scores and refuses one that is not a number", () => {
    expect(ll144Records(rows.slice(0, 1), mapping)).toEqual([
      { sex: "Female", raceEthnicity: "Asian", score: 0.7 },
    ]);
    expect(() => ll144Records(rows, mapping)).toThrow(
      /Row 3 score is not a number/,
    );
    expect(() =>
      ll144Records(rows, { ...mapping, scoreColumn: "r", sexColumn: "r" }),
    ).toThrow(/distinct/);
  });
});

describe("approveLl144Audit and the publishable summary", () => {
  it("is approved by someone other than the preparer", async () => {
    await run("computeLl144Audit", input);
    const auditId = e.ll144Audits![0].id;
    const self = await refusal(
      (async () =>
        ll144.run(
          e,
          "approveLl144Audit",
          { auditId },
          {
            ...caller("Lead Auditor"),
            user: {
              userId: "user-auditor",
              displayName: "A",
              email: "a@x.invalid",
            },
          },
        ))(),
    );
    expect(self.message).toMatch(/preparer cannot approve/);
    await run("approveLl144Audit", { auditId }, "Reviewer");
    expect(e.ll144Audits![0]).toMatchObject({
      status: "approved",
      approvedBy: "user-reviewer",
    });
    expect(
      (await refusal(run("approveLl144Audit", { auditId }, "Reviewer"))).status,
    ).toBe(409);
  });

  it("states every element 6 RCNY 5-303 requires, with its dates, and no user id", async () => {
    await run("computeLl144Audit", {
      ...input,
      dataSource: {
        ...input.dataSource,
        kind: "test",
        whyNotHistorical: "The tool has assessed 40 applicants so far.",
        testDataGeneration: "Synthetic profiles from the vendor's test bank.",
      },
    });
    const audit = e.ll144Audits![0] as Ll144Audit;
    const summary = publishableSummary(audit);
    expect(summary.requiredElements.map((r) => r.element)).toEqual([
      "Date of the most recent bias audit",
      "Source and explanation of the data used",
      "Number of individuals assessed",
      "Number of individuals in an unknown category",
      "Selection rates and impact ratios for all categories",
      "Distribution date of the AEDT",
    ]);
    expect(summary.requiredElements[0].value).toBe("2026-11-01");
    expect(summary.requiredElements.at(-1)!.value).toBe("2025-03-01");
    expect(summary.requiredElements[1].value).toMatch(
      /Why historical data was not used: The tool has assessed 40/,
    );
    expect(summary.useAllowedUntil).toBe("2027-11-01");
    expect(summary.unknownCategoryCounts).toEqual({
      sex: 5,
      raceEthnicity: 5,
      intersectional: 10,
    });
    expect(summary.legalReview).toBe("pending");
    const text = JSON.stringify(summary);
    for (const secret of ["user-auditor", "tenant/applicants.csv", "EV-1"])
      expect(text).not.toContain(secret);
    expect(oneYearAfter("2026-02-28")).toBe("2027-02-28");
  });

  it("lists excluded categories with their justification, count and rate", async () => {
    const big =
      "gender,race,outcome\n" +
      Array.from({ length: 60 }, (_, i) =>
        i === 0
          ? "Male,Two or More Races,advance"
          : `Male,Asian,${i % 2 ? "advance" : "reject"}`,
      ).join("\n");
    const bytes = new TextEncoder().encode(big);
    objects.set("tenant/applicants.csv", bytes);
    Object.assign(e.artifacts[0], {
      size: bytes.byteLength,
      sha256: await sha256(bytes.buffer as ArrayBuffer),
    });
    await run("computeLl144Audit", {
      ...input,
      exclusions: [
        {
          dimension: "raceEthnicity",
          category: "Two or More Races",
          justification: "1 of 60 individuals (1.67%).",
        },
      ],
    });
    const summary = publishableSummary(e.ll144Audits![0]);
    expect(summary.exclusions).toEqual([
      {
        dimension: "raceEthnicity",
        category: "Two or More Races",
        justification: "1 of 60 individuals (1.67%).",
        n: 1,
        rate: 1,
      },
    ]);
    expect(summary.requiredElements.map((r) => r.rule)).toContain(
      "6 RCNY § 5-301(d)",
    );
  });
});

describe("ll144SummaryView", () => {
  it("shows the team the live audit and a client only a released report's summary", async () => {
    await run("computeLl144Audit", input);
    const audit = e.ll144Audits![0];
    vi.mocked(getEngagement).mockResolvedValue(e);
    const live = await ll144SummaryView(
      caller("Auditor"),
      e.id,
      audit.id,
      null,
    );
    expect(live).toMatchObject({
      source: "live",
      summary: { status: "draft" },
    });
    const client = { ...caller("Client Viewer" as never), clientId: "CL-1" };
    expect(
      (await refusal(ll144SummaryView(client, e.id, audit.id, null))).status,
    ).toBe(404);
    const summary = publishableSummary({ ...audit, status: "approved" });
    e.reports = [
      {
        id: "REPORT-1",
        kind: "final",
        createdAt: "2026-11-05T10:00:00.000Z",
        actor: "user-lead",
        sha256: "a".repeat(64),
        snapshot: { ll144Summaries: [summary] },
        clientSnapshot: { ll144Summaries: [summary] },
        clientSha256: "b".repeat(64),
        release: { state: "internal", history: [] },
      } as unknown as Report,
    ];
    // Not released: the client cannot read it.
    expect(
      (await refusal(ll144SummaryView(client, e.id, audit.id, "REPORT-1")))
        .status,
    ).toBe(404);
    const team = await ll144SummaryView(
      caller("Auditor"),
      e.id,
      audit.id,
      "REPORT-1",
    );
    expect(team).toMatchObject({ source: "report", reportId: "REPORT-1" });
  });
});
