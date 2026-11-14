// The Withdraw control follows the server's isWithdrawable (#201): a
// superseded report the client can still read stays withdrawable.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Report, Role } from "@/lib/domain/types";
import { isWithdrawable } from "@/lib/workflow-state";
import { ReportRelease } from "./report-release";

const report = (
  state: string,
  released: boolean,
  extra: Partial<Report> = {},
): Report =>
  ({
    id: "R-1",
    kind: "final",
    createdAt: "2026-11-01T09:00:00.000Z",
    actor: "user-auditor",
    sha256: "a".repeat(64),
    snapshot: {},
    clientSnapshot: {},
    clientSha256: "b".repeat(64),
    release: {
      state,
      history: [],
      ...(released ? { releasedAt: "2026-11-02T09:00:00.000Z" } : {}),
    },
    ...extra,
  }) as unknown as Report;

const html = (r: Report, role: Role = "Lead Auditor") =>
  renderToStaticMarkup(
    <ReportRelease
      report={r}
      reports={[r]}
      role={role}
      userId="user-lead"
      busy={false}
      act={async () => ({ engagement: {} as never })}
      onEditing={() => {}}
    />,
  );
const withdraw = />Withdraw<\/button>/;

describe("Withdraw in the release controls", () => {
  it("is offered for a superseded report the client can still read", () => {
    const r = report("superseded", true);
    expect(isWithdrawable(r)).toBe(true);
    expect(html(r)).toMatch(withdraw);
  });
  it("is not offered for a superseded report that was never released", () => {
    const r = report("superseded", false);
    expect(isWithdrawable(r)).toBe(false);
    expect(html(r)).not.toMatch(withdraw);
  });
  it("is not offered for a superseded report without a client projection", () => {
    const r = report("superseded", true, {
      clientSnapshot: undefined,
      clientSha256: undefined,
    });
    expect(html(r)).not.toMatch(withdraw);
  });
  it("is still offered for approved and released reports", () => {
    expect(html(report("approved", false))).toMatch(withdraw);
    expect(html(report("released", true))).toMatch(withdraw);
  });
  it("is offered to the Lead Auditor only", () => {
    expect(html(report("superseded", true), "Reviewer")).not.toMatch(withdraw);
  });
});
