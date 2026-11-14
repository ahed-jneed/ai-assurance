// POST /api/client-submission at its package limits (#199): ten files of
// exactly 10 MB in total are stored, an eleventh file, a single file over
// 10 MB or a package one byte over 10 MB in total is refused with the route's
// status and message, and a body over the 11 MB read bound is refused with
// 413. A refusal writes nothing to R2 or D1. The files are generated in
// memory, never committed.
import { env } from "cloudflare:workers";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshEngagement } from "@/lib/factories";
import { resolveNew } from "@/lib/criteria/pin";
import { context } from "@/lib/tenancy";
import { member, practice, tenantId } from "@/lib/test-storage";
import { POST } from "./route";

vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(context).mockResolvedValue(
    member("contributor", "Client Contributor", "CL-1"),
  );
});
afterEach(() => {
  delete env.DB;
  delete env.BUCKET;
});

// Every row of every table, to show that a refusal changed nothing in D1.
function databaseRows(sqlite: DatabaseSync) {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      sqlite.prepare(`SELECT * FROM "${name}"`).all(),
    ]),
  );
}
const MB = 1024 * 1024,
  ORIGIN = "https://workspace.test",
  AT = "2026-11-01T00:00:00.000Z";

/** An engagement with an open evidence request granted to the contributor. */
async function seeded() {
  const e = freshEngagement(
    resolveNew(),
    "CL-1",
    "Delivery audit",
    "lead",
    true,
  );
  e.id = "ENG-SUB";
  e.evidenceRequests = [
    {
      id: "REQ-1",
      subject: "Training data",
      description: "The training data extract",
      responsibleParty: "Client",
      periodVersion: "v1",
      handling: "synthetic",
      dueDate: "2026-12-01",
      paperIds: [],
      evidenceIds: [],
      required: true,
      status: "open",
      response: "",
      assessment: "",
      createdBy: "lead",
      createdAt: AT,
      updatedBy: "lead",
      updatedAt: AT,
      revision: 1,
      history: [],
    },
  ];
  e.workflow!.clientGrants.push({
    id: "GRANT-1",
    userId: "contributor",
    requestId: "REQ-1",
    prompt: "Upload the extract",
    instructions: "Synthetic data only",
    category: "Other",
    handlingBasis: "synthetic",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    active: true,
    actor: "lead",
    at: AT,
  });
  return { e, ...(await practice([e])) };
}
function deliver(version: number, sizes: number[]) {
  const form = new FormData();
  form.set("tenantId", tenantId);
  form.set("engagementId", "ENG-SUB");
  form.set("grantId", "GRANT-1");
  form.set("expectedVersion", String(version));
  form.set("note", "The extract");
  form.set("delivery", "partial");
  form.set("remaining", "The rest follows");
  for (const [i, size] of sizes.entries())
    form.append("file", new Blob([new Uint8Array(size)]), `part-${i}.bin`);
  return new Request(ORIGIN + "/api/client-submission", {
    method: "POST",
    headers: { origin: ORIGIN },
    body: form,
  });
}
/** `count` file sizes adding up to `total` bytes. */
const split = (count: number, total: number) =>
  Array.from(
    { length: count },
    (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0),
  );

describe("POST /api/client-submission package limits", () => {
  it("stores ten files of exactly 10 MB in total", async () => {
    const { e, sqlite, writes } = await seeded();
    const response = await POST(deliver(e.version, split(10, 10 * MB)));
    expect(response.status).toBe(200);
    const { artifactIds } = (await response.json()) as {
      artifactIds: string[];
    };
    expect(artifactIds).toHaveLength(10);
    for (const artifactId of artifactIds)
      expect(
        writes.filter((k) => k.includes("/" + artifactId + "/")),
      ).toHaveLength(1);
    expect(
      sqlite
        .prepare("SELECT version FROM engagements WHERE id='ENG-SUB'")
        .get(),
    ).toEqual({ version: e.version + 1 });
  }, 60_000);

  it("stores one file of exactly 10 MB", async () => {
    const { e } = await seeded();
    const response = await POST(deliver(e.version, [10 * MB]));
    expect(response.status).toBe(200);
  }, 60_000);

  it.each([
    [
      "an eleventh file",
      split(11, 11),
      400,
      "Choose 1–10 nonempty files, up to 10 MB in total",
    ],
    [
      "a single file one byte over 10 MB",
      [10 * MB + 1],
      400,
      "Choose 1–10 nonempty files, up to 10 MB in total",
    ],
    [
      "a package one byte over 10 MB in total",
      split(10, 10 * MB + 1),
      413,
      "The delivery package exceeds 10 MB. Split it into partial deliveries.",
    ],
    [
      "an empty file",
      [1, 0],
      400,
      "Choose 1–10 nonempty files, up to 10 MB in total",
    ],
    [
      "a request body over the 11 MB read bound",
      [11 * MB],
      413,
      "Request exceeds the permitted size",
    ],
  ])(
    "refuses %s and writes nothing",
    async (_, sizes, status, error) => {
      const { e, sqlite, writes } = await seeded();
      const before = databaseRows(sqlite);
      const response = await POST(deliver(e.version, sizes));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(writes).toEqual([]);
      expect(databaseRows(sqlite)).toEqual(before);
    },
    60_000,
  );
});
