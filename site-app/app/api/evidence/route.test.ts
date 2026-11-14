// POST /api/evidence at its size limit (#199): a file of exactly 50 MB is
// stored, one byte more is refused with the route's 400 and message, and a
// body over the 51 MB read bound is refused with 413. A refusal writes
// nothing to R2 or D1. The files are generated in memory, never committed.
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
  vi.mocked(context).mockResolvedValue(member("auditor", "Auditor"));
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
  ORIGIN = "https://workspace.test";

async function seeded() {
  const e = freshEngagement(resolveNew(), "CL-1", "Upload audit", "lead", true);
  e.id = "ENG-UP";
  return { e, ...(await practice([e])) };
}
function upload(version: number, file: Blob, name = "evidence.bin") {
  const form = new FormData();
  form.set("tenantId", tenantId);
  form.set("engagementId", "ENG-UP");
  form.set("expectedVersion", String(version));
  form.set("category", "Other");
  form.set("handlingBasis", "synthetic");
  form.set("file", file, name);
  return new Request(ORIGIN + "/api/evidence", {
    method: "POST",
    headers: { origin: ORIGIN },
    body: form,
  });
}

describe("POST /api/evidence size limit", () => {
  it("stores a file of exactly 50 MB", async () => {
    const { e, sqlite, writes, objects } = await seeded();
    const response = await POST(
      upload(e.version, new Blob([new Uint8Array(50 * MB)])),
    );
    expect(response.status).toBe(200);
    const { artifactId } = (await response.json()) as { artifactId: string };
    const stored = writes.filter((k) => k.includes("/" + artifactId + "/"));
    expect(stored).toHaveLength(1);
    expect((objects.get(stored[0]) as unknown as ArrayBuffer).byteLength).toBe(
      50 * MB,
    );
    expect(
      sqlite.prepare("SELECT version FROM engagements WHERE id='ENG-UP'").get(),
    ).toEqual({ version: e.version + 1 });
  }, 60_000);

  it.each([
    [
      "a file one byte over 50 MB",
      50 * MB + 1,
      400,
      "Choose a nonempty file up to 50 MB",
    ],
    [
      "a request body over the 51 MB read bound",
      51 * MB,
      413,
      "Request exceeds the permitted size",
    ],
  ])(
    "refuses %s and writes nothing",
    async (_, size, status, error) => {
      const { e, sqlite, writes } = await seeded();
      const before = databaseRows(sqlite);
      const response = await POST(
        upload(e.version, new Blob([new Uint8Array(size)])),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(writes).toEqual([]);
      expect(databaseRows(sqlite)).toEqual(before);
    },
    60_000,
  );

  it("refuses an empty file and writes nothing", async () => {
    const { e, sqlite, writes } = await seeded();
    const before = databaseRows(sqlite);
    const response = await POST(upload(e.version, new Blob([])));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a nonempty file up to 50 MB",
    });
    expect(writes).toEqual([]);
    expect(databaseRows(sqlite)).toEqual(before);
  });
});
