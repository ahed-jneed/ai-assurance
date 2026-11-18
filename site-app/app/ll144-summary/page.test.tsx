// The /ll144-summary page's failure answers (#220), shared with /report
// (app/print-failure.ts): 403 with the refusal's own message, 404 for a
// missing or unpublished summary, 500 for a summary that cannot be rendered
// and the record's own status for a damaged record, each like
// /api/ll144-summary for the same request.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printRefusal } from "@/app/print-refusal";
import { IntegrityError } from "@/lib/engagement-storage";
import { ApiError, responseError } from "@/lib/http";
import { withResponseStatus } from "@/lib/response-status";
import { archivedMessage } from "@/lib/tenancy";
import Ll144SummaryForbidden from "./forbidden";
import Ll144SummaryNotFound from "./not-found";
import Ll144SummaryPage from "./page";

const state = vi.hoisted(() => ({
  failure: undefined as unknown,
  view: undefined as unknown,
}));

// vinext's forbidden() and notFound() throw a digest like these.
vi.mock("next/navigation", () => {
  const fallback = (status: number) => () => {
    throw Object.assign(new Error("fallback"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;" + status,
    });
  };
  return { forbidden: fallback(403), notFound: fallback(404) };
});
vi.mock("@/app/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/tenancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy")>()),
  context: vi.fn(async () => ({ tenantId: "t-1" })),
}));
vi.mock("@/lib/read-models/ll144-summary", () => ({
  ll144SummaryView: vi.fn(async () => {
    if (state.failure) throw state.failure;
    return state.view;
  }),
}));
// A request-scoped store, as vinext keeps one per request.
vi.mock("@/app/print-refusal", () => {
  const store: { message?: string } = {};
  return { printRefusal: () => store };
});

const params = Promise.resolve({
  tenantId: "t-1",
  engagementId: "ENG-1",
  auditId: "LL144-1",
});
const render = () =>
  withResponseStatus(async () => {
    const page = await Ll144SummaryPage({ searchParams: params });
    return new Response(renderToStaticMarkup(page));
  });
const digestOf = async () =>
  (
    (await Ll144SummaryPage({ searchParams: params }).catch(
      (error: unknown) => error,
    )) as { digest?: string }
  ).digest;

afterEach(() => {
  state.failure = undefined;
  state.view = undefined;
  delete printRefusal().message;
  vi.restoreAllMocks();
});

describe("the /ll144-summary page", () => {
  it("answers a refusal with 403 and the refusal's own message", async () => {
    state.failure = new ApiError(403, archivedMessage);
    expect(responseError(state.failure).status).toBe(403);
    expect(await digestOf()).toBe("NEXT_HTTP_ERROR_FALLBACK;403");
    const html = renderToStaticMarkup(<Ll144SummaryForbidden />);
    expect(html).toContain(archivedMessage);
    expect(html).not.toContain("You do not have access to this summary.");
  });

  it("keeps the generic 403 message when no refusal was recorded", () => {
    expect(renderToStaticMarkup(<Ll144SummaryForbidden />)).toContain(
      "You do not have access to this summary.",
    );
  });

  it.each([
    "LL144 audit not found",
    "This report holds no such LL144 summary",
    "LL144 summaries are published with a released report",
  ])("answers %s with 404", async (message) => {
    state.failure = new ApiError(404, message);
    expect(await digestOf()).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(printRefusal().message).toBeUndefined();
    expect(renderToStaticMarkup(<Ll144SummaryNotFound />)).toContain(
      "This summary does not exist or has not been published to you.",
    );
  });

  it("answers a summary it cannot render with 500 and the fallback, and logs the error", async () => {
    // A malformed view: summaryMarkup cannot read it.
    state.view = { summary: null, source: "live" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await render();
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Summary unavailable");
    expect(html).toContain("The summary could not be loaded.");
    expect(log).toHaveBeenCalledWith(
      "The /ll144-summary print view could not be rendered:",
      expect.any(TypeError),
    );
  });

  it("answers a damaged record with its own status, not 200", async () => {
    const damaged = new IntegrityError("ENG-1", "mismatch", "body");
    state.failure = damaged;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await render();
    expect(response.status).toBe(409);
    expect(responseError(damaged).status).toBe(409);
    expect(await response.text()).toContain("The summary could not be loaded.");
  });

  it("answers a failure in a summary table with 500 and the fallback (#234 item 8)", async () => {
    // summaryMarkup itself reads this view; only its Table child fails, on
    // the null category list.
    state.view = {
      source: "live",
      summary: {
        tool: { name: "Resume screener" },
        law: "Local Law 144",
        status: "approved",
        requiredElements: [],
        dataSource: { kind: "historical", source: "", explanation: "" },
        tables: [{ dimension: "sex", title: "Sex", categories: null }],
        exclusions: [],
        notes: [],
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await render();
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Summary unavailable");
    expect(html).not.toContain("Resume screener");
    expect(log).toHaveBeenCalledWith(
      "The /ll144-summary print view could not be rendered:",
      expect.any(TypeError),
    );
  });
});
