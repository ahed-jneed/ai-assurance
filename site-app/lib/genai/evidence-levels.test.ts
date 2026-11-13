// The GenAI level of each vault file and the re-run attestation payload
// (#145).
import { describe, expect, it } from "vitest";
import {
  RERUN_STATEMENT,
  attestationPayload,
  genaiArtifactLevels,
  genaiLevelBadge,
  utcInstant,
  type GenaiResultLevelSource,
} from "./evidence-levels";
import type { GenaiLevel } from "./summary";

const sha = (c: string) => c.repeat(64);
const result = (
  artifactId: string,
  level: GenaiLevel,
  inputs: string[],
): GenaiResultLevelSource => ({
  artifactId,
  readiness: { effectiveLevel: level },
  summary: { inputs: inputs.map((sha256) => ({ sha256 })) },
});
const artifacts = [
  { id: "EV-ENV", sha256: sha("e") },
  { id: "EV-RES", sha256: sha("r") },
  { id: "EV-LOG", sha256: sha("a") },
  { id: "EV-LABELS", sha256: sha("b") },
  { id: "EV-OTHER", sha256: sha("c") },
];

describe("genaiArtifactLevels", () => {
  it("gives a result file its effective level and its inputs the highest level of the results that pin them", () => {
    const levels = genaiArtifactLevels(
      [
        result("EV-ENV", "L1", [sha("a"), sha("b")]),
        result("EV-RES", "L2", [sha("a")]),
      ],
      artifacts,
    );
    expect(levels.get("EV-ENV")).toEqual({
      level: "L1",
      role: "result",
      results: 1,
    });
    expect(levels.get("EV-RES")).toEqual({
      level: "L2",
      role: "result",
      results: 1,
    });
    expect(levels.get("EV-LOG")).toEqual({
      level: "L2",
      role: "input",
      results: 2,
    });
    expect(levels.get("EV-LABELS")).toEqual({
      level: "L1",
      role: "input",
      results: 1,
    });
    expect(levels.has("EV-OTHER")).toBe(false);
  });

  it("never shows a result file as an input, and is empty without results", () => {
    const levels = genaiArtifactLevels(
      [result("EV-ENV", "L1", [sha("r")]), result("EV-RES", "L0", [])],
      artifacts,
    );
    expect(levels.get("EV-RES")).toEqual({
      level: "L0",
      role: "result",
      results: 1,
    });
    expect(genaiArtifactLevels([], artifacts).size).toBe(0);
  });
});

describe("genaiLevelBadge", () => {
  it("names the level of a result and the tone the results view uses", () => {
    expect(
      genaiLevelBadge({ level: "L1", role: "result", results: 1 }),
    ).toEqual(
      expect.objectContaining({
        text: "GenAI L1 · hashed tool log",
        tone: "amber",
      }),
    );
    expect(
      genaiLevelBadge({ level: "L3", role: "result", results: 1 }).tone,
    ).toBe("green");
    expect(
      genaiLevelBadge({ level: "L0", role: "result", results: 1 }).tone,
    ).toBe("red");
  });

  it("says an input's level belongs to the results that pin it", () => {
    const b = genaiLevelBadge({ level: "L2", role: "input", results: 2 });
    expect(b.text).toBe("GenAI input · L2");
    expect(b.tone).toBe("neutral");
    expect(b.title).toContain("Pinned by 2 GenAI results");
    expect(b.title).toContain("not to this file");
  });
});

describe("attestationPayload", () => {
  const files = [
    { id: "EV-LOG", sha256: sha("a"), status: "accepted" as const },
    { id: "EV-LABELS", sha256: sha("b"), status: "accepted" as const },
    { id: "EV-NEW", sha256: sha("c"), status: "unverified" as const },
  ];
  const values = {
    artifactIds: ["EV-LOG", "EV-LABELS"],
    harnessName: " inspect_ai ",
    harnessVersion: "0.3.90",
    imageDigest: "",
    endpointHost: "api.example.com",
    snapshot: "model-2026-10-01",
    start: "2026-11-05T09:00",
    end: "2026-11-05T11:30:15Z",
    environment: "Isolated runner, no egress beyond the endpoint",
    statement: RERUN_STATEMENT,
  };

  it("builds the attestGenaiRerun payload from the form", () => {
    expect(attestationPayload(values, files)).toEqual({
      bundleSha256s: [sha("a"), sha("b")],
      harness: { name: "inspect_ai", version: "0.3.90" },
      systemUnderTest: {
        endpointHost: "api.example.com",
        snapshot: "model-2026-10-01",
      },
      runWindow: {
        start: "2026-11-05T09:00:00.000Z",
        end: "2026-11-05T11:30:15.000Z",
      },
      environment: "Isolated runner, no egress beyond the endpoint",
      statement: RERUN_STATEMENT,
    });
    expect(
      attestationPayload(
        { ...values, imageDigest: "sha256:" + sha("d") },
        files,
      ).harness,
    ).toEqual({
      name: "inspect_ai",
      version: "0.3.90",
      imageDigest: "sha256:" + sha("d"),
    });
  });

  it("refuses files that are not accepted, no files, no statement and a reversed window", () => {
    expect(() =>
      attestationPayload({ ...values, artifactIds: ["EV-NEW"] }, files),
    ).toThrow("accepted evidence");
    expect(() =>
      attestationPayload({ ...values, artifactIds: [] }, files),
    ).toThrow("at least one");
    expect(() =>
      attestationPayload({ ...values, statement: "" }, files),
    ).toThrow("statement");
    expect(() =>
      attestationPayload({ ...values, environment: "x".repeat(2001) }, files),
    ).toThrow("at most 2,000 characters");
    expect(() =>
      attestationPayload(
        { ...values, start: "2026-11-05T12:00", end: "2026-11-05T11:00" },
        files,
      ),
    ).toThrow("ends before it starts");
  });
});

describe("utcInstant", () => {
  it("reads a UTC time with or without seconds and Z", () => {
    expect(utcInstant("2026-11-05T09:00", "x")).toBe(
      "2026-11-05T09:00:00.000Z",
    );
    expect(utcInstant("2026-11-05T09:00:05.5Z", "x")).toBe(
      "2026-11-05T09:00:05.500Z",
    );
  });

  it("refuses offsets, dates alone and impossible times", () => {
    for (const v of ["2026-11-05T09:00+01:00", "2026-11-05", "yesterday"])
      expect(() => utcInstant(v, "The run start")).toThrow("UTC time");
    expect(() => utcInstant("2026-13-45T99:00", "The run start")).toThrow(
      "not a valid time",
    );
  });
});
