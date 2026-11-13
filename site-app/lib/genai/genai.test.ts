// GenAI evidence in the workspace (#33): envelope verification, the record
// summary, the readiness gate and the pack's programme items. The committed
// engine envelope schemas/fixtures/genai-result.example.json is the #33
// acceptance bundle (judged_qa_30 with the 200-label file bound to J1);
// variants change its computation and re-pin it, as a tampering worker or a
// different label file would.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packDocument, registry, selectablePacks } from "../criteria/registry";
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
      "f3e6eda381d629c4666a90f4c73431f196b196817e198a067aec6e3891c63f53",
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
    expect(genaiPlan.safeParse({ ...plan, excerpts: "all" }).success).toBe(
      false,
    );
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
  it("is offered at engagement creation with the OWASP lists as supporting criteria", () => {
    expect(
      selectablePacks(registry()).find((p) => p.id === "genai-evaluation"),
    ).toMatchObject({ version: "2026.11.0", workingPapers: 7, memos: 1 });
    const pack = packDocument(registry(), "genai-evaluation", "2026.11.0")!;
    expect(pack.criteria.map((s) => [s.framework, s.role])).toEqual([
      ["eu-ai-act", "primary"],
      ["owasp-llm-top-10", "supporting"],
      ["owasp-agentic-top-10", "supporting"],
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
