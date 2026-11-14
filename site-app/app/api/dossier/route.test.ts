// POST /api/dossier names its audience (#226 item 2): a seal request without
// one is refused before anything is read or sealed, never assumed internal.
import { describe, expect, it, vi } from "vitest";
import { postRequest } from "@/lib/commands/test-fixtures";
import { context } from "@/lib/tenancy";
import { POST } from "./route";

vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(),
}));

const seal = (body: Record<string, unknown>) =>
  POST(
    postRequest("/api/dossier", {
      tenantId: "tenant-1",
      engagementId: "ENG-1",
      reportId: "REPORT-1",
      ...body,
    }),
  );

describe("POST /api/dossier audience", () => {
  it("refuses a seal request without an audience with 400", async () => {
    const response = await seal({});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose who the dossier is for (internal or client)",
    });
    expect(context).not.toHaveBeenCalled();
  });

  it("refuses an audience other than internal or client with the same message", async () => {
    const response = await seal({ audience: "public" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose who the dossier is for (internal or client)",
    });
  });
});
