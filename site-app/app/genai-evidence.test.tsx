// The GenAI intake buttons and the vault's level badges (#145): "Queue
// ingest" only while a worker is enrolled with genai_ingest, the re-run
// attestation button, and a level badge on each GenAI file of the register.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/domain/types";
import { readGenaiEnvelope } from "@/lib/genai/envelope";
import { genaiArtifactLevels } from "@/lib/genai/evidence-levels";
import { genaiReadiness } from "@/lib/genai/readiness";
import { genaiSummary } from "@/lib/genai/summary";
import { EvidenceRegister } from "./audit-registers";
import { IntakeActions, ResultCard } from "./genai-evidence";

const noop = () => {};
const actions = (
  ingestWorkers: number,
  overrides: Partial<Parameters<typeof IntakeActions>[0]> = {},
) =>
  renderToStaticMarkup(
    <IntakeActions
      view={{
        plans: [{}] as never,
        bundles: [{}] as never,
        ingestWorkers,
      }}
      busy={false}
      canFreeze
      canImport
      canAttest
      onFreeze={noop}
      onDeclare={noop}
      onQueue={noop}
      onImport={noop}
      onAttest={noop}
      {...overrides}
    />,
  );

describe("IntakeActions", () => {
  it("hides Queue ingest until a worker is enrolled with genai_ingest", () => {
    expect(actions(0)).not.toContain("Queue ingest");
    expect(actions(0, { view: null })).not.toContain("Queue ingest");
    expect(actions(1)).toContain("Queue ingest");
    expect(actions(0)).toContain("Import envelope");
  });

  it("offers the re-run attestation, disabled without files to pin", () => {
    expect(actions(0)).toMatch(/<button[^>]*>Attest a re-run<\/button>/);
    expect(actions(0, { canAttest: false })).toMatch(
      /<button[^>]*disabled=""[^>]*>Attest a re-run<\/button>/,
    );
  });
});

describe("EvidenceRegister", () => {
  const file = (id: string, sha: string, category = "GenAI log"): Artifact => ({
    id,
    name: id + ".json",
    category,
    size: 10,
    sha256: sha.repeat(64),
    key: "k/" + id,
    createdAt: "2026-11-05T00:00:00.000Z",
    uploadedBy: "auditor",
    visibility: "internal",
    status: "accepted",
    mediaType: "application/json",
  });
  const files = [
    file("EV-ENV", "e"),
    file("EV-LOG", "a"),
    file("EV-DOC", "c", "Governance"),
  ];
  const html = (levels?: ReturnType<typeof genaiArtifactLevels>) =>
    renderToStaticMarkup(
      <EvidenceRegister
        artifacts={files}
        tenantId="T"
        engagementId="ENG"
        role="Auditor"
        resolve={(id) => id}
        onOpen={noop}
        genaiLevels={levels}
      />,
    );

  it("shows each GenAI file's level and nothing on other files", () => {
    const out = html(
      genaiArtifactLevels(
        [
          {
            artifactId: "EV-ENV",
            readiness: { effectiveLevel: "L1" },
            summary: { inputs: [{ sha256: "a".repeat(64) }] },
          },
        ],
        files,
      ),
    );
    expect(out).toContain('data-genai-file-level="L1"');
    expect(out).toContain("GenAI L1 · hashed tool log");
    expect(out).toContain('data-genai-file-role="input"');
    expect(out).toContain("GenAI input · L1");
    expect(out.match(/data-genai-file-level/g)).toHaveLength(2);
  });

  it("shows no level without the GenAI view", () => {
    expect(html()).not.toContain("data-genai-file-level");
  });
});

describe("ResultCard", () => {
  it("shows a pairwise judge's position-consistency bound and pair count (#233)", async () => {
    const text = readFileSync(
      "../schemas/fixtures/genai-result.example.json",
      "utf8",
    );
    const { envelope, computation } = await readGenaiEnvelope(text);
    const summary = genaiSummary(computation, {
      computationSha256: envelope.computationSha256,
      itemsSha256: envelope.itemsSha256,
    });
    const run = summary.runs[0],
      judge = run.judges[0],
      validation = summary.judgeValidation[0];
    const card = () =>
      renderToStaticMarkup(
        <ResultCard
          result={
            {
              id: "AS-1",
              createdAt: "2026-11-05T00:00:00.000Z",
              custody: "worker",
              authenticatedBy: null,
              attested: false,
              summary,
              readiness: genaiReadiness({
                recordId: "AS-1",
                artifactId: "JOB-1",
                custody: "worker",
                acknowledgements: [],
                attested: false,
                summary,
              }),
            } as never
          }
          reviewer={false}
          busy={false}
          onAcknowledge={noop}
        />,
      );
    // A grader shows kappa only.
    expect(card()).toContain("kappa ");
    expect(card()).not.toContain("position consistency");
    judge.role = "pairwise_judge";
    Object.assign(validation, {
      positionConsistencyLower: 0.85123,
      pairs: 40,
      bindings: [
        { ...validation.bindings[0], runKey: run.runKey, judgeRef: judge.ref },
      ],
    });
    expect(card()).toContain(
      "position consistency lower bound 0.851 on 40 swapped pairs",
    );
    validation.pairs = 0;
    expect(card()).toContain("position consistency: no swapped (AB/BA) pairs");
  });
});
