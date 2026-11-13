// The attestation dialog's body, the permission-aware action button and the
// view error boundary (F-45, F-74, F-70).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attestedOps } from "@/lib/attestation";
import { AttestationForm } from "./attestation-dialog";
import { DecisionButton } from "./decision-button";
import { ViewBoundary } from "./view-boundary";

const noop = () => {};
const subject = {
  record: "WP-1",
  label: "WP-1 Risk management",
  revision: 4,
  change: "Status reviewed to signed",
  content: {},
};
const digest = "ab".repeat(32);
const form = (overrides: Partial<Parameters<typeof AttestationForm>[0]> = {}) =>
  renderToStaticMarkup(
    <AttestationForm
      op="signPaper"
      subject={subject}
      digest={digest}
      rationale=""
      onRationale={noop}
      error=""
      busy={false}
      onConfirm={noop}
      onCancel={noop}
      {...overrides}
    />,
  );

describe("AttestationForm", () => {
  it("shows the record, revision, change, digest and statement", () => {
    const html = form();
    expect(html).toContain("WP-1 Risk management");
    expect(html).toContain("<dd>4</dd>");
    expect(html).toContain("Status reviewed to signed");
    expect(html).toContain(digest);
    expect(html).toContain(attestedOps.signPaper.statement);
    // The rationale is required and described by the statement.
    expect(html).toMatch(/<textarea[^>]*required=""[^>]*aria-required="true"/);
    expect(html).toMatch(/aria-describedby="[^"]+-statement"/);
    expect(html).toContain(">Sign revision</button>");
  });

  it("waits for the digest before it can be confirmed", () => {
    const html = form({ digest: "" });
    expect(html).toContain("Computing…");
    const submit = /<button[^>]*type="submit"[^>]*>/.exec(html)![0];
    expect(submit).toContain(' disabled=""');
  });

  it("shows the command's failure in the dialog", () => {
    const html = form({
      error:
        "The record changed after you reviewed it. Reload and attest again.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The record changed after you reviewed it.");
  });

  it("says when the record is gone", () => {
    const html = form({ subject: null });
    expect(html).toContain("This record is no longer in the engagement");
    expect(html).not.toContain("<textarea");
  });

  it("labels each attested decision", () => {
    expect(form({ op: "approveClassification" })).toContain(
      ">Approve classification</button>",
    );
    expect(form({ busy: true })).toContain("Recording…");
  });
});

describe("DecisionButton", () => {
  it("hides an action the role may never take", () => {
    expect(
      renderToStaticMarkup(
        <DecisionButton
          state={{
            allowed: false,
            refusal: "role",
            reason: "Only Lead Auditors can do this",
          }}
        >
          Sign
        </DecisionButton>,
      ),
    ).toBe("");
  });

  it("disables an action the independence rule bars and says why", () => {
    const html = renderToStaticMarkup(
      <DecisionButton
        state={{
          allowed: false,
          refusal: "independence",
          reason: "Independent retest confirmation is required",
        }}
      >
        Close verified finding
      </DecisionButton>,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-describedby="([^"]+)"/,
    );
    const id = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(
      `<small id="${id}" class="action-reason">Independent retest confirmation is required</small>`,
    );
  });

  it("enables an allowed action without a reason", () => {
    const html = renderToStaticMarkup(
      <DecisionButton state={{ allowed: true }}>Approve</DecisionButton>,
    );
    expect(html).not.toContain(' disabled=""');
    expect(html).not.toContain("action-reason");
  });
});

describe("ViewBoundary", () => {
  it("turns a render exception into a Reload view notice", () => {
    expect(ViewBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({
      error: new Error("boom"),
    });
    expect(ViewBoundary.getDerivedStateFromError("text").error?.message).toBe(
      "text",
    );
    const boundary = new ViewBoundary({ children: <p>view</p> });
    expect(renderToStaticMarkup(boundary.render())).toBe("<p>view</p>");
    boundary.state = {
      error: new Error("Cannot read properties of undefined"),
    };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('role="alert"');
    expect(html).toContain("This view could not be shown");
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).toContain("Reload view");
  });

  it("names what failed", () => {
    const boundary = new ViewBoundary({ label: "record", children: null });
    boundary.state = { error: new Error("x") };
    expect(renderToStaticMarkup(boundary.render())).toContain("Reload record");
  });
});
