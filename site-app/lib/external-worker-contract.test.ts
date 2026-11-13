import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertClaimFits,
  assertDeclaredLabel,
  assertModelSpecLimits,
  assertPerformancePositiveLabel,
  claimResponse,
  claimResponseBytes,
  frozenLabelPair,
  WORKER_LIMITS,
} from "./external-worker-contract";
import { ApiError } from "./http";
import { id } from "./ids";

const workerContract = readFileSync(
  new URL("../../engine/worker_contract.py", import.meta.url),
  "utf8",
);

function refusal(f: () => unknown) {
  try {
    f();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Expected a refusal");
}

describe("the worker limits", () => {
  const number = (pattern: RegExp) => {
    const match = pattern.exec(workerContract);
    if (!match) throw new Error("Not found in worker_contract.py: " + pattern);
    return match[1]
      .split("*")
      .map((x) => Number(x.trim()))
      .reduce((a, b) => a * b, 1);
  };
  it("are the numbers engine/worker_contract.py enforces", () => {
    expect(number(/^MAX_ENVELOPE_BYTES = ([\d* ]+)$/m)).toBe(
      WORKER_LIMITS.maxResponseBytes,
    );
    expect(number(/not 1 <= len\(columns\) <= (\d+)/)).toBe(
      WORKER_LIMITS.maxFeatureColumns,
    );
    expect(
      number(/task == "binary_classification" and len\(labels\) != (\d+)/),
    ).toBe(WORKER_LIMITS.binaryOutputLabels);
    expect(
      number(
        /task == "multiclass_classification" and not 2 <= len\(labels\) <= (\d+)/,
      ),
    ).toBe(WORKER_LIMITS.maxClassLabels);
  });
});

describe("frozenLabelPair", () => {
  const binary = {
    task: "Binary classification",
    classOrder: ["no", "yes"],
    positiveLabel: "yes",
  };
  it("derives the other class from the system's two output classes", () => {
    expect(frozenLabelPair(binary)).toEqual({
      positiveLabel: "yes",
      negativeLabel: "no",
    });
    expect(
      frozenLabelPair({ ...binary, positiveLabel: "no", requested: "yes" }),
    ).toEqual({ positiveLabel: "no", negativeLabel: "yes" });
  });
  it("accepts the other class when the auditor names it", () => {
    expect(frozenLabelPair({ ...binary, requested: "no" })?.negativeLabel).toBe(
      "no",
    );
  });
  it("refuses an other label that is not the system's other class", () => {
    for (const requested of ["0", "yes", "No"]) {
      const error = refusal(() => frozenLabelPair({ ...binary, requested }));
      expect(error.status).toBe(400);
      expect(error.message).toContain("must be 'no'");
    }
  });
  it("refuses a favourable label outside the output classes", () => {
    const error = refusal(() =>
      frozenLabelPair({ ...binary, positiveLabel: "1" }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toContain("'1' is not one of");
  });
  it("needs exactly two output classes for a binary model", () => {
    for (const classOrder of [[], ["yes"], ["no", "yes", "maybe"]]) {
      const error = refusal(() => frozenLabelPair({ ...binary, classOrder }));
      expect(error.status).toBe(400);
      expect(error.message).toContain(
        "declare exactly two output classes; it declares " + classOrder.length,
      );
    }
  });
  it("freezes no negative label for other tasks and refuses one", () => {
    const multiclass = {
      task: "Multiclass classification",
      classOrder: ["a", "b", "c"],
      positiveLabel: "",
    };
    expect(frozenLabelPair(multiclass)).toBeUndefined();
    expect(
      frozenLabelPair({ ...multiclass, task: "Regression", classOrder: [] }),
    ).toBeUndefined();
    expect(
      refusal(() => frozenLabelPair({ ...multiclass, requested: "a" })).status,
    ).toBe(400);
  });
});

describe("assertDeclaredLabel", () => {
  const plan = { version: "1.0.0", criteria: [] };
  it("accepts a binary plan whose declared other label is the system's", () => {
    expect(() =>
      assertDeclaredLabel(plan, "no", { negativeLabel: "no" }),
    ).not.toThrow();
  });
  it("refuses a binary plan that declares another other label", () => {
    const error = refusal(() =>
      assertDeclaredLabel(plan, "0", { negativeLabel: "no" }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toContain(
      "declares the other binary class label '0', but the system revision's other output class is 'no'",
    );
  });
  it("has nothing to check without a plan or for other tasks", () => {
    // A 1.0 protocol: the frozen pair comes from the system alone.
    expect(() =>
      assertDeclaredLabel(undefined, "0", { negativeLabel: "no" }),
    ).not.toThrow();
    // Multiclass and regression 1.1 protocols store negativeLabel ''.
    expect(() => assertDeclaredLabel(plan, "", undefined)).not.toThrow();
  });
  it("lets an empty request on a non-binary 1.1 protocol through", () => {
    const pair = frozenLabelPair({
      task: "Multiclass classification",
      classOrder: ["a", "b", "c"],
      positiveLabel: "",
      requested: "",
    });
    expect(pair).toBeUndefined();
    expect(() => assertDeclaredLabel(plan, "", pair)).not.toThrow();
  });
});

describe("assertPerformancePositiveLabel", () => {
  const pair = frozenLabelPair({
    task: "Binary classification",
    classOrder: ["fraud", "ok"],
    positiveLabel: "ok",
  });
  it("accepts either output class, and empty for the favourable label", () => {
    for (const label of ["ok", "fraud", " fraud ", "", undefined])
      expect(() => assertPerformancePositiveLabel(label, pair)).not.toThrow();
  });
  it("refuses a class the system revision does not output", () => {
    for (const label of ["1", "Fraud", "declined"]) {
      const error = refusal(() => assertPerformancePositiveLabel(label, pair));
      expect(error.status).toBe(400);
      expect(error.message).toContain(
        `the class '${label}', which is not one of the system revision's output classes ('ok', 'fraud')`,
      );
    }
  });
  it("has nothing to check for tasks without a frozen pair", () => {
    expect(() =>
      assertPerformancePositiveLabel("fraud", undefined),
    ).not.toThrow();
  });
  it("names the label pair the worker requires (engine/worker_contract.py)", () => {
    // The worker refuses any other class with protocol_config_invalid.
    expect(workerContract).toMatch(
      /def performance_positive_label\([\s\S]*?value\.strip\(\) not in \{labels\["positiveLabel"\], labels\["negativeLabel"\]\}[\s\S]*?protocol_config_invalid/,
    );
  });
});

describe("assertModelSpecLimits", () => {
  const labels = (n: number) => Array.from({ length: n }, (_, i) => "c" + i);
  it("accepts 1 and 100 feature columns and refuses 0 and 101", () => {
    for (const featureCount of [1, 100])
      expect(() =>
        assertModelSpecLimits({
          task: "Binary classification",
          featureCount,
          outputLabels: labels(2),
        }),
      ).not.toThrow();
    for (const featureCount of [0, 101]) {
      const error = refusal(() =>
        assertModelSpecLimits({
          task: "Binary classification",
          featureCount,
          outputLabels: labels(2),
        }),
      );
      expect(error.status).toBe(400);
      expect(error.message).toContain("1 to 100 feature columns");
    }
  });
  it("needs exactly two binary output classes", () => {
    for (const n of [1, 3])
      expect(
        refusal(() =>
          assertModelSpecLimits({
            task: "Binary classification",
            featureCount: 3,
            outputLabels: labels(n),
          }),
        ).status,
      ).toBe(400);
  });
  it("accepts 2 to 100 multiclass output classes", () => {
    for (const n of [2, 100])
      expect(() =>
        assertModelSpecLimits({
          task: "Multiclass classification",
          featureCount: 3,
          outputLabels: labels(n),
        }),
      ).not.toThrow();
    for (const n of [1, 101])
      expect(
        refusal(() =>
          assertModelSpecLimits({
            task: "Multiclass classification",
            featureCount: 3,
            outputLabels: labels(n),
          }),
        ).status,
      ).toBe(400);
  });
  it("refuses output classes on a regression model", () => {
    expect(() =>
      assertModelSpecLimits({
        task: "Regression",
        featureCount: 3,
        outputLabels: [],
      }),
    ).not.toThrow();
    expect(
      refusal(() =>
        assertModelSpecLimits({
          task: "Regression",
          featureCount: 3,
          outputLabels: ["a"],
        }),
      ).status,
    ).toBe(400);
  });
});

describe("the claim response size", () => {
  const jobId = id("JOB"),
    hash = "a".repeat(64);
  it("equals the size of a real claim response", () => {
    const requestJSON = JSON.stringify({ text: 'quoted "label" é\n' });
    const real = new TextEncoder().encode(
      JSON.stringify(
        claimResponse(
          {
            jobId,
            attemptId: id("ATTEMPT"),
            fence: 5,
            nonce: crypto.randomUUID(),
            leaseUntil: new Date(Date.now() + 120000).toISOString(),
            requestSha256: hash,
          },
          requestJSON,
        ),
      ),
    ).byteLength;
    expect(claimResponseBytes(jobId, hash, requestJSON)).toBe(real);
  });
  it("refuses a request whose claim would exceed 2 MiB, and no smaller one", () => {
    const request = (n: number) => JSON.stringify({ pad: "x".repeat(n) }),
      base = claimResponseBytes(jobId, hash, request(0));
    // Each character appears once in requestJSON and once in request.
    const fits = Math.floor((WORKER_LIMITS.maxResponseBytes - base) / 2);
    expect(claimResponseBytes(jobId, hash, request(fits))).toBeLessThanOrEqual(
      WORKER_LIMITS.maxResponseBytes,
    );
    expect(() => assertClaimFits(jobId, hash, request(fits))).not.toThrow();
    const error = refusal(() =>
      assertClaimFits(jobId, hash, request(fits + 1)),
    );
    expect(error.status).toBe(413);
    expect(error.message).toContain("over its 2 MiB limit");
  });
  it("counts escaped quotes twice, so about 1 MiB of request is too much", () => {
    const quotes = JSON.stringify({ labels: Array(180000).fill("ab") });
    expect(quotes.length).toBeLessThan(1024 * 1024);
    expect(refusal(() => assertClaimFits(jobId, hash, quotes)).status).toBe(
      413,
    );
  });
});
