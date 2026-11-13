// GenAI evidence in the workspace (#33): envelope verification, the record
// summary, the readiness gate and the pack's programme items. The committed
// engine envelope schemas/fixtures/genai-result.example.json is the #33
// acceptance bundle (judged_qa_30 with the 200-label file bound to J1);
// variants change its computation and re-pin it, as a tampering worker or a
// different label file would.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  frameworkDocument,
  packDocument,
  registry,
  selectablePacks,
} from "../criteria/registry";
import { criteriaRegistry, pinned, resolveNew } from "../criteria/pin";
import { coverageFor, offeredViews } from "../criteria/views";
import type { Engagement } from "../domain";
import { freshEngagement } from "../factories";
import { sha256 } from "../ids";
import {
  readGenaiEnvelope,
  type GenaiComputation,
  type GenaiEnvelope,
} from "./envelope";
import {
  GENAI_LIMITATION,
  generativeSystem,
  reportLimitationText,
} from "./limitation";
import {
  GENAI_PROGRAMME_ITEMS,
  effectiveLevel,
  genaiReadiness,
  procedureGenaiBlockers,
  type GenaiResultContext,
} from "./readiness";
import { genaiManifest, genaiPlan } from "./requests";
import { genaiSummary, summaryBytes } from "./summary";

const exampleText = readFileSync(
  "../schemas/fixtures/genai-result.example.json",
  "utf8",
);
const example = JSON.parse(exampleText) as GenaiEnvelope;

/** The example with its computation changed and pinned again. */
async function variant(change: (c: GenaiComputation) => void) {
  const c = JSON.parse(example.computationJSON) as GenaiComputation;
  change(c);
  const computationJSON = JSON.stringify(c);
  return JSON.stringify({
    ...example,
    computationJSON,
    computationSha256: await sha256(computationJSON),
  });
}
async function context(
  text: string,
  extra: Partial<GenaiResultContext> = {},
): Promise<GenaiResultContext> {
  const { envelope, computation } = await readGenaiEnvelope(text);
  return {
    recordId: "AS-1",
    artifactId: "JOB-1",
    custody: "worker",
    acknowledgements: [],
    attested: false,
    summary: genaiSummary(computation, {
      computationSha256: envelope.computationSha256,
      itemsSha256: envelope.itemsSha256,
    }),
    ...extra,
  };
}
const codes = (c: GenaiResultContext) =>
  genaiReadiness(c).blockers.map((b) => b.code);
const RUN = "inspect:26J9VHebzofAtTb52sJ4Ee";

describe("the genai-result/0.1 envelope", () => {
  it("accepts the engine's envelope by its exact strings", async () => {
    const { envelope, computation } = await readGenaiEnvelope(exampleText);
    expect(envelope.computationSha256).toBe(
      // The committed example envelope; it changes with the engine version (runner 1.6.0, #136)
      // and the genai version (0.2.0, #128).
      "a24df93b8a80c6c8f626994aaa3b9e323ee9c0d5b38fa4a3c5c8fcf4b25715b9",
    );
    expect(computation.runs.map((r) => r.runKey)).toEqual([RUN]);
  });

  it("rejects a computation that no longer matches its hash", async () => {
    const tampered = JSON.stringify({
      ...example,
      computationJSON: example.computationJSON.replace('"L2"', '"L3"'),
    });
    await expect(readGenaiEnvelope(tampered)).rejects.toThrow(
      "computationSha256",
    );
  });

  it("rejects inline items that no longer match their hash", async () => {
    const tampered = JSON.stringify({
      ...example,
      itemsJSONL: example.itemsJSONL + "\n",
    });
    await expect(readGenaiEnvelope(tampered)).rejects.toThrow("itemsSha256");
  });

  it("rejects provenance pins that differ from the computation's inputs", async () => {
    const tampered = JSON.stringify({
      ...example,
      provenance: {
        ...example.provenance,
        inputHashes: { "0": "0".repeat(64) },
      },
    });
    await expect(readGenaiEnvelope(tampered)).rejects.toThrow("input hashes");
  });

  it("rejects files that are not envelopes, and unknown envelope fields", async () => {
    await expect(readGenaiEnvelope("not json")).rejects.toThrow("not JSON");
    await expect(readGenaiEnvelope('{"hostedResults":[]}')).rejects.toThrow(
      "genai-result/0.1",
    );
    await expect(
      readGenaiEnvelope(JSON.stringify({ ...example, extra: 1 })),
    ).rejects.toThrow("genai-result/0.1");
  });

  it("rejects a computation without a field the gate reads", async () => {
    const text = await variant((c) => {
      delete (c as Partial<GenaiComputation>).criteria;
    });
    await expect(readGenaiEnvelope(text)).rejects.toThrow("criteria");
  });
});

describe("the genai_result summary", () => {
  it("keeps levels, members, the checklist and the claim scope", async () => {
    const { summary } = await context(exampleText);
    expect(summary.runs[0]).toMatchObject({
      runKey: RUN,
      engineLevel: "L2",
      missing: [],
      harness: "inspect_ai@0.3.287",
      systemUnderTest: { family: "other-fixture-sut" },
    });
    expect(
      summary.runs[0].checklist.find(
        (f) => f.field === "systemUnderTest.family",
      ),
    ).toEqual({ field: "systemUnderTest.family", state: "declared" });
    expect(summary.criteria[0].members[0]).toMatchObject({
      n: 30,
      estimate: 0.9,
      interval: { method: "wilson" },
    });
    expect(summary.criteria[0].members[0].interval!.lower).toBeCloseTo(
      0.743789,
      6,
    );
    expect(summary.runs[0].claimScope[0]).toContain(
      "not accuracy on the population of real inputs",
    );
    expect(summaryBytes(summary)).toBeLessThan(100 * 1024);
  });
});

describe("the GenAI readiness gate", () => {
  it("passes the acceptance bundle with the 200-label judge from the worker", async () => {
    const r = genaiReadiness(await context(exampleText));
    expect(r.blockers).toEqual([]);
    expect(r.effectiveLevel).toBe("L2");
    expect(r.claimScope.join("\n")).toContain("Judge mockllm/judge agreed");
  });

  it("caps an uploaded envelope at L1 until a worker result authenticates it", async () => {
    const uploaded = await context(exampleText, { custody: "uploaded" });
    expect(codes(uploaded)).toEqual(["genai_level_below_l2"]);
    expect(genaiReadiness(uploaded).effectiveLevel).toBe("L1");
    expect(codes({ ...uploaded, authenticatedBy: "AS-worker" })).toEqual([]);
  });

  it("gives L3 only to an attested auditor re-run from the worker", () => {
    const rerun = { summary: { origin: "auditor_rerun" as const } };
    expect(
      effectiveLevel("L2", { ...rerun, custody: "worker", attested: true }),
    ).toBe("L3");
    expect(
      effectiveLevel("L2", { ...rerun, custody: "worker", attested: false }),
    ).toBe("L2");
    expect(
      effectiveLevel("L2", { ...rerun, custody: "uploaded", attested: true }),
    ).toBe("L1");
    expect(
      effectiveLevel("L1", { ...rerun, custody: "worker", attested: true }),
    ).toBe("L1");
  });

  it("blocks a conclusion whose judge failed validation (the 60-label file)", async () => {
    const text = await variant((c) => {
      c.criteria[0].flags = [
        {
          flag: "judge_not_validated",
          runKey: RUN,
          score: "model_graded_qa",
          judgeRef: "J1",
          reasons: ["kappa_lower_bound_below_floor"],
        },
      ];
    });
    expect(codes(await context(text))).toEqual(["genai_judge_not_validated"]);
  });

  it("reports a same-family or undeclared judge separately", async () => {
    const text = await variant((c) => {
      c.criteria[0].flags = [
        {
          flag: "judge_not_validated",
          runKey: RUN,
          score: "model_graded_qa",
          judgeRef: "J1",
          reasons: ["same_family"],
        },
      ];
    });
    expect(codes(await context(text))).toEqual([
      "genai_judge_same_family",
      "genai_judge_not_validated",
    ]);
  });

  it("blocks an unclassified score until it is declared", async () => {
    const text = await variant((c) => {
      c.criteria[0].flags = [
        {
          flag: "judge_not_validated",
          runKey: RUN,
          score: "custom",
          judgeRef: null,
          reasons: ["scorer_kind_unknown"],
        },
      ];
    });
    expect(codes(await context(text))).toEqual(["genai_judge_not_validated"]);
  });

  it("lets a reviewer acknowledge an unbound label file's scope", async () => {
    const text = await variant((c) => {
      c.criteria[0].flags = [
        {
          flag: "judge_not_validated",
          runKey: RUN,
          score: "model_graded_qa",
          judgeRef: "J1",
          reasons: ["judge_validation_unbound"],
        },
      ];
    });
    const open = await context(text);
    expect(codes(open)).toEqual(["genai_judge_not_validated"]);
    expect(genaiReadiness(open).pendingAcknowledgements).toEqual([
      { flag: "judge_validation_scope", runKey: RUN, judgeRef: "J1" },
    ]);
    expect(
      codes({
        ...open,
        acknowledgements: [
          { flag: "judge_validation_scope", runKey: RUN, judgeRef: "J1" },
        ],
      }),
    ).toEqual([]);
  });

  it("needs acknowledgements for post-run edits and tool mismatches", async () => {
    const text = await variant((c) => {
      c.runs[0].postRunEdits!.counts.scoreEdits = 2;
      c.runs[0].reconciliation[0].status = "mismatch";
      c.runs[0].warnings.push({ code: "declaration_conflict", count: 1 });
    });
    const r = await context(text);
    expect(genaiReadiness(r).blockers.map((b) => b.detail)).toEqual([
      "post_run_edits",
      "tool_aggregate_mismatch",
      "declaration_conflict",
    ]);
    expect(
      codes({
        ...r,
        acknowledgements: genaiReadiness(r).pendingAcknowledgements,
      }),
    ).toEqual([]);
  });

  it("blocks small samples, missing intervals and missing metadata", async () => {
    const text = await variant((c) => {
      const m = c.criteria[0].members[0];
      m.reasons = ["below_minimum_sample_size"];
      m.interval = null;
      c.runs[0].runMetadata.completeness.missing = ["decoding"];
    });
    expect(codes(await context(text))).toEqual([
      "genai_below_minimum_items",
      "genai_interval_missing",
      "genai_metadata_incomplete",
    ]);
  });

  it.each(["genai_attack_success", "genai_marking", "genai_paired_difference"])(
    "needs a standard error on every deciding member, %s too",
    async (kind) => {
      const without = await variant((c) => {
        c.criteria[0].kind = kind;
        c.criteria[0].members[0].seIid = null;
      });
      expect(codes(await context(without))).toEqual(["genai_interval_missing"]);
      // A paired difference states its standard error as sePaired.
      const paired = await variant((c) => {
        c.criteria[0].kind = kind;
        Object.assign(c.criteria[0].members[0], {
          seIid: null,
          sePaired: 0.04,
        });
      });
      expect(codes(await context(paired))).toEqual([]);
    },
  );

  it("blocks agentic runs whose tool permissions are unknown", async () => {
    const text = await variant((c) => {
      c.runs[0].runMetadata.tools = {
        agentic: true,
        offered: [{ name: "shell", permission: "unknown" }],
      };
    });
    expect(codes(await context(text))).toEqual([
      "genai_agentic_permissions_unknown",
    ]);
  });

  it("refuses a plan that lowers the judge floor (D-10)", async () => {
    const text = await variant((c) => {
      c.plan.normalized.judgeValidation.minimumKappaLowerBound = 0.4;
    });
    expect(codes(await context(text))).toEqual(["genai_plan_floor_lowered"]);
  });

  it("decides nothing without a confirmatory criterion", async () => {
    const text = await variant((c) => {
      c.criteria[0].decision.role = "exploratory";
    });
    expect(codes(await context(text))).toEqual(["genai_no_deciding_criterion"]);
  });

  it("requires a linked result on a GenAI programme item", () => {
    expect(procedureGenaiBlockers("WP-GA-02", []).map((b) => b.code)).toEqual([
      "genai_result_missing",
    ]);
    expect(procedureGenaiBlockers("WP-A15-01", [])).toEqual([]);
  });
});

describe("plans and manifests the workspace freezes", () => {
  const plan = {
    schemaVersion: "genai-plan/0.1",
    criteria: [{ id: "acc", kind: "genai_mean", metric: "accuracy" }],
  };
  it("accepts raised floors and refuses lowered ones (D-10, D-16)", () => {
    expect(
      genaiPlan.safeParse({
        ...plan,
        judgeValidation: { minimumItems: 80, minimumKappaLowerBound: 0.7 },
      }).success,
    ).toBe(true);
    for (const judgeValidation of [
      { minimumItems: 49 },
      { minimumKappaLowerBound: 0.59 },
      { pairwiseMinimumConsistencyLowerBound: 0.5 },
      { requireDifferentFamily: false },
    ])
      expect(genaiPlan.safeParse({ ...plan, judgeValidation }).success).toBe(
        false,
      );
    expect(
      genaiPlan.safeParse({ ...plan, minimums: { sampleSize: 10 } }).success,
    ).toBe(false);
    for (const excerpts of ["none", "failures", "all"])
      expect(genaiPlan.safeParse({ ...plan, excerpts }).success).toBe(true);
    expect(genaiPlan.safeParse({ ...plan, excerpts: "some" }).success).toBe(
      false,
    );
    const key = {
      keyId: "test-detector-key-1",
      solutionId: "example-detector",
      algorithm: "Ed25519",
      publicKeySPKI:
        "MCowBQYDK2VwAyEABMLQhLHohbbhmtEklJfBudz3SqA9tR6DHXkKUPYuC8U=",
    };
    expect(genaiPlan.safeParse({ ...plan, detectionKeys: [key] }).success).toBe(
      true,
    );
    for (const bad of [
      { ...key, algorithm: "RSA" },
      { ...key, publicKeySPKI: "AAAA" },
      { ...key, extra: 1 },
    ])
      expect(
        genaiPlan.safeParse({ ...plan, detectionKeys: [bad] }).success,
      ).toBe(false);
  });
  it("pins each manifest input once by SHA-256", () => {
    const input = {
      name: "a.eval",
      sha256: "a".repeat(64),
      bytes: 10,
      format: "inspect_eval",
      role: "log",
    };
    const manifest = {
      schemaVersion: "genai-bundle/0.1",
      origin: "auditee_supplied",
      inputs: [input],
    };
    expect(genaiManifest.safeParse(manifest).success).toBe(true);
    expect(
      genaiManifest.safeParse({ ...manifest, inputs: [input, input] }).success,
    ).toBe(false);
    expect(
      genaiManifest.safeParse({
        ...manifest,
        inputs: [{ ...input, format: "pickle" }],
      }).success,
    ).toBe(false);
  });
});

describe("the genai-evaluation pack", () => {
  it("lists exactly the GenAI programme items as working papers", () => {
    const pack = packDocument(registry(), "genai-evaluation", "2026.11.0")!;
    expect(
      pack.items.filter((i) => i.kind === "working_paper").map((i) => i.id),
    ).toEqual([...GENAI_PROGRAMME_ITEMS]);
  });
  it("is offered at engagement creation with the OWASP lists and MITRE ATLAS as supporting criteria", () => {
    expect(
      selectablePacks(registry()).find((p) => p.id === "genai-evaluation"),
    ).toMatchObject({ version: "2026.11.2", workingPapers: 7, memos: 1 });
    expect(
      packDocument(registry(), "genai-evaluation", "2026.11.0")!.criteria.map(
        (s) => [s.framework, s.role],
      ),
    ).toEqual([
      ["eu-ai-act", "primary"],
      ["owasp-llm-top-10", "supporting"],
      ["owasp-agentic-top-10", "supporting"],
    ]);
    const pack = packDocument(registry(), "genai-evaluation", "2026.11.1")!;
    expect(pack.criteria.map((s) => [s.framework, s.role])).toEqual([
      ["eu-ai-act", "primary"],
      ["owasp-llm-top-10", "supporting"],
      ["owasp-agentic-top-10", "supporting"],
      ["mitre-atlas", "supporting"],
    ]);
  });
});

describe("the genai-evaluation pack's crosswalk links (#145)", () => {
  const r = registry();
  const before = packDocument(r, "genai-evaluation", "2026.11.0")!,
    after = packDocument(r, "genai-evaluation", "2026.11.1")!;
  const added = (framework: string) =>
    after.controlObjectives.flatMap((o) =>
      o.addresses
        .filter((l) => l.requirement.startsWith(framework + ":"))
        .map((l) => ({ objective: o.id, ...l })),
    );

  it("changes nothing of 2026.11.0 but adds links, criteria sets and notes", () => {
    const strip = (p: typeof before) => ({
      ...p,
      version: undefined,
      methodologyVersion: undefined,
      summary: undefined,
      notes: undefined,
      criteria: p.criteria.filter((s) =>
        ["eu-ai-act", "owasp-llm-top-10", "owasp-agentic-top-10"].includes(
          s.framework,
        ),
      ),
      controlObjectives: p.controlObjectives.map((o) => ({
        ...o,
        addresses: o.addresses.filter(
          (l) => !/^(mitre-atlas|nist-ai-600-1):/.test(l.requirement),
        ),
      })),
    });
    expect(strip(after)).toEqual(strip(before));
  });

  it("links MITRE ATLAS conservatively: intersects_with, justified, to techniques that exist", () => {
    const set = after.criteria.find((s) => s.framework === "mitre-atlas")!;
    const atlas = frameworkDocument(
      r,
      "mitre-atlas",
      set.edition,
      set.version,
    )!;
    expect([atlas.edition, atlas.licence.status]).toEqual([
      "2026.10",
      "confirmed",
    ]);
    const techniques = new Map(atlas.requirements.map((n) => [n.id, n]));
    const links = added("mitre-atlas");
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.relationship).toBe("intersects_with");
      expect(l.origin).toBe("authored");
      expect(l.justification).toContain("not an official crosswalk");
      const node = techniques.get(l.requirement.split(":")[1]);
      expect(node?.type, l.requirement).toBe("requirement");
    }
    // Every listed technique is linked, and each title is ours to show.
    expect(new Set(links.map((l) => l.requirement.split(":")[1])).size).toBe(
      techniques.size,
    );
    for (const n of atlas.requirements) {
      expect(n.title!.length).toBeLessThanOrEqual(80);
      expect(n).not.toHaveProperty("text");
    }
    // Retired identifiers (design section 9.1) and reconnaissance, discovery
    // or attacker-side techniques the tests do not emulate stay unmapped.
    for (const id of [
      "AML.T0056",
      "AML.T0057",
      "AML.T0064",
      "AML.T0060",
      "AML.T0062",
      "AML.T0088",
    ])
      expect(techniques.has(id)).toBe(false);
    // Each justification says what the link rests on: objectives that assess
    // the client's evidence never claim a test emulates the technique.
    const evidenceAssessed = [
      "CO-GA-SUPPLY-CHAIN",
      "CO-GA-DATA-MODEL-POISONING",
    ];
    for (const l of links) {
      if (evidenceAssessed.includes(l.objective)) {
        expect(l.justification).toContain("No test emulates this technique");
        expect(l.justification).not.toContain("success rate");
      } else {
        expect(l.justification).toContain(
          "The test emulates this technique against the system under test",
        );
      }
    }
    expect(
      new Set(
        links
          .filter((l) => evidenceAssessed.includes(l.objective))
          .map((l) => l.requirement),
      ),
    ).toEqual(
      new Set([
        "mitre-atlas:AML.T0010",
        "mitre-atlas:AML.T0020",
        "mitre-atlas:AML.T0018.000",
      ]),
    );
    // The test-plan and client-policy objectives map to no technique.
    for (const id of ["CO-GA-PLAN", "CO-GA-POLICY-VIOLATION"])
      expect(links.some((l) => l.objective === id)).toBe(false);
  });
});

describe("the genai-evaluation pack's NIST AI 600-1 links (#161)", () => {
  const r = registry();
  const before = packDocument(r, "genai-evaluation", "2026.11.1")!,
    after = packDocument(r, "genai-evaluation", "2026.11.2")!;
  const GAI = "nist-ai-600-1@2024-07";
  const links = after.controlObjectives.flatMap((o) =>
    o.addresses
      .filter((l) => l.requirement.startsWith("nist-ai-600-1:"))
      .map((l) => ({ objective: o.id, ...l, risk: l.requirement.slice(14) })),
  );
  const risksOf = (objective: string) =>
    links.filter((l) => l.objective === objective).map((l) => l.risk);

  it("changes nothing of 2026.11.1 but adds the NIST links, their criteria set and notes", () => {
    expect(after.criteria.map((s) => [s.framework, s.role])).toEqual([
      ["eu-ai-act", "primary"],
      ["owasp-llm-top-10", "supporting"],
      ["owasp-agentic-top-10", "supporting"],
      ["mitre-atlas", "supporting"],
      ["nist-ai-600-1", "supporting"],
    ]);
    const strip = (p: typeof before) => ({
      ...p,
      version: undefined,
      methodologyVersion: undefined,
      summary: undefined,
      notes: undefined,
      criteria: p.criteria.filter((s) => s.framework !== "nist-ai-600-1"),
      controlObjectives: p.controlObjectives.map((o) => ({
        ...o,
        addresses: o.addresses.filter(
          (l) => !l.requirement.startsWith("nist-ai-600-1:"),
        ),
      })),
    });
    expect(strip(after)).toEqual(strip(before));
    // The released 2026.11.1 has no NIST link (rule 1: it never changes).
    expect(
      before.controlObjectives.some((o) =>
        o.addresses.some((l) => l.requirement.startsWith("nist-ai-600-1:")),
      ),
    ).toBe(false);
  });

  it("links NIST AI 600-1 conservatively: intersects_with, justified, to risks that exist", () => {
    const set = after.criteria.find((s) => s.framework === "nist-ai-600-1")!;
    const gai = frameworkDocument(
      r,
      "nist-ai-600-1",
      set.edition,
      set.version,
    )!;
    expect([gai.edition, gai.version, gai.licence.status]).toEqual([
      "2024-07",
      "2026.11.0",
      "confirmed",
    ]);
    const risks = new Map(gai.requirements.map((n) => [n.id, n]));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.relationship).toBe("intersects_with");
      expect(l.rationale).toBe("semantic");
      expect(l.origin).toBe("authored");
      expect(l.justification).toContain("not an official crosswalk");
      expect(l.justification).toContain(
        "does not establish that it is identified and managed",
      );
      // A risk, never the section group: no link claims all twelve.
      expect(risks.get(l.risk)?.type, l.requirement).toBe("requirement");
    }
    // The objectives and the risks they bear on directly.
    expect(
      Object.fromEntries(
        after.controlObjectives.map((o) => [o.id, risksOf(o.id)]),
      ),
    ).toEqual({
      "CO-GA-PLAN": [],
      "CO-GA-PROMPT-INJECTION-DIRECT": ["2.9"],
      "CO-GA-PROMPT-INJECTION-INDIRECT": ["2.9"],
      "CO-GA-JAILBREAK": ["2.9"],
      "CO-GA-GOAL-HIJACK": ["2.9"],
      "CO-GA-HIDDEN-CONTEXT-EXPOSURE": ["2.9"],
      "CO-GA-SENSITIVE-INFORMATION-DISCLOSURE": ["2.4"],
      "CO-GA-VECTOR-EMBEDDING-WEAKNESS": ["2.4", "2.9"],
      "CO-GA-EXCESSIVE-AGENCY": ["2.9"],
      "CO-GA-PRIVILEGE-ABUSE": ["2.9"],
      "CO-GA-UNEXPECTED-CODE-EXECUTION": ["2.9"],
      "CO-GA-IMPROPER-OUTPUT-HANDLING": ["2.9"],
      "CO-GA-MEMORY-CONTEXT-POISONING": ["2.9"],
      "CO-GA-DATA-MODEL-POISONING": ["2.9", "2.12"],
      "CO-GA-SUPPLY-CHAIN": ["2.12"],
      "CO-GA-UNBOUNDED-CONSUMPTION": [],
      "CO-GA-INTER-AGENT-COMMUNICATION": ["2.9"],
      "CO-GA-CASCADING-FAILURE": [],
      "CO-GA-HUMAN-TRUST-EXPLOITATION": ["2.7"],
      "CO-GA-ROGUE-AGENT": [],
      "CO-GA-MISINFORMATION": ["2.2"],
      "CO-GA-CAPABILITY-ACCURACY": [],
      "CO-GA-HARMFUL-CONTENT": ["2.3", "2.11"],
      "CO-GA-BIAS-FAIRNESS": ["2.6"],
      "CO-GA-AI-INTERACTION-DISCLOSURE": ["2.7"],
      "CO-GA-SYNTHETIC-CONTENT-MARKING": ["2.8"],
      "CO-GA-POLICY-VIOLATION": [],
    });
    // No test or assessed evidence bears on these risks: they stay unmapped.
    const linked = new Set(links.map((l) => l.risk));
    expect(
      gai.requirements
        .filter((n) => n.type === "requirement" && !linked.has(n.id))
        .map((n) => n.id),
    ).toEqual(["2.1", "2.5", "2.10"]);
    // Each justification says what the link rests on.
    const evidenceAssessed = [
      "CO-GA-SUPPLY-CHAIN",
      "CO-GA-DATA-MODEL-POISONING",
    ];
    for (const l of links)
      if (evidenceAssessed.includes(l.objective)) {
        expect(l.justification).toContain("No test emulates it");
        expect(l.justification).not.toContain("success rate");
      } else {
        expect(l.justification).toContain("the test produces evidence");
        expect(l.justification).toMatch(/holds? only for/);
      }
  });

  /** A GenAI engagement whose every working paper is signed as supported. */
  const signedEngagement = (version: string) => {
    const e = freshEngagement(
      resolveNew("genai-evaluation", version),
      "CL-1",
      "GenAI",
      "lead",
    );
    for (const p of e.papers.filter((p) => p.templateId.startsWith("WP-GA-")))
      Object.assign(p, {
        status: "signed",
        body: { ...p.body, conclusionStatus: "supported" },
        reviews: [{ userId: "reviewer", revision: 1, at: "2026-11-13" }],
        signatures: [
          {
            userId: "lead",
            revision: 1,
            at: "2026-11-13",
            hash: "0".repeat(64),
          },
        ],
      });
    return e;
  };
  type Cell = { id: string; state: string };
  const cells = (e: Engagement, key: string) =>
    coverageFor(criteriaRegistry(), pinned(e), e, [], key)!.cells as Cell[];

  it("shows NIST AI 600-1 as a criteria view of a new engagement, never fully covered", () => {
    const e = signedEngagement("2026.11.2");
    expect(e.criteria?.pin).toMatchObject({
      packId: "genai-evaluation",
      packVersion: "2026.11.2",
    });
    expect(
      offeredViews(criteriaRegistry(), pinned(e)).find((v) => v.key === GAI),
    ).toMatchObject({ kind: "criteria", role: "supporting" });
    const view = coverageFor(criteriaRegistry(), pinned(e), e, [], GAI)!;
    const state = new Map(
      (view.cells as Cell[]).map((c) => [c.id, c.state] as const),
    );
    // Every paper is supported, yet intersects_with links stay partial.
    for (const id of [
      "2.2",
      "2.3",
      "2.4",
      "2.6",
      "2.7",
      "2.8",
      "2.9",
      "2.11",
      "2.12",
    ])
      expect(state.get(id), id).toBe("partial");
    for (const id of ["2.1", "2.5", "2.10"])
      expect(state.get(id), id).toBe("unmapped");
    expect([...state.values()]).not.toContain("full");
    expect(view.summary.full).toBe(0);
    expect(view.groups.every((g) => g.rollup === null)).toBe(true);
  });

  it("leaves engagements pinned to 2026.11.1 as they were", () => {
    const e = signedEngagement("2026.11.1");
    expect(pinned(e).pack.version).toBe("2026.11.1");
    // NIST AI 600-1 is still reached only through the AI Act crosswalk.
    expect(
      offeredViews(criteriaRegistry(), pinned(e)).find((v) => v.key === GAI),
    ).toMatchObject({ kind: "crosswalk" });
    expect(cells(e, GAI).some((c) => c.state === "full")).toBe(false);
    expect(
      offeredViews(criteriaRegistry(), pinned(e)).map((v) => [v.key, v.kind]),
    ).toEqual([
      ["eu-ai-act@02024R1689-20260727", "criteria"],
      ["owasp-llm-top-10@2026", "criteria"],
      ["owasp-agentic-top-10@2025-12", "criteria"],
      ["mitre-atlas@2026.10", "criteria"],
      ["nist-ai-rmf@1.0", "crosswalk"],
      [GAI, "crosswalk"],
    ]);
  });
});

describe("the report's generative-AI limitation (#80)", () => {
  const text = "No conformity assessment. " + GENAI_LIMITATION;
  it("stays while the system may be generative and no GenAI evidence covers it", () => {
    expect(
      reportLimitationText(text, { generative: true, genaiCovered: false }),
    ).toBe(text);
    expect(
      reportLimitationText(text, {
        generative: "unknown",
        genaiCovered: false,
      }),
    ).toBe(text);
  });
  it("goes for a non-generative system or once GenAI evidence covers the engagement", () => {
    expect(
      reportLimitationText(text, { generative: false, genaiCovered: false }),
    ).toBe("No conformity assessment.");
    expect(
      reportLimitationText(text, { generative: true, genaiCovered: true }),
    ).toBe("No conformity assessment.");
  });
  it("reads the classification facts", () => {
    const c = (values: Record<string, boolean>) =>
      generativeSystem({
        classification: {
          annexRoute: "",
          operatorRole: "",
          status: "provisional",
          answers: Object.fromEntries(
            Object.entries(values).map(([fact, value]) => [
              fact,
              { value, legalVersion: "02024R1689-20260727" },
            ]),
          ),
        } as never,
      });
    expect(c({})).toBe("unknown");
    expect(c({ generatesSyntheticContent: true })).toBe(true);
    expect(
      c({
        generatesSyntheticContent: false,
        generatesSyntheticText: false,
        generatesSyntheticImage: false,
        generatesSyntheticAudio: false,
        generatesSyntheticVideo: false,
        gpaiModelProvider: false,
        gpaiDownstreamProvider: false,
        builtOnOwnGpaiModel: false,
      }),
    ).toBe(false);
  });
});
