// What the Evidence vault and the re-run attestation form need from the GenAI
// results view (#145): the evidence level each GenAI file carries, and the
// attestGenaiRerun payload built from the form. Pure and client-safe.
import type { Artifact } from "../domain/types";
import type { GenaiLevel } from "./summary";

/**
 * Evidence categories that can hold a GenAI result or its tool logs:
 * compiled worker results, and envelopes and logs uploaded by the team.
 */
export const GENAI_RESULT_CATEGORIES = ["GenAI result", "GenAI log"];

/** The fields of a GenAI result the vault reads (GenaiView["results"]). */
export type GenaiResultLevelSource = {
  artifactId: string;
  readiness: { effectiveLevel: GenaiLevel };
  summary: { inputs: { sha256: string }[] };
};

/**
 * One file's GenAI evidence level. `result`: the file is the envelope or
 * compiled result, with the effective level the readiness gate uses. `input`:
 * the file is a tool log or label file pinned by results, with the highest
 * effective level among them; the level belongs to the results, not the file.
 */
export type GenaiArtifactLevel = {
  level: GenaiLevel;
  role: "result" | "input";
  results: number;
};

const ORDER: GenaiLevel[] = ["L0", "L1", "L2", "L3"];
const higher = (a: GenaiLevel, b: GenaiLevel) =>
  ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

/** The GenAI level of each file of the vault, by artifact id. */
export function genaiArtifactLevels(
  results: readonly GenaiResultLevelSource[],
  artifacts: readonly Pick<Artifact, "id" | "sha256">[],
): Map<string, GenaiArtifactLevel> {
  const out = new Map<string, GenaiArtifactLevel>();
  const add = (
    id: string,
    level: GenaiLevel,
    role: GenaiArtifactLevel["role"],
  ) => {
    const was = out.get(id);
    // A file that is itself a result keeps that role; an input is never
    // shown as a result.
    if (was && was.role === "result" && role === "input") return;
    out.set(
      id,
      was && was.role === role
        ? { role, level: higher(was.level, level), results: was.results + 1 }
        : { role, level, results: 1 },
    );
  };
  for (const r of results)
    add(r.artifactId, r.readiness.effectiveLevel, "result");
  for (const r of results) {
    const pinned = new Set(r.summary.inputs.map((i) => i.sha256));
    for (const a of artifacts)
      if (a.id !== r.artifactId && pinned.has(a.sha256))
        add(a.id, r.readiness.effectiveLevel, "input");
  }
  return out;
}

const LEVEL_NAMES: Record<GenaiLevel, string> = {
  L0: "reported aggregate",
  L1: "hashed tool log",
  L2: "recomputed by the engine",
  L3: "auditor re-run with attestation",
};

/** The vault badge of one file: its text, tone and longer explanation. */
export function genaiLevelBadge(l: GenaiArtifactLevel) {
  if (l.role === "input")
    return {
      text: "GenAI input · " + l.level,
      tone: "neutral",
      title:
        "Pinned by " +
        (l.results > 1 ? l.results + " GenAI results" : "a GenAI result") +
        "; the highest effective level among them is " +
        l.level +
        " (" +
        LEVEL_NAMES[l.level] +
        "). The level belongs to the result, not to this file.",
    };
  return {
    text: "GenAI " + l.level + " · " + LEVEL_NAMES[l.level],
    tone:
      l.level === "L2" || l.level === "L3"
        ? "green"
        : l.level === "L1"
          ? "amber"
          : "red",
    title:
      "Effective evidence level of this GenAI result for the readiness gate: " +
      l.level +
      " (" +
      LEVEL_NAMES[l.level] +
      ").",
  };
}

/** The statement attestGenaiRerun requires, word for word. */
export const RERUN_STATEMENT =
  "I ran this evaluation as described; the pinned files are its unmodified output";

/**
 * A run-window bound typed as UTC ("2026-11-05T09:00", seconds and a final Z
 * optional) as the ISO 8601 UTC string the op expects.
 */
export function utcInstant(value: string, what: string) {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?$/.test(v))
    throw new Error(what + " must be a UTC time such as 2026-11-05T09:00");
  const d = new Date(v.endsWith("Z") ? v : v + "Z");
  if (Number.isNaN(d.getTime())) throw new Error(what + " is not a valid time");
  return d.toISOString();
}

/** The attestGenaiRerun payload from the attestation form's values. */
export function attestationPayload(
  values: Record<string, string | string[]>,
  artifacts: readonly Pick<Artifact, "id" | "sha256" | "status">[],
) {
  const text = (name: string) => {
    const v = values[name];
    return (Array.isArray(v) ? v.join("") : (v ?? "")).trim();
  };
  const ids = values.artifactIds;
  const selected = (Array.isArray(ids) ? ids : ids ? [ids] : []).map((id) => {
    const a = artifacts.find((x) => x.id === id && x.status === "accepted");
    if (!a) throw new Error("Every pinned file must be accepted evidence");
    return a.sha256;
  });
  if (!selected.length)
    throw new Error("Pin the files the re-run produced (at least one)");
  if (text("statement") !== RERUN_STATEMENT)
    throw new Error("Confirm the attestation statement");
  const start = utcInstant(text("start"), "The run start"),
    end = utcInstant(text("end"), "The run end");
  if (start > end) throw new Error("The run ends before it starts");
  if (text("environment").length > 2000)
    throw new Error("Describe the environment in at most 2,000 characters");
  const imageDigest = text("imageDigest");
  return {
    bundleSha256s: [...new Set(selected)],
    harness: {
      name: text("harnessName"),
      version: text("harnessVersion"),
      ...(imageDigest ? { imageDigest } : {}),
    },
    systemUnderTest: {
      endpointHost: text("endpointHost"),
      snapshot: text("snapshot"),
    },
    runWindow: { start, end },
    environment: text("environment"),
    statement: RERUN_STATEMENT,
  };
}
