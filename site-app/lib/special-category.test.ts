// The special-category gate (#60, D-11): column detection, the recorded
// basis, the upload gate on POST /api/evidence with its audit trail, and
// the report limitation. Hosted and external runs are tested in
// evaluation-service.test.ts.
import { env } from "cloudflare:workers";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as submit } from "@/app/api/client-submission/route";
import { GET as download, POST as upload } from "@/app/api/evidence/route";
import { POST as workspace } from "@/app/api/workspace/route";
import { caller, postRequest, stored } from "./commands/test-fixtures";
import { pyarrowParquet, workbook } from "./dataset-header.fixture";
import type { Engagement, EvaluationProfile, Run } from "./domain";
import { ApiError } from "./http";
import {
  assertPlatformBytes,
  basisInputSchema,
  csvHeader,
  declareProtocol,
  heldByClient,
  namesSpecialCategory,
  normalizeColumn,
  protocolGroupColumns,
  protocolGroupMinimum,
  specialCategoryGroupFloor,
  specialCategoryLimitation,
  specialCategoryLimitations,
  specialColumns,
  uploadGate,
  uploadHeader,
  utf16ByteOrder,
  type SpecialCategoryBasis,
} from "./special-category";
import { context } from "./tenancy";
import { sqliteD1 } from "./test-d1";
import { seedWorkflow } from "./workflow-seed";
import { resolveNew } from "./criteria/pin";

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
  it("reads the header row of a CSV, quotes and BOM included", async () => {
    expect(csvHeader('﻿id,"ethnic, origin","say ""hi"""\r\n1,2,3')).toEqual([
      "id",
      "ethnic, origin",
      'say "hi"',
    ]);
    expect(csvHeader("")).toBeNull();
    const bytes = (text: string) => new TextEncoder().encode(text).buffer;
    expect(await uploadHeader("data.tsv", bytes("a\tb\n1\t2"))).toEqual([
      "a",
      "b",
    ]);
    // Any text upload is inspected, whatever its name: the external worker
    // reads every Dataset as CSV.
    expect(await uploadHeader("dataset", bytes("id,ethnicity\n1,A"))).toEqual([
      "id",
      "ethnicity",
    ]);
    expect(await uploadHeader("data.bin", bytes("a\tethnicity\n1\t2"))).toEqual(
      ["a", "ethnicity"],
    );
    // A character cut by the scan limit does not hide the header.
    const long = bytes("ethnicity," + "é".repeat(40_000));
    expect(await uploadHeader("dataset", long)).toContain("ethnicity");
    // Other binary formats are not inspected.
    expect(
      await uploadHeader(
        "model.onnx",
        new Uint8Array([0x08, 0x00, 0xff, 0xfe]).buffer,
      ),
    ).toBeNull();
    // A Parquet file whose footer cannot be read is reported as such, so
    // the gate can refuse it (#103).
    expect(await uploadHeader("x.parquet", bytes("PAR1\u0000\u0001"))).toEqual({
      unreadable: "the Parquet file is truncated",
    });
  });

  it("reads the header of a CSV that is not UTF-8", async () => {
    // Excel's "CSV (Comma delimited)": Windows-1252, with accented and
    // 0x80-0x9F characters that are not valid UTF-8.
    const encode = (text: string) => new TextEncoder().encode(text),
      cp1252 = new Uint8Array([
        ...encode("id,Ethnicit"),
        0xe9, // é
        0x80, // €
        ...encode(",religion\n1,"),
        0xe9,
        0x0a,
      ]);
    expect(await uploadHeader("export.csv", cp1252.buffer)).toEqual([
      "id",
      "Ethnicité€",
      "religion",
    ]);
    // Excel's "Unicode Text": UTF-16 with a byte order mark, tab-separated.
    const utf16 = (text: string, little: boolean, bom = true) => {
      const start = bom ? 2 : 0,
        out = new Uint8Array(start + text.length * 2),
        view = new DataView(out.buffer);
      if (bom) view.setUint16(0, 0xfeff, little);
      for (let i = 0; i < text.length; i++)
        view.setUint16(start + 2 * i, text.charCodeAt(i), little);
      return out.buffer;
    };
    for (const little of [true, false])
      expect(
        await uploadHeader(
          "export.txt",
          utf16("id\tethnicity\r\n1\tA\r\n", little),
        ),
        little ? "UTF-16LE" : "UTF-16BE",
      ).toEqual(["id", "ethnicity"]);
    expect(
      await uploadHeader("export.csv", utf16("id,religion\n1,x", true)),
    ).toEqual(["id", "religion"]);
    // UTF-16 written without a byte order mark: every other byte is NUL,
    // which also tells the byte order (#103).
    for (const little of [true, false])
      expect(
        await uploadHeader(
          "export.csv",
          utf16("id,Ethnicité\r\n1,A\r\n", little, false),
        ),
        little ? "UTF-16LE without BOM" : "UTF-16BE without BOM",
      ).toEqual(["id", "Ethnicité"]);
    expect(utf16ByteOrder(new Uint8Array(utf16("a,b", true, false)))).toBe(
      "le",
    );
    expect(utf16ByteOrder(new TextEncoder().encode("id,ethnicity"))).toBeNull();
    // Too short to tell.
    expect(utf16ByteOrder(new Uint8Array([0x61, 0]))).toBeNull();
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

  it("treats the columns of intersectional strata as group columns (#30)", () => {
    const statistics = {
      criteria: [{ kind: "group_comparison", groupFields: ["sex", "race"] }],
      minimums: { sampleSize: 30, groupSize: 50, classCount: 10 },
    } as EvaluationProfile["statistics"];
    const profile = {
      suite: ["demographic_parity"],
      config: { groupColumn: "sex" },
      statistics,
      specialCategory: { specialCategory: true },
    } as EvaluationProfile;
    expect(protocolGroupColumns(profile)).toEqual(["sex", "race"]);
    expect(
      specialColumns(["sex", "race", "income"], {
        evaluationProfiles: [profile],
      }).map((c) => c.column),
    ).toEqual(["sex", "race"]);
    const e = { specialCategoryBases: [{ ...basis, columns: ["race"] }] };
    const declaration = {
      specialCategory: true,
      route: "hosted" as const,
      basisId: "BASIS-1",
    };
    expect(
      refusal(() =>
        declareProtocol(e, profile, declaration, "user-1", "2026-11-07"),
      ).message,
    ).toBe("Choose a recorded basis that covers the group columns sex, race");
    const covered = {
      specialCategoryBases: [{ ...basis, columns: ["Sex", "race"] }],
    };
    expect(
      declareProtocol(covered, profile, declaration, "user-1", "2026-11-07")
        ?.basis?.id,
    ).toBe("BASIS-1");
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
  it("refuses a dataset whose columns could not be read unless declared free of such data", () => {
    const unreadable = { unreadable: "the Parquet footer is encrypted" };
    const refused = refusal(() => gate({}, { headers: unreadable }));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain(
      "could not be read (the Parquet footer is encrypted)",
    );
    expect(
      refusal(() => gate({}, { headers: unreadable, declaration: null }))
        .message,
    ).toContain("Send it as CSV");
    expect(
      refusal(() =>
        gate({}, { headers: unreadable, declaration: "not_personal" }),
      ).status,
    ).toBe(400);
    expect(
      gate(
        {},
        {
          headers: unreadable,
          declaration: "not_personal",
          handlingBasis: "anonymized",
        },
      ),
    ).toEqual({
      columns: [],
      bases: [],
      unreadable: "the Parquet footer is encrypted",
      declaration: "not_personal",
    });
    // Only Dataset evidence is gated.
    expect(
      gate({}, { headers: unreadable, category: "Validation" }),
    ).toBeNull();
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
  function send(csv: BlobPart, name = "applicants.csv", declaration = "") {
    const { id, version } = engagement(),
      form = new FormData();
    form.set("tenantId", "tenant-1");
    form.set("engagementId", id);
    form.set("expectedVersion", String(version));
    form.set("category", "Dataset");
    form.set("visibility", "internal");
    form.set("handlingBasis", "synthetic");
    form.set("specialCategoryDeclaration", declaration);
    form.set("file", new File([csv], name, { type: "text/csv" }));
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

  const record = async (columns = ["ethnicity"]) => {
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
          columns,
          confirmedBy: "Client DPO",
          confirmedOn: "2026-11-01",
        },
      }),
    );
    expect(recorded.status).toBe(200);
    return ((await recorded.json()) as { details: { basisId: string } }).details
      .basisId;
  };

  it("inspects a Dataset uploaded without a file extension", async () => {
    const refused = await send(csv, "dataset");
    expect(refused.status).toBe(409);
    expect(objects.size).toBe(0);
  });

  it("inspects a Dataset that is not UTF-8", async () => {
    // Windows-1252 with an accented value, and UTF-16 with a byte order mark.
    const encode = (text: string) => new TextEncoder().encode(text),
      cp1252 = new Uint8Array([
        ...encode("actual,predicted,ethnicity\n1,1,Fran"),
        0xe7,
        ...encode("aise\n"),
      ]),
      utf16 = new Uint8Array([
        0xff,
        0xfe,
        ...[...csv].flatMap((c) => [c.charCodeAt(0), 0]),
      ]);
    for (const bytes of [cp1252, utf16]) {
      const refused = await send(bytes);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toContain(
        "recorded basis before upload: ethnicity",
      );
    }
    expect(objects.size).toBe(0);
    const basisId = await record();
    const accepted = await send(cp1252);
    expect(accepted.status).toBe(200);
    expect(audit().at(-1)).toEqual({
      action: "uploadEvidence",
      details: expect.objectContaining({
        specialCategory: { columns: ["ethnicity"], bases: [basisId] },
      }),
    });
  });

  it("inspects Parquet and spreadsheet datasets (#103)", async () => {
    const xlsx = await workbook([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>actual</t></is></c><c r="B1" t="inlineStr"><is><t>ethnicity</t></is></c></row>',
    ]);
    for (const [bytes, name] of [
      [pyarrowParquet(), "applicants.parquet"],
      [xlsx, "applicants.xlsx"],
    ] as const) {
      const refused = await send(bytes.slice(), name);
      expect(refused.status, name).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toMatch(
        /recorded basis before upload: (E|e)thnicity/,
      );
    }
    expect(objects.size).toBe(0);
    // A Parquet file whose footer is encrypted cannot be checked: refused
    // unless the uploader declares it free of special-category data.
    const encrypted = pyarrowParquet();
    encrypted.set([0x50, 0x41, 0x52, 0x45], encrypted.length - 4);
    const unread = await send(encrypted.slice(), "applicants.parquet");
    expect(unread.status).toBe(409);
    expect(((await unread.json()) as { error: string }).error).toContain(
      "could not be read (the Parquet footer is encrypted)",
    );
    const declared = await send(
      encrypted.slice(),
      "applicants.parquet",
      "not_personal",
    );
    expect(declared.status).toBe(200);
    expect(audit().at(-1)).toEqual({
      action: "uploadEvidence",
      details: expect.objectContaining({
        specialCategory: {
          columns: [],
          bases: [],
          unreadable: "the Parquet footer is encrypted",
          declaration: "not_personal",
        },
      }),
    });
  });

  it("gates a client submission and records the gate in its audit event", async () => {
    // A client contributor with an active grant on an open request.
    const row = sqlite.prepare("SELECT body FROM engagements").get() as {
        body: string;
      },
      e = JSON.parse(row.body) as Engagement,
      at = "2026-11-01T00:00:00.000Z";
    e.workflow = seedWorkflow(resolveNew(), "user-lead", at);
    e.evidenceRequests = [
      {
        id: "REQ-1",
        subject: "Fairness data",
        description: "Applicant outcomes",
        responsibleParty: "Client",
        periodVersion: "2026",
        handling: "synthetic",
        dueDate: "2026-12-01",
        paperIds: [],
        evidenceIds: [],
        required: true,
        status: "open",
        response: "",
        assessment: "",
        createdBy: "user-lead",
        createdAt: at,
        updatedBy: "user-lead",
        updatedAt: at,
        revision: 1,
        history: [],
      },
    ];
    e.workflow.clientGrants = [
      {
        id: "GRANT-1",
        userId: "user-client",
        requestId: "REQ-1",
        prompt: "Upload the applicant outcomes",
        instructions: "",
        category: "Dataset",
        handlingBasis: "synthetic",
        expiresAt: "2999-01-01T00:00:00.000Z",
        active: true,
        actor: "user-lead",
        at,
      },
    ];
    sqlite
      .prepare("UPDATE engagements SET body=?")
      .run(JSON.stringify({ ...e, version: undefined }));
    sqlite.exec(
      "INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name) VALUES ('tenant-1','user-client','Client Contributor','CL-1','Client')",
    );
    const asClient = () =>
      vi.mocked(context).mockResolvedValue({
        ...caller("Client Contributor", false),
        user: {
          userId: "user-client",
          displayName: "Client",
          email: "client@fixture.invalid",
        },
        clientId: "CL-1",
      });
    const deliver = () => {
      const { id, version } = engagement(),
        form = new FormData();
      form.set("tenantId", "tenant-1");
      form.set("engagementId", id);
      form.set("grantId", "GRANT-1");
      form.set("expectedVersion", String(version));
      form.set("note", "Outcomes attached");
      form.set("delivery", "complete");
      form.set("remaining", "");
      form.append("file", new File(["id,label\n1,0\n"], "readme.csv"));
      form.append("file", new File([csv], "applicants.csv"));
      return submit(
        new Request("https://workspace.test/api/client-submission", {
          method: "POST",
          headers: { origin: "https://workspace.test" },
          body: form,
        }),
      );
    };

    asClient();
    const refused = await deliver();
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain(
      "Ask the audit team to record your Art 4a or GDPR Art 9(2) basis",
    );
    expect(objects.size).toBe(0);
    expect(audit()).toEqual([]);

    vi.mocked(context).mockResolvedValue(caller("Lead Auditor"));
    const basisId = await record();
    asClient();
    const accepted = await deliver();
    expect(accepted.status).toBe(200);
    const { artifactIds } = (await accepted.json()) as {
      artifactIds: string[];
    };
    expect(objects.size).toBe(2);
    expect(audit().at(-1)).toEqual({
      action: "clientSubmission",
      details: expect.objectContaining({
        artifactIds,
        // Only the file with a gated column is recorded, by artifact id.
        specialCategory: {
          [artifactIds[1]]: { columns: ["ethnicity"], bases: [basisId] },
        },
      }),
    });
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

  it("allows the client's own date a day ahead of UTC and lists each column once", async () => {
    const post = (confirmedOn: string, columns: string[]) => {
      const { id, version } = engagement();
      return workspace(
        postRequest("/api/workspace", {
          tenantId: "tenant-1",
          engagementId: id,
          expectedVersion: version,
          op: "recordSpecialCategoryBasis",
          data: {
            kind: "gdpr_art9",
            point: "a",
            statement: "Explicit consent",
            columns,
            confirmedBy: "Client DPO",
            confirmedOn,
          },
        }),
      );
    };
    const day = 86_400_000,
      date = (offset: number) =>
        new Date(Date.now() + offset).toISOString().slice(0, 10);
    // Duplicates are found the way columns are matched.
    const duplicate = await post(date(0), [
      "applicantEthnicity",
      "applicant ethnicity",
    ]);
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as { error: string }).error).toBe(
      "List each column once",
    );
    expect((await post(date(2 * day), ["ethnicity"])).status).toBe(400);
    expect((await post(date(day), ["ethnicity"])).status).toBe(200);
  });

  // #102: the client keeps the file; the platform records only its pin.
  const pin = (data: Record<string, unknown> = {}) => {
    const { id, version } = engagement();
    return workspace(
      postRequest("/api/workspace", {
        tenantId: "tenant-1",
        engagementId: id,
        expectedVersion: version,
        op: "pinClientDataset",
        data: {
          name: "applicants-2026-q3.csv",
          sha256: "c".repeat(64),
          size: 1234,
          confirmedBy: "Client data steward",
          confirmedOn: "2026-11-05",
          custodyNote:
            "Kept on the client's analysis server; its worker reads it",
          columns: ["label", "prediction", "ethnicity"],
          ...data,
        },
      }),
    );
  };
  const pinnedEngagement = () =>
    JSON.parse(
      (sqlite.prepare("SELECT body FROM engagements").get() as { body: string })
        .body,
    ) as Engagement;

  it("pins a client-held dataset without receiving or storing any bytes", async () => {
    const response = await pin();
    expect(response.status).toBe(200);
    expect(objects.size).toBe(0);
    const a = pinnedEngagement().artifacts.at(-1)!;
    expect(a).toMatchObject({
      name: "applicants-2026-q3.csv",
      category: "Dataset",
      sha256: "c".repeat(64),
      size: 1234,
      key: "",
      status: "unverified",
      custody: "client",
      clientPin: {
        confirmedBy: "Client data steward",
        confirmedOn: "2026-11-05",
      },
    });
    expect(audit().at(-1)).toEqual({
      action: "pinClientDataset",
      details: expect.objectContaining({
        artifactId: a.id,
        sha256: "c".repeat(64),
        custody: "client",
      }),
    });
    // There are no bytes to download, preview or evaluate on the platform.
    const refused = await download(
      new Request(
        "https://workspace.test/api/evidence?" +
          new URLSearchParams({
            tenantId: "tenant-1",
            engagementId: pinnedEngagement().id,
            artifactId: a.id,
          }),
      ),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain(
      "is held by the client",
    );
    expect(() => assertPlatformBytes(a)).toThrow(/held by the client/);
    expect(heldByClient(a)).toBe(true);
  });

  it("refuses a duplicate, future-dated, path-named or malformed pin", async () => {
    expect((await pin()).status).toBe(200);
    const duplicate = await pin();
    expect(duplicate.status).toBe(409);
    expect(
      (await pin({ sha256: "d".repeat(64), confirmedOn: "2999-01-01" })).status,
    ).toBe(400);
    expect(
      (await pin({ sha256: "d".repeat(64), name: "../data.csv" })).status,
    ).toBe(400);
    expect((await pin({ sha256: "D".repeat(64) })).status).toBe(400);
    expect((await pin({ sha256: "d".repeat(64), size: 0 })).status).toBe(400);
    expect(
      (await pin({ sha256: "d".repeat(64), size: 100 * 1024 * 1024 + 1 }))
        .status,
    ).toBe(400);
    expect(pinnedEngagement().artifacts.filter(heldByClient)).toHaveLength(1);
  });

  it("requires the file's header columns, each once and not blank (#134)", async () => {
    for (const columns of [undefined, [], ["label", "label"], ["label", " "]])
      expect(
        (await pin({ sha256: "d".repeat(64), columns })).status,
        JSON.stringify(columns),
      ).toBe(400);
    expect((await pin()).status).toBe(200);
    expect(pinnedEngagement().artifacts.at(-1)!.clientPin!.columns).toEqual([
      "label",
      "prediction",
      "ethnicity",
    ]);
    expect(audit().at(-1)!.details).toMatchObject({
      columnCount: 3,
      attested: false,
    });
  });

  // The pin file engine/client_pin.py wrote for a fictional client's test key;
  // engine/tests/test_client_pin.py regenerates it byte for byte.
  const attested = JSON.parse(
    readFileSync(
      new URL(
        "../../engine/tests/fixtures/client-pin/attested-pin.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown> & {
    confirmedBy: string;
    attestation: Record<string, string>;
  };
  const custodyNote = "Kept on the client's analysis server";

  it("verifies and keeps the client's signed statement of the pin (#134)", async () => {
    const response = await pin({ ...attested, custodyNote });
    expect(response.status).toBe(200);
    const a = pinnedEngagement().artifacts.at(-1)!;
    expect(a.clientPin).toMatchObject({
      confirmedBy: attested.confirmedBy,
      columns: ["label", "prediction", "ethnicity"],
      attestation: {
        algorithm: "Ed25519",
        statement: attested.attestation.statement,
        signature: attested.attestation.signature,
        publicKeySPKI: attested.attestation.publicKeySPKI,
        keySha256: attested.attestation.keySha256,
      },
    });
    expect(audit().at(-1)!.details).toMatchObject({
      attested: true,
      clientKeySha256: attested.attestation.keySha256,
    });
  });

  it("refuses an attestation that does not sign exactly this pin (#134)", async () => {
    const refused = async (
      data: Record<string, unknown>,
      message: string | RegExp,
    ) => {
      const response = await pin({ ...attested, custodyNote, ...data });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(
        message,
      );
    };
    // A pin field the client did not sign.
    await refused(
      { confirmedBy: "Someone else, auditor" },
      "The client's signed statement differs from this pin in: confirmedBy",
    );
    await refused(
      { columns: ["label", "prediction", "sex"] },
      /differs from this pin in: columns$/,
    );
    // A statement changed after signing, or another key.
    const statement = JSON.parse(atob(attested.attestation.statement));
    await refused(
      {
        confirmedOn: "2026-11-04",
        attestation: {
          ...attested.attestation,
          statement: btoa(
            JSON.stringify({ ...statement, confirmedOn: "2026-11-04" }),
          ),
        },
      },
      "The client's signature does not verify over its statement",
    );
    const pair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", pair.publicKey),
    );
    await refused(
      {
        attestation: {
          ...attested.attestation,
          publicKeySPKI: btoa(String.fromCharCode(...spki)),
          keySha256: undefined,
        },
      },
      "The client's signature does not verify over its statement",
    );
    await refused(
      { attestation: { ...attested.attestation, keySha256: "0".repeat(64) } },
      "keySha256 is not the fingerprint of this key",
    );
    await refused(
      { attestation: { ...attested.attestation, publicKeySPKI: "AAAA" } },
      "The attestation needs an Ed25519 public key and signature",
    );
    // A statement the client signed about something else.
    const other = new TextEncoder().encode(
      JSON.stringify({ ...statement, kind: "other" }),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("Ed25519", pair.privateKey, other),
    );
    await refused(
      {
        attestation: {
          algorithm: "Ed25519",
          statement: btoa(String.fromCharCode(...other)),
          signature: btoa(String.fromCharCode(...signature)),
          publicKeySPKI: btoa(String.fromCharCode(...spki)),
        },
      },
      "This is not a client dataset pin statement",
    );
    expect(pinnedEngagement().artifacts.filter(heldByClient)).toHaveLength(0);
  });
});

describe("the special-category group-size floor (#134)", () => {
  const profile = (groupSize: number | undefined, configured = 5) =>
    ({
      suite: ["demographic_parity"],
      config: { groupColumn: "ethnicity", minimumGroupSize: configured },
      ...(groupSize === undefined
        ? {}
        : {
            statistics: {
              criteria: [],
              minimums: { sampleSize: 30, groupSize, classCount: 10 },
            },
          }),
    }) as unknown as EvaluationProfile;
  const declare = (p: EvaluationProfile, specialCategory = true) =>
    declareProtocol({}, p, { specialCategory }, "user-1", "2026-11-07");

  it("refuses a special-category protocol whose groups may hold fewer than 50 rows", () => {
    expect(specialCategoryGroupFloor).toBe(50);
    expect(refusal(() => declare(profile(49))).message).toBe(
      "A fairness protocol on special-category column ethnicity needs a minimum group size of at least 50 rows (this protocol's is 49): smaller groups would be reported exactly.",
    );
    expect(declare(profile(50))?.specialCategory).toBe(true);
    // A protocol without a plan: its configured minimum, raised to the
    // statistics floor of 30 as the derived plan raises it.
    expect(protocolGroupMinimum(profile(undefined, 5))).toBe(30);
    expect(refusal(() => declare(profile(undefined, 30))).status).toBe(400);
    expect(declare(profile(undefined, 50))?.route).toBe("client_side");
    // A column declared not to be special-category keeps the statistics floor.
    expect(declare(profile(30), false)?.specialCategory).toBe(false);
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
        run(
          {
            id: "JOB-2",
            manifest: {
              executionMode: "client_local",
              dataset: { custody: "client" },
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
      "Run JOB-2 evaluated special-category column ethnicity on the client's own worker in the client's environment, which returned only aggregates and withheld groups below the minimum group size, with no basis recorded on its protocol.",
    ]);
  });
  it("gives the sentence an external run's paper states (#103)", () => {
    const profile = {
      suite: ["demographic_parity"],
      config: { groupColumn: "ethnicity" },
    } as unknown as EvaluationProfile;
    expect(
      specialCategoryLimitation(
        "JOB-2",
        {
          ...profile,
          specialCategory: {
            column: "ethnicity",
            specialCategory: true,
            route: "client_side",
            basis,
            declaredBy: "user-lead",
            declaredAt: "2026-11-02T09:00:00.000Z",
          },
        },
        "auditor_model",
      ),
    ).toBe(
      "Run JOB-2 evaluated special-category column ethnicity on the auditor's external worker under GDPR Art 9(2)(g): Substantial public interest under Union or Member State law; confirmed by Client DPO on 2026-11-01; basis BASIS-1.",
    );
    // A protocol saved before declarations counts as special-category.
    expect(specialCategoryLimitation("JOB-3", profile, "client_local")).toBe(
      "Run JOB-3 evaluated special-category column ethnicity on the client's own worker with no basis recorded on its protocol.",
    );
    // A client-held pin's paper says the data stayed with the client (#102).
    expect(
      specialCategoryLimitation("JOB-3", profile, "client_local", "client"),
    ).toBe(
      "Run JOB-3 evaluated special-category column ethnicity on the client's own worker in the client's environment, which returned only aggregates and withheld groups below the minimum group size, with no basis recorded on its protocol.",
    );
    expect(
      specialCategoryLimitation(
        "JOB-4",
        {
          ...profile,
          specialCategory: {
            column: "ethnicity",
            specialCategory: false,
            route: "hosted",
            basis: null,
            declaredBy: "user-lead",
            declaredAt: "2026-11-02T09:00:00.000Z",
          },
        },
        "client_local",
      ),
    ).toBeNull();
  });
});
