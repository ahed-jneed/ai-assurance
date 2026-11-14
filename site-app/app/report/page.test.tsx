// The /report print view's failure answers (#216): a report that cannot be
// rendered answers 500 with the "could not be loaded" fallback and is logged;
// an access refusal shows the refusal's own message on the 403 page. The
// Worker-level statuses are checked end to end in
// scripts/engagement-lifecycle-check.mjs.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";
import { withResponseStatus } from "@/lib/response-status";
import { archivedMessage } from "@/lib/tenancy";
import ReportForbidden from "./forbidden";
import ReportPage from "./page";
import { reportRefusal } from "./refusal";

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
vi.mock("@/lib/client-projection", () => ({
  sanitize: vi.fn(() => ({
    reports: [{ id: "RPT-1", snapshot: state.snapshot }],
  })),
}));
// A request-scoped store, as vinext keeps one per request.
vi.mock("./refusal", () => {
  const store: { message?: string } = {};
  return { reportRefusal: () => store };
});

const params = Promise.resolve({
  tenantId: "t-1",
  engagementId: "ENG-1",
  reportId: "RPT-1",
});

afterEach(() => {
  state.refusal = undefined;
  state.snapshot = undefined;
  delete reportRefusal().message;
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
    expect(reportRefusal().message).toBeUndefined();
  });
});
