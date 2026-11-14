// Round-4 access fixes (#225): Edit access lists engagements for every staff
// role, the minimal shell of an account with no active role, and the
// contributor names of the Client submissions panel. The real clicks are in
// e2e/round4-access.spec.ts; the server sides are in
// lib/commands/assurance/access.test.ts, lib/read-models/workspace-view.test.ts
// and lib/workspace-links.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { approvedWorkflow, engagement } from "@/lib/workflow/test-fixtures";
// The build defines this (vite.config.ts); the account menu reads it.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__SITES_IDENTITY_DEFAULT__ =
    undefined;
});
import { AccountMenu } from "./account-menu";
import { ClientSubmissions, grantHolderLabel } from "./client-portal";
import { refusedAccountName } from "./workspace/use-workspace-data";
import { engagementFlags, memberEditModal } from "./workspace/modals/member";
import { NoAccessShell } from "./workspace/no-access-shell";
import type { WorkspaceData } from "./workspace-types";

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("Edit access for a staff member", () => {
  const data = {
    identity: { id: "lead", role: "Lead Auditor", practiceAdmin: true },
    engagements: [
      { id: "ENG-1", title: "Held audit" },
      { id: "ENG-2", title: "Other audit" },
    ],
    clients: [],
  } as unknown as WorkspaceData;
  const Fields = memberEditModal.Fields!;
  const fields = (role: string, originalRole = role) =>
    renderToStaticMarkup(
      <Fields
        kind="memberEdit"
        choices={{ userId: "eqr", displayName: "Quinn", role, originalRole }}
        checks={engagementFlags(["ENG-1"])}
        choice={noop}
        check={noop}
        data={data}
        engagement={null}
        finding={null}
        role="Lead Auditor"
        lead
      />,
    );
  const box = (html: string, title: string) =>
    html
      .split("<label>")
      .find((label) => label.includes(title))!
      .split(">")[0];

  it("lists the engagements for every staff role without a role change", () => {
    for (const role of [
      "Engagement Quality Reviewer",
      "Auditor",
      "Reviewer",
      "Lead Auditor",
    ]) {
      const html = fields(role);
      expect(html, role).toContain("<legend>Engagement access</legend>");
      // The current grant stays ticked and fixed; the others can be added.
      expect(box(html, "Held audit"), role).toMatch(/checked/);
      expect(box(html, "Held audit"), role).toMatch(/disabled/);
      expect(box(html, "Other audit"), role).not.toMatch(/checked|disabled/);
      expect(text(html)).toContain("Team &amp; runtime");
    }
  });

  it("keeps listing them, all editable, on a role change", () => {
    const html = fields("Engagement Quality Reviewer", "Reviewer");
    expect(html).toContain(
      "Engagements kept with the new role (all others are withdrawn)",
    );
    expect(box(html, "Held audit")).toMatch(/checked/);
    expect(box(html, "Held audit")).not.toMatch(/disabled/);
  });
});

describe("the minimal shell of an account with no active role", () => {
  it("shows who is signed in and nothing of the practice", () => {
    const html = renderToStaticMarkup(
      <NoAccessShell
        name="Revoked Person"
        error="Your practice access has been revoked. Contact a practice administrator."
        account={
          <AccountMenu data={null} signedIn accountName="Revoked Person" />
        }
        onRetry={noop}
      />,
    );
    const visible = text(html);
    expect(visible).toContain("Revoked Person");
    expect(visible).toContain("No practice access");
    expect(visible).toContain("Your practice access has been revoked.");
    expect(html).toContain('aria-label="Account: Revoked Person"');
    for (const practice of [
      "Members &amp; access",
      "Users &amp; access",
      "Clients",
      "Engagements",
      "Search",
      "Audit workspace",
    ])
      expect(visible, practice).not.toContain(practice);
    expect(html).not.toContain("<nav");
  });

  it("reads the signed-in name from a refusal only", () => {
    expect(refusedAccountName({ error: "No", account: { name: "Ann" } })).toBe(
      "Ann",
    );
    expect(refusedAccountName({ error: "No" })).toBe("");
    expect(refusedAccountName({ account: { name: 7 } })).toBe("");
    expect(refusedAccountName(undefined)).toBe("");
  });
});

describe("the Client submissions panel's contributors", () => {
  const grant = (id: string, userId: string) => ({
    id,
    userId,
    requestId: "REQ-" + id,
    prompt: "Prompt " + id,
    instructions: "Upload the file",
    category: "Model",
    handlingBasis: "synthetic" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
    active: true,
    actor: "lead",
    at: "2026-11-01T00:00:00.000Z",
  });
  const data = {
    identity: { id: "auditor", role: "Auditor" },
    // A non-administrator's workspace has no member list.
    members: [],
    clientGrantHolders: [
      { user_id: "casey", display_name: "Casey Contributor", active: true },
      { user_id: "former", display_name: "Former Contributor", active: false },
    ],
    engagement: engagement({
      workflow: {
        ...approvedWorkflow(),
        clientGrants: [
          grant("G1", "casey"),
          grant("G2", "former"),
          grant("G3", "unknown"),
        ],
        submissions: [],
      },
    }),
  } as unknown as WorkspaceData;

  it("names each contributor with their state for the Auditor", () => {
    const visible = text(
      renderToStaticMarkup(
        <ClientSubmissions data={data} busy={false} now={0} onClarify={noop} />,
      ),
    );
    expect(visible).toContain("Casey Contributor · Prompt G1");
    expect(visible).toContain(
      "Former Contributor (access revoked) · Prompt G2",
    );
    expect(visible).toContain("Inactive contributor · Prompt G3");
    expect(visible.match(/Inactive contributor/g)).toHaveLength(1);
    expect(grantHolderLabel(data, "casey")).toBe("Casey Contributor");
  });
});
