import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  explainWorkerFailure,
  WORKER_FAILURE_GUIDANCE,
} from "./worker-failures";

const engine = (file: string) =>
  readFileSync(new URL("../../engine/" + file, import.meta.url), "utf8");

/** The codes of COMPUTE_FAILURE_CODES and FAILURE_CODES in worker_contract.py. */
function contractCodes() {
  const source = engine("worker_contract.py"),
    sets = [
      ...source.matchAll(
        /^(?:COMPUTE_FAILURE_CODES|FAILURE_CODES) = [^\n]*frozenset\(\{([\s\S]*?)\}\)/gm,
      ),
    ];
  expect(sets).toHaveLength(2);
  return new Set(
    sets.flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])),
  );
}

/** The codes in the failure-code table of engine/WORKER.md. */
function documentedCodes() {
  const section = engine("WORKER.md").split("## Failure codes")[1];
  return new Set(
    [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]),
  );
}

describe("worker failure guidance", () => {
  it("covers exactly the worker's documented failure codes", () => {
    const keys = Object.keys(WORKER_FAILURE_GUIDANCE).sort();
    expect(keys).toEqual([...contractCodes()].sort());
    expect(keys).toEqual([...documentedCodes()].sort());
  });
  it("explains a known code with short guidance", () => {
    const explained = explainWorkerFailure("label_set_mismatch");
    expect(explained?.code).toBe("label_set_mismatch");
    expect(explained?.guidance).toContain("output classes");
    for (const guidance of Object.values(WORKER_FAILURE_GUIDANCE))
      expect(guidance.length).toBeLessThanOrEqual(240);
  });
  it("explains an HTTP status code", () => {
    expect(explainWorkerFailure("http_404")).toEqual({
      code: "http_404",
      guidance: expect.stringContaining("HTTP 404"),
    });
    expect(explainWorkerFailure("http_600")?.code).toBeNull();
  });
  it("explains the platform's attempt limit", () => {
    expect(
      explainWorkerFailure("Maximum attempts exhausted")?.guidance,
    ).toContain("Five claims");
  });
  it("falls back to the raw text for unknown codes", () => {
    expect(explainWorkerFailure("Worker execution failed")).toEqual({
      code: null,
      guidance: "Worker execution failed",
    });
    expect(explainWorkerFailure("toString")).toEqual({
      code: null,
      guidance: "toString",
    });
    expect(explainWorkerFailure(null)).toBeNull();
    expect(explainWorkerFailure("")).toBeNull();
  });
});
