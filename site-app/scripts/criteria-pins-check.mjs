// The rule pack stamp of a new engagement, criteria pins, the read-time
// legacy pin and GET /api/coverage (docs/design/criteria-model.md section 16),
// against the built Worker in Miniflare. Split out of the former
// scripts/integration-check.mjs (#52).
import assert from "node:assert/strict";
import {
  apiClient,
  base,
  fixtureUsers,
  identity,
  startWorker,
} from "./harness/worker.mjs";

const { mf, testDb, transport } = await startWorker("audit-criteria-pins");
try {
  const { owner, viewer } = fixtureUsers();
  const h = identity;
  let workspace, e, tenantId;
  const { request, management, command } = apiClient(transport, owner, {
    get tenantId() {
      return tenantId;
    },
    get workspace() {
      return workspace;
    },
    set workspace(value) {
      workspace = value;
    },
    get e() {
      return e;
    },
    set e(value) {
      e = value;
    },
  });
  workspace = await request("/api/workspace");
  e = workspace.engagement;
  tenantId = workspace.tenantId;
  // #18: a new engagement carries the stamp of the rule pack the catalog serves.
  const rulePack = workspace.catalog.regulatorySnapshot;
  assert.deepEqual(e.rulePack, {
    version: workspace.catalog.methodologyVersion,
    legalVersion: rulePack.celex,
    researchedAsOf: rulePack.researchedAsOf,
    legalReview: "pending",
  });
  assert.equal(e.classification.version, rulePack.celex);
  assert.equal(e.classification.asOf, rulePack.researchedAsOf);
  console.log("PASS a new engagement carries the served rule pack's stamp");
  await command("grantMember", {
    userId: viewer,
    displayName: "Client Viewer",
    role: "Client Viewer",
    clientId: e.clientId,
  });
  // #27: criteria pins, the read-time legacy pin and GET /api/coverage
  // (docs/design/criteria-model.md section 16, integration harness).
  {
    const packKey = "eu-ai-act@02024R1689-20260727";
    assert.equal(workspace.criteria.pin.packId, "eu-ai-act-amended");
    assert.equal(workspace.criteria.origin, "created");
    assert.deepEqual(workspace.criteria.features, {
      annexIvIndex: true,
      aiActClassification: true,
      obligationAssessments: true,
      statementOfApplicability: false,
      nonconformityGrading: false,
      certificationRecommendation: false,
      ll144BiasAudit: false,
    });
    assert.equal(workspace.criteria.draft, false);
    assert.equal(workspace.criteria.managementSystem, undefined);
    assert.equal(workspace.criteria.frameworks[0].legalReviewPending, true);
    assert.equal(
      e.criteria.pin.packVersion,
      workspace.criteria.pin.packVersion,
    );
    assert.equal(
      workspace.selectablePacks.map((p) => p.id).join(),
      "eu-ai-act-amended,genai-evaluation,nyc-ll144-bias-audit",
    );
    const chosen = await management("createEngagement", {
      clientId: e.clientId,
      title: "Criteria pack fixture",
      packId: "eu-ai-act-amended",
      packVersion: workspace.criteria.pin.packVersion,
    });
    assert.equal(chosen.details.pack.id, "eu-ai-act-amended");
    await management(
      "createEngagement",
      { clientId: e.clientId, title: "Unknown pack", packId: "no-such-pack" },
      owner,
      400,
    );
    // An engagement stored before pins: no criteria and no #18 stamp.
    const legacyId = chosen.details.engagementId;
    await testDb
      .prepare(
        "UPDATE engagements SET body=json_remove(body,'$.criteria','$.rulePack') WHERE tenant_id=? AND id=?",
      )
      .bind(tenantId, legacyId)
      .run();
    const scope = new URLSearchParams({ tenantId, engagementId: legacyId });
    const legacy = await request("/api/workspace?" + scope);
    assert.equal(legacy.criteria.origin, "legacy");
    // Every legacy class resolves to pack #1 2026.11.2; new engagements pin
    // the current version (2026.11.3 since #61, the same programme).
    assert.equal(legacy.criteria.pin.packId, workspace.criteria.pin.packId);
    assert.equal(legacy.criteria.pin.packVersion, "2026.11.2");
    assert.equal(legacy.catalog.methodologyVersion, "2026.11.2");
    // Its template commands behave as before and write no pin.
    const created = await request("/api/workspace", {
      method: "POST",
      body: {
        op: "createPaper",
        data: { templateId: "WP-A09-01" },
        tenantId,
        engagementId: legacyId,
        expectedVersion: legacy.engagement.version,
      },
    });
    assert(created.engagement.papers.some((p) => p.templateId === "WP-A09-01"));
    const stored = await testDb
      .prepare(
        "SELECT json_type(body,'$.criteria') AS criteria FROM engagements WHERE tenant_id=? AND id=?",
      )
      .bind(tenantId, legacyId)
      .first();
    assert.equal(stored.criteria, null, "M0 writes nothing to the engagement");
    // M1 (#61): the explicit legacy pin goes through the normal save, with
    // an audit event and a version bump, and its reversal removes it.
    const storedPin = async () =>
      (await testDb
        .prepare(
          "SELECT json_extract(body,'$.criteria.origin') AS origin, json_extract(body,'$.criteria.pin.packVersion') AS version FROM engagements WHERE tenant_id=? AND id=?",
        )
        .bind(tenantId, legacyId)
        .first()) ?? {};
    const pinnedM1 = await request("/api/workspace", {
      method: "POST",
      body: {
        op: "pinCriteria",
        data: {},
        tenantId,
        engagementId: legacyId,
        expectedVersion: created.engagement.version,
      },
    });
    assert.equal(pinnedM1.engagement.version, created.engagement.version + 1);
    assert.deepEqual(
      { ...(await storedPin()) },
      { origin: "legacy", version: "2026.11.2" },
    );
    const afterPin = await request("/api/workspace?" + scope);
    assert.equal(afterPin.criteria.origin, "legacy");
    assert.deepEqual(afterPin.criteria.pin, legacy.criteria.pin);
    const event = await testDb
      .prepare(
        "SELECT action FROM audit_events WHERE tenant_id=? AND engagement_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .bind(tenantId, legacyId)
      .first();
    assert.equal(event?.action, "pinCriteria");
    await request("/api/workspace", {
      method: "POST",
      body: {
        op: "unpinCriteria",
        data: {},
        tenantId,
        engagementId: legacyId,
        expectedVersion: pinnedM1.engagement.version,
      },
    });
    assert.deepEqual(
      { ...(await storedPin()) },
      { origin: null, version: null },
    );
    const views = await request("/api/coverage?" + scope);
    // The AI Act criteria view, then the NIST crosswalk views (#29).
    assert.deepEqual(
      views.views.map((v) => v.key),
      [packKey, "nist-ai-rmf@1.0", "nist-ai-600-1@2024-07"],
    );
    const nist = await request(
      "/api/coverage?" + scope + "&framework=nist-ai-rmf%401.0",
    );
    assert.equal(nist.view.kind, "crosswalk");
    assert.equal(nist.summary.full, 0, "NIST is never fully covered");
    const coverage = await request(
      "/api/coverage?" + scope + "&framework=" + encodeURIComponent(packKey),
    );
    assert.equal(coverage.summary.full, 0, "Migrated links are partial");
    assert(coverage.summary.total > 90);
    assert(coverage.banners.some((b) => b.id === "migration"));
    assert(coverage.banners.some((b) => b.id === "legal-review"));
    await request("/api/coverage?" + scope + "&framework=iso-iec-42001@2023", {
      status: 404,
    });
    await request("/api/coverage?" + scope, { user: viewer, status: 403 });
    // #135: derived applicability dates and the internal-only CSV export.
    assert(coverage.banners.some((b) => b.id === "derived-applicability"));
    const exportPath =
      "/api/coverage?" +
      scope +
      "&" +
      new URLSearchParams({
        framework: packKey,
        format: "csv",
        actor: "Provider",
      });
    const csv = await transport(base + exportPath, { headers: h(owner) });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /^text\/csv/);
    assert.match(csv.headers.get("content-disposition"), /attachment/);
    const csvLines = (await csv.text()).trimEnd().split("\r\n");
    assert(csvLines[0].startsWith("view,framework_data_version,pack"));
    assert(csvLines.length > 1 && csvLines.length < coverage.summary.total);
    assert(csvLines.slice(1).every((l) => l.includes("Provider")));
    await request(exportPath, { user: viewer, status: 403 });
    // A rule-pack stamp the index does not know fails closed.
    await testDb
      .prepare(
        'UPDATE engagements SET body=json_set(body,\'$.rulePack\',json(\'{"version":"2026.12.9","legalVersion":"x","researchedAsOf":"2026-12-01","legalReview":"pending"}\')) WHERE tenant_id=? AND id=?',
      )
      .bind(tenantId, legacyId)
      .run();
    await request("/api/coverage?" + scope, { status: 500 });
    console.log(
      "PASS criteria pins: default pack, chosen pack, legacy pin without writes, explicit legacy pin and its reversal, coverage views, derived applicability, the CSV export, client 403 and unknown stamps fail closed",
    );
  }
} finally {
  await mf.dispose();
}
