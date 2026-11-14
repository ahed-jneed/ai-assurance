// The /report print view's failure answers (#216, #220): a report that cannot
// be rendered answers 500 and a damaged record 409 or 503, each with the
// "could not be loaded" fallback and logged; an access refusal shows the
// refusal's own message on the 403 page. The
// Worker-level statuses are checked end to end in
// scripts/engagement-lifecycle-check.mjs.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrityError } from "@/lib/engagement-storage";
import { ApiError, responseError } from "@/lib/http";
import { withResponseStatus } from "@/lib/response-status";
import { archivedMessage } from "@/lib/tenancy";
import ReportForbidden from "./forbidden";
import ReportPage from "./page";
import { reportMarkup, type ReportSnapshot } from "./report-markup";
import { printRefusal } from "@/app/print-refusal";

const state = vi.hoisted(() => ({
  refusal: undefined as unknown,
  snapshot: undefined as unknown,
}));

// Next's own forbidden() needs its authInterrupts flag; vinext's throws a
// digest like these.
vi.mock("next/navigation", () => {
  const fallback = (status: number) => () => {
    throw Object.assign(new Error("fallback"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;" + status,
    });
  };
  return { forbidden: fallback(403), notFound: fallback(404) };
});
vi.mock("@/app/chatgpt-auth", () => ({
  requireChatGPTUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(async () => {
    if (state.refusal) throw state.refusal;
    return { tenantId: "t-1" };
  }),
}));
vi.mock("@/lib/engagement-repo", () => ({
  getEngagement: vi.fn(async () => ({})),
}));
// A released report as the client projection shows it, with every field
// reportMarkup reads, so that a test fails only where its snapshot does.
const projected = vi.hoisted(() => () => ({
  id: "RPT-1",
  kind: "final" as const,
  createdAt: "2026-11-05T10:00:00.000Z",
  releasedAt: "2026-11-05T10:00:00.000Z",
  actor: "",
  sha256: "client-sha",
  replaces: [],
  snapshot: state.snapshot as Record<string, unknown>,
}));
vi.mock("@/lib/client-projection", () => ({
  sanitize: vi.fn(() => ({ reports: [projected()] })),
}));
// A request-scoped store, as vinext keeps one per request.
vi.mock("@/app/print-refusal", () => {
  const store: { message?: string } = {};
  return { printRefusal: () => store };
});

const params = Promise.resolve({
  tenantId: "t-1",
  engagementId: "ENG-1",
  reportId: "RPT-1",
});

afterEach(() => {
  state.refusal = undefined;
  state.snapshot = undefined;
  delete printRefusal().message;
  vi.restoreAllMocks();
});

describe("the /report print view", () => {
  it("answers a report it cannot render with 500 and the fallback, and logs the error", async () => {
    // A malformed snapshot: reportMarkup cannot read it.
    state.snapshot = null;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await withResponseStatus(async () => {
      const page = await ReportPage({ searchParams: params });
      return new Response(renderToStaticMarkup(page));
    });
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Report unavailable");
    expect(html).toContain("The report could not be loaded.");
    expect(log).toHaveBeenCalledWith(
      "The /report print view could not be rendered:",
      expect.any(TypeError),
    );
  });

  it("answers a failure in a child component with 500 and the fallback (#234 item 8)", async () => {
    // reportMarkup itself reads this snapshot; only its CriteriaPackLine
    // child fails, on the null framework list.
    state.snapshot = {
      engagement: { id: "ENG-1", title: "Credit scoring audit" },
      criteriaPack: { packId: "eu-ai-act", packVersion: "1", frameworks: null },
      papers: [],
      findings: [],
      evidence: [],
    };
    // reportMarkup returns its element tree without throwing: the failure
    // happens only when the child component renders.
    const tree = reportMarkup(
      projected(),
      state.snapshot as unknown as ReportSnapshot,
    );
    expect(() => renderToStaticMarkup(tree)).toThrow(TypeError);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await withResponseStatus(async () => {
      const page = await ReportPage({ searchParams: params });
      return new Response(renderToStaticMarkup(page));
    });
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Report unavailable");
    expect(html).not.toContain("Credit scoring audit");
    expect(log).toHaveBeenCalledWith(
      "The /report print view could not be rendered:",
      expect.any(TypeError),
    );
  });

  it.each([
    ["mismatch", 409],
    ["unreadable", 409],
    ["missing", 503],
    ["unavailable", 503],
  ] as const)(
    "answers a %s record with %i like /api/report-package, not 404 (#220)",
    async (kind, status) => {
      const damaged = new IntegrityError("ENG-1", kind, "body");
      state.refusal = damaged;
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await withResponseStatus(async () => {
        const page = await ReportPage({ searchParams: params });
        return new Response(renderToStaticMarkup(page));
      });
      expect(response.status).toBe(status);
      // The same status the package endpoint answers for the same error.
      expect(responseError(damaged).status).toBe(status);
      const html = await response.text();
      expect(html).toContain("The report could not be loaded.");
      expect(html).not.toContain("has not been released");
      expect(log).toHaveBeenCalledWith(
        "The /report print view could not be rendered:",
        damaged,
      );
    },
  );

  it("shows the refusal's own message on the 403 page", async () => {
    state.refusal = new ApiError(403, archivedMessage);
    const refused = await ReportPage({ searchParams: params }).catch(
      (error: unknown) => error,
    );
    expect((refused as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;403",
    );
    const html = renderToStaticMarkup(<ReportForbidden />);
    expect(html).toContain(archivedMessage);
    expect(html).not.toContain("You do not have access to this report.");
  });

  it("keeps the generic 403 message when no refusal was recorded", () => {
    expect(renderToStaticMarkup(<ReportForbidden />)).toContain(
      "You do not have access to this report.",
    );
  });

  it("answers a missing report with 404, not a refusal message", async () => {
    state.snapshot = {};
    state.refusal = new ApiError(404, "Engagement not found");
    const refused = await ReportPage({ searchParams: params }).catch(
      (error: unknown) => error,
    );
    expect((refused as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(printRefusal().message).toBeUndefined();
  });
});
