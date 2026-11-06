// The special-category gate (#60, D-11): column detection, the recorded
// basis, the upload gate on POST /api/evidence with its audit trail, and
// the report limitation. Hosted and external runs are tested in
// evaluation-service.test.ts.
import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as upload } from "@/app/api/evidence/route";
import { POST as workspace } from "@/app/api/workspace/route";
import { caller, postRequest, stored } from "./commands/test-fixtures";
import type { Engagement, EvaluationProfile, Run } from "./domain";
import { ApiError } from "./http";
import {
  basisInputSchema,
  csvHeader,
  namesSpecialCategory,
  normalizeColumn,
  specialCategoryLimitations,
  specialColumns,
  uploadGate,
  uploadHeader,
  type SpecialCategoryBasis,
} from "./special-category";
import { context } from "./tenancy";
import { sqliteD1 } from "./test-d1";

vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));

const basis: SpecialCategoryBasis = {
  id: "BASIS-1",
  kind: "gdpr_art9",
  point: "g",
  statement: "Substantial public interest under national equality law",
  columns: ["Ethnicity"],
  confirmedBy: "Client DPO",
  confirmedOn: "2026-11-01",
  recordedBy: "user-lead",
  recordedAt: "2026-11-02T09:00:00.000Z",
};
function refusal(action: () => unknown) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw Error("Expected a refusal");
}

describe("column detection", () => {
  it("reads the header row of a CSV, quotes and BOM included", () => {
    expect(csvHeader('﻿id,"ethnic, origin","say ""hi"""\r\n1,2,3')).toEqual([
      "id",
      "ethnic, origin",
      'say "hi"',
    ]);
    expect(csvHeader("")).toBeNull();
    const bytes = (text: string) => new TextEncoder().encode(text).buffer;
    expect(uploadHeader("data.tsv", bytes("a\tb\n1\t2"))).toEqual(["a", "b"]);
    expect(uploadHeader("model.onnx", bytes("a,b"))).toBeNull();
  });

  it("recognises names of GDPR Art 9(1) categories", () => {
    expect(normalizeColumn("applicantEthnicity ")).toBe("applicant_ethnicity");
    for (const name of [
      "ethnicity",
      "Applicant Race",
      "religiousBelief",
      "health_status",
      "trade-union",
      "sex_life",
    ])
      expect(namesSpecialCategory(name), name).toBe(true);
    for (const name of ["group", "income", "trace", "union_id", "sex"])
      expect(namesSpecialCategory(name), name).toBe(false);
  });

  it("adds group columns declared special-category and recorded columns", () => {
    const profile = {
      suite: ["demographic_parity"],
      config: { groupColumn: "cohort" },
      specialCategory: { specialCategory: true },
    } as EvaluationProfile;
    const found = specialColumns(["Cohort", "ethnicity", "income", "region"], {
      evaluationProfiles: [profile],
      specialCategoryBases: [{ ...basis, columns: ["ethnicity", "region"] }],
    });
    expect(found).toEqual([
      { column: "Cohort", why: ["protocol_group_column"] },
      {
        column: "ethnicity",
        why: ["recorded_basis", "category_name"],
        basisId: "BASIS-1",
      },
      { column: "region", why: ["recorded_basis"], basisId: "BASIS-1" },
    ]);
  });
});

describe("the recorded basis", () => {
  const art4a = (paragraph: "1" | "2", points: string[]) => ({
    kind: "art4a",
    paragraph,
    conditions: Object.fromEntries(
      points.map((p) => [p, "Client statement for " + p]),
    ),
    columns: ["ethnicity"],
    confirmedBy: "Client DPO",
    confirmedOn: "2026-11-01",
  });
  it("records the Art 4a conditions point by point", () => {
    const all = ["a", "b", "c", "d", "e", "f"];
    expect(basisInputSchema.safeParse(art4a("1", all)).success).toBe(true);
    // Paragraph 2 adds its own necessity condition.
    expect(basisInputSchema.safeParse(art4a("2", all)).success).toBe(false);
    expect(basisInputSchema.safeParse(art4a("2", ["2a", ...all])).success).toBe(
      true,
    );
    const missing = basisInputSchema.safeParse(art4a("1", all.slice(1)));
    expect(missing.error?.issues[0]?.message).toBe(
      "Record the client's statement for condition a",
    );
    expect(basisInputSchema.safeParse(art4a("1", [...all, "2a"])).success).toBe(
      false,
    );
  });
  it("names the GDPR Art 9(2) ground and who confirmed it when", () => {
    const input = {
      kind: "gdpr_art9",
      point: "g",
      statement: basis.statement,
      columns: ["ethnicity"],
      confirmedBy: "Client DPO",
      confirmedOn: "2026-11-01",
    };
    expect(basisInputSchema.safeParse({ ...input, point: "k" }).success).toBe(
      false,
    );
    expect(basisInputSchema.safeParse(input).success).toBe(true);
    expect(
      basisInputSchema.safeParse({ ...input, confirmedOn: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(
      basisInputSchema.safeParse({ ...input, confirmedBy: "" }).success,
    ).toBe(false);
  });
});

describe("uploadGate", () => {
  const gate = (
    e: Pick<Engagement, "specialCategoryBases">,
    overrides: Partial<Parameters<typeof uploadGate>[1]> = {},
  ) =>
    uploadGate(e, {
      category: "Dataset",
      headers: ["actual", "predicted", "ethnicity"],
      handlingBasis: "reviewed",
      declaration: "",
      ...overrides,
    });
  it("refuses special-category columns without a recorded basis", () => {
    const refused = refusal(() => gate({}));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain(
      "needs the client's recorded basis before upload: ethnicity",
    );
    // A client cannot declare the columns free of such data.
    expect(refusal(() => gate({}, { declaration: null })).message).toContain(
      "Ask the audit team",
    );
  });
  it("allows them with a basis and returns what the audit trail records", () => {
    expect(gate({ specialCategoryBases: [basis] })).toEqual({
      columns: ["ethnicity"],
      bases: ["BASIS-1"],
    });
  });
  it("accepts a declaration only for synthetic or anonymised evidence", () => {
    expect(
      refusal(() => gate({}, { declaration: "not_personal" })).status,
    ).toBe(400);
    expect(
      gate({}, { declaration: "not_personal", handlingBasis: "synthetic" }),
    ).toEqual({
      columns: ["ethnicity"],
      bases: [],
      declaredNotPersonal: ["ethnicity"],
      declaration: "not_personal",
    });
  });
  it("ignores other categories, other formats and ordinary columns", () => {
    expect(gate({}, { category: "Validation" })).toBeNull();
    expect(gate({}, { headers: null })).toBeNull();
    expect(gate({}, { headers: ["actual", "predicted", "group"] })).toBeNull();
  });
});

describe("POST /api/evidence", () => {
  let sqlite: DatabaseSync;
  const objects = new Map<string, ArrayBuffer>();
  beforeEach(() => {
    const d1 = sqliteD1();
    sqlite = d1.sqlite;
    env.DB = d1.db;
    env.BUCKET = {
      async put(key: string, value: ArrayBuffer | string) {
        objects.set(
          key,
          typeof value === "string"
            ? new TextEncoder().encode(value).buffer
            : value,
        );
      },
      async delete(key: string) {
        objects.delete(key);
      },
    } as unknown as R2Bucket;
    const e = stored(1),
      at = "2026-11-01T00:00:00.000Z";
    sqlite.exec(
      `INSERT INTO tenants(id,name,created_at) VALUES ('tenant-1','Practice','${at}');
       INSERT INTO clients(id,tenant_id,name,sector,created_at) VALUES ('CL-1','tenant-1','Client','Finance','${at}');
       INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name) VALUES ('tenant-1','user-lead','Lead Auditor',NULL,'Lead');`,
    );
    sqlite
      .prepare(
        "INSERT INTO engagements(id,tenant_id,client_id,title,version,body,last_command_id) VALUES (?,?,?,?,?,?,?)",
      )
      .run(e.id, "tenant-1", "CL-1", e.title, 1, JSON.stringify(e), "init");
    sqlite
      .prepare(
        "INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) VALUES (?,?,?,1,?,?)",
      )
      .run("tenant-1", e.id, "user-lead", "user-lead", at);
    vi.mocked(context).mockResolvedValue(caller("Lead Auditor"));
  });
  afterEach(() => {
    delete env.DB;
    delete env.BUCKET;
    objects.clear();
  });
  const engagement = () =>
    sqlite.prepare("SELECT id,version FROM engagements").get() as {
      id: string;
      version: number;
    };
  function send(csv: string) {
    const { id, version } = engagement(),
      form = new FormData();
    form.set("tenantId", "tenant-1");
    form.set("engagementId", id);
    form.set("expectedVersion", String(version));
    form.set("category", "Dataset");
    form.set("visibility", "internal");
    form.set("handlingBasis", "synthetic");
    form.set("file", new File([csv], "applicants.csv", { type: "text/csv" }));
    return upload(
      new Request("https://workspace.test/api/evidence", {
        method: "POST",
        headers: { origin: "https://workspace.test" },
        body: form,
      }),
    );
  }
  const audit = () =>
    (
      sqlite
        .prepare("SELECT action,details FROM audit_events ORDER BY rowid")
        .all() as { action: string; details: string }[]
    ).map((r) => ({ action: r.action, details: JSON.parse(r.details) }));
  const csv = "actual,predicted,ethnicity\n1,1,A\n0,1,B\n";

  it("refuses a dataset with a special-category column until the basis is recorded", async () => {
    const refused = await send(csv);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain(
      "recorded basis before upload: ethnicity",
    );
    // Nothing reached the bucket or the audit trail.
    expect(objects.size).toBe(0);
    expect(audit()).toEqual([]);

    const { id, version } = engagement();
    const recorded = await workspace(
      postRequest("/api/workspace", {
        tenantId: "tenant-1",
        engagementId: id,
        expectedVersion: version,
        op: "recordSpecialCategoryBasis",
        data: {
          kind: "gdpr_art9",
          point: "g",
          statement: "Substantial public interest under national equality law",
          columns: ["ethnicity"],
          confirmedBy: "Client DPO",
          confirmedOn: "2026-11-01",
        },
      }),
    );
    expect(recorded.status).toBe(200);
    const basisId = (
      (await recorded.json()) as { details: { basisId: string } }
    ).details.basisId;

    const accepted = await send(csv);
    expect(accepted.status).toBe(200);
    expect(objects.size).toBe(1);
    expect(audit()).toEqual([
      {
        action: "recordSpecialCategoryBasis",
        details: {
          basisId,
          kind: "gdpr_art9",
          provision: "GDPR Art 9(2)(g)",
          columns: ["ethnicity"],
          confirmedBy: "Client DPO",
          confirmedOn: "2026-11-01",
        },
      },
      {
        action: "uploadEvidence",
        details: expect.objectContaining({
          category: "Dataset",
          specialCategory: { columns: ["ethnicity"], bases: [basisId] },
        }),
      },
    ]);
  });

  it("refuses a basis the client confirms in the future", async () => {
    const { id, version } = engagement();
    const refused = await workspace(
      postRequest("/api/workspace", {
        tenantId: "tenant-1",
        engagementId: id,
        expectedVersion: version,
        op: "recordSpecialCategoryBasis",
        data: {
          kind: "gdpr_art9",
          point: "a",
          statement: "Explicit consent",
          columns: ["ethnicity"],
          confirmedBy: "Client DPO",
          confirmedOn: "2999-01-01",
        },
      }),
    );
    expect(refused.status).toBe(400);
  });
});

describe("specialCategoryLimitations", () => {
  const run = (overrides: Partial<Run>, specialCategory?: unknown) =>
    ({
      id: "RUN-1",
      state: "succeeded",
      manifest: {
        executionMode: "saved_predictions",
        profile: {
          suite: ["demographic_parity"],
          config: { groupColumn: "ethnicity" },
          specialCategory,
        },
      },
      ...overrides,
    }) as unknown as Run;
  it("states the basis of each run that evaluated special-category data", () => {
    expect(
      specialCategoryLimitations([
        run({}, { specialCategory: true, route: "hosted", basis }),
        run(
          {
            id: "JOB-1",
            manifest: {
              executionMode: "client_local",
              profile: {
                suite: ["equalized_odds"],
                config: { groupColumn: "ethnicity" },
                specialCategory: { specialCategory: true, basis: null },
              },
            } as unknown as Run["manifest"],
          },
          undefined,
        ),
        run({ id: "RUN-2", state: "failed" }, { specialCategory: true }),
        run({ id: "RUN-3" }, { specialCategory: false }),
      ]),
    ).toEqual([
      "Run RUN-1 evaluated special-category column ethnicity on the platform under GDPR Art 9(2)(g): Substantial public interest under Union or Member State law; confirmed by Client DPO on 2026-11-01; basis BASIS-1.",
      "Run JOB-1 evaluated special-category column ethnicity on the client's own worker with no basis recorded on its protocol.",
    ]);
  });
});
