// Cross-tenant access beyond isolation.spec.ts: every read route refuses a
// signed-in user from another practice, and a practice's own commands
// cannot reach records of another practice by naming their ids. Nothing of
// the demo practice appears in a refusal.
import { DEMO, expect, ownPractice, test, unique } from "./fixtures";

test("every route refuses a user from another practice", async ({
  api,
  demo,
}) => {
  const outsider = await api("qa-outsider");
  const lead = await api("qa-lead");
  const reportId =
    (
      await lead.workspace(demo.tenantId, demo.engagementId)
    ).engagement.reports.at(-1)?.id ?? "REPORT-any";
  const scope = { tenantId: demo.tenantId, engagementId: demo.engagementId };
  const reads = [
    "/api/workspace?" + new URLSearchParams({ tenantId: demo.tenantId }),
    "/api/assurance?" + new URLSearchParams(scope),
    "/api/work-inbox?" + new URLSearchParams({ tenantId: demo.tenantId }),
    "/api/dossier/keys?" + new URLSearchParams({ tenantId: demo.tenantId }),
    "/api/dossier?" +
      new URLSearchParams({ ...scope, reportId, audience: "internal" }),
    "/api/report-package?" + new URLSearchParams({ ...scope, reportId }),
  ];
  for (const path of reads) {
    const response = await outsider.http.get(path);
    expect([403, 404], path).toContain(response.status());
    const body = await response.text();
    expect(body, path).not.toContain(DEMO.engagement);
    expect(body, path).not.toContain(DEMO.client);
  }
  const writes: [string, Record<string, unknown>][] = [
    [
      "/api/management",
      {
        tenantId: demo.tenantId,
        expectedVersion: 1,
        op: "createClient",
        data: { name: "Planted client", sector: "Other" },
      },
    ],
    [
      "/api/assurance",
      {
        ...scope,
        op: "addLocation",
        data: {
          artifactId: "EV-any",
          label: "Planted",
          kind: "document",
          locator: "line 1",
          excerpt: "x",
          quality: "x",
        },
      },
    ],
    ["/api/dossier", { ...scope, reportId, audience: "internal" }],
  ];
  for (const [path, body] of writes) {
    const response = await outsider.post(path, body);
    expect([403, 404], path).toContain(response.status());
  }
  expect(
    (await lead.workspace(demo.tenantId)).clients.map(
      (c: { name: string }) => c.name,
    ),
  ).not.toContain("Planted client");
});

test("a practice cannot use another practice's records by id", async ({
  api,
  demo,
}) => {
  // qa-lead2 administers a practice of their own and is a member of the
  // demo practice; in their own practice the demo ids do not exist.
  const lead2 = await api("qa-lead2");
  const own = ownPractice(lead2.who);
  const engagement = await lead2.post("/api/management", {
    tenantId: own,
    expectedVersion: (await lead2.workspace(own)).managementVersion,
    op: "createEngagement",
    data: { clientId: demo.clientId, title: `Planted ${unique()}` },
  });
  expect(engagement.status()).toBe(404);
  expect((await engagement.json()).error).toBe("Client not found");

  const grant = await lead2.post("/api/management", {
    tenantId: own,
    expectedVersion: (await lead2.workspace(own)).managementVersion,
    op: "grantMember",
    data: {
      userId: `planted-${unique()}`,
      displayName: "Planted member",
      role: "Auditor",
      engagementIds: [demo.engagementId],
    },
  });
  expect([403, 404]).toContain(grant.status());

  // The demo engagement opened under qa-lead2's own practice is not found.
  const read = await lead2.http.get(
    "/api/workspace?" +
      new URLSearchParams({ tenantId: own, engagementId: demo.engagementId }),
  );
  expect([403, 404]).toContain(read.status());
  expect(await read.text()).not.toContain(DEMO.engagement);
});
