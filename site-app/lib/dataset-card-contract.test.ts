// schemas/dataset-card.schema.json is the language-neutral contract of the
// dataset governance card that runs pin; lib/dataset-card.ts holds the zod
// schemas the app parses cards with. These tests fail when the two disagree:
// on the fields, their constraints, or on what each accepts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  datasetCardExport,
  datasetCardFields,
  datasetCardSchema,
  registeredCard,
  registeredDatasetCardFields,
  registeredDatasetCardSchema,
} from "./dataset-card";
import { ApiError } from "./http";

type JsonSchema = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  allOf?: unknown[];
};
const contract = JSON.parse(
  readFileSync(
    new URL("../../schemas/dataset-card.schema.json", import.meta.url),
    "utf8",
  ),
) as { $defs: Record<string, JsonSchema> };
// The validators in schemas/ load the same Ajv 2020 build from site-app.
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL("../../schemas/dataset-card.schema.json", import.meta.url),
      "utf8",
    ),
  ),
) as (value: unknown) => boolean;

type Check = { kind: string; value?: number; regex?: RegExp };
const checks = (t: z.ZodTypeAny): Check[] =>
  (t._def as { checks?: Check[] }).checks ?? [];
const unwrap = (t: z.ZodTypeAny): z.ZodTypeAny =>
  t instanceof z.ZodOptional || t instanceof z.ZodDefault
    ? unwrap(t._def.innerType)
    : t instanceof z.ZodEffects
      ? unwrap(t._def.schema)
      : t;
const trimmed = (t: z.ZodTypeAny) => checks(t).some((c) => c.kind === "trim");

/** The JSON Schema a zod field corresponds to, for the fields cards use. */
function expected(t: z.ZodTypeAny): JsonSchema {
  const inner = unwrap(t);
  if (inner instanceof z.ZodLiteral) return { const: inner._def.value };
  if (inner instanceof z.ZodEnum) return { enum: [...inner._def.values] };
  if (inner instanceof z.ZodNumber) {
    const min = checks(inner).find((c) => c.kind === "min");
    expect(checks(inner).some((c) => c.kind === "int")).toBe(true);
    return { type: "integer", ...(min ? { minimum: min.value } : {}) };
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    return {
      type: "object",
      additionalProperties: false,
      required: Object.keys(shape)
        .filter((k) => !shape[k].isOptional())
        .sort(),
      properties: Object.fromEntries(
        Object.entries(shape).map(([k, v]) => [k, expected(v)]),
      ),
    };
  }
  if (!(inner instanceof z.ZodString)) throw Error("Unmapped zod field");
  const min = checks(inner).find((c) => c.kind === "min")?.value,
    max = checks(inner).find((c) => c.kind === "max")?.value,
    regex = checks(inner).find((c) => c.kind === "regex")?.regex,
    // A calendar date is a refined YYYY-MM-DD string.
    date = t instanceof z.ZodEffects;
  return {
    type: "string",
    ...(min ? { minLength: min } : {}),
    ...(max !== undefined ? { maxLength: max } : {}),
    ...(regex
      ? { pattern: regex.source }
      : trimmed(inner)
        ? {
            pattern: min
              ? "^\\S(?:[\\s\\S]*\\S)?$"
              : "^(?:\\S(?:[\\s\\S]*\\S)?)?$",
          }
        : {}),
    ...(date ? { format: "date" } : {}),
  };
}
/** The JSON Schema's own view of a definition, without its documentation. */
function described(s: JsonSchema): JsonSchema {
  const { type, additionalProperties, required, properties } = s;
  if (properties)
    return {
      type,
      additionalProperties,
      required: [...(required ?? [])].sort(),
      properties: Object.fromEntries(
        Object.entries(properties).map(([k, v]) => [k, described(v)]),
      ),
    };
  return Object.fromEntries(
    Object.entries(s).filter(([k]) => !["title", "description"].includes(k)),
  ) as JsonSchema;
}
function fromZod(o: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const e = expected(o);
  // A defaulted field is always present once parsed, but cards stored
  // before it existed lack it, so the contract does not require it.
  const shape = o.shape as Record<string, z.ZodTypeAny>;
  e.required = Object.keys(shape)
    .filter(
      (k) => !shape[k].isOptional() && !(shape[k] instanceof z.ZodDefault),
    )
    .sort();
  return e;
}

describe("the dataset card contract", () => {
  it("declares the zod fields with the same constraints", () => {
    expect(described(contract.$defs.declaredCard)).toEqual(
      fromZod(datasetCardFields),
    );
    expect(described(contract.$defs.registeredCard)).toEqual(
      fromZod(registeredDatasetCardFields),
    );
  });

  it("requires a baseline rationale with a baseline in both", () => {
    const rule = {
      if: { required: ["baselineDatasetRecordId"] },
      then: {
        required: ["baselineRationale"],
        properties: { baselineRationale: { type: "string", minLength: 1 } },
      },
    };
    expect(contract.$defs.declaredCard.allOf).toEqual([rule]);
    expect(contract.$defs.registeredCard.allOf).toEqual([rule]);
  });

  // A card the app produces: registerDataset parses the declaration and
  // stores it with the accepted bytes it describes.
  const card = registeredDatasetCardSchema.parse({
    schemaVersion: "1.0",
    name: "Applicant holdout",
    version: "2026-Q3",
    artifactId: "EV-holdout",
    owner: "Credit risk analytics",
    split: "test",
    population: "Consumer credit applications, Q3 2026",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    collectionMethod: "Exported from the decision log",
    independence: "Held out from training and tuning",
    sensitiveDataBasis: "",
    limitations: "Online channel only",
    artifactSha256: "a".repeat(64),
    artifactName: "holdout.csv",
    artifactSize: 4096,
  });
  const baseline = {
    ...card,
    baselineDatasetRecordId: "AS-baseline",
    baselineRationale: "The prior quarter in production",
    baselinePin: {
      recordId: "AS-baseline",
      sha256: "b".repeat(64),
      artifactSha256: "c".repeat(64),
    },
  };
  // Each case: a card and what it changes. A card is valid when zod parses
  // it unchanged; the JSON Schema must agree on every case but one.
  const cases: [string, Record<string, unknown>][] = [
    ["the app's card", card],
    ["a card with a baseline", baseline],
    [
      "a card with a sensitive-data basis",
      { ...card, sensitiveDataBasis: "Art 4a basis recorded" },
    ],
    ["an unknown field", { ...card, arbitrary: true }],
    ["another version", { ...card, schemaVersion: "1.1" }],
    ["a missing owner", { ...card, owner: undefined }],
    ["a blank name", { ...card, name: "  " }],
    ["an untrimmed name", { ...card, name: " Holdout" }],
    ["a name of 300 characters", { ...card, name: "n".repeat(300) }],
    ["a name of 301 characters", { ...card, name: "n".repeat(301) }],
    [
      "a population of 5001 characters",
      { ...card, population: "p".repeat(5001) },
    ],
    ["an unknown split", { ...card, split: "holdout" }],
    ["30 February", { ...card, periodEnd: "2026-02-30" }],
    ["29 February of a leap year", { ...card, periodStart: "2024-02-29" }],
    ["a date with a time", { ...card, periodStart: "2026-07-01T00:00:00Z" }],
    ["a baseline without a rationale", { ...baseline, baselineRationale: "" }],
    ["an upper-case hash", { ...card, artifactSha256: "A".repeat(64) }],
    ["a fractional size", { ...card, artifactSize: 1.5 }],
    ["a negative size", { ...card, artifactSize: -1 }],
    ["a size as text", { ...card, artifactSize: "4096" }],
    [
      "a baseline pin with an unknown field",
      { ...baseline, baselinePin: { ...baseline.baselinePin, extra: 1 } },
    ],
    [
      "a missing baseline pin hash",
      {
        ...baseline,
        baselinePin: {
          recordId: "AS-baseline",
          artifactSha256: "c".repeat(64),
        },
      },
    ],
  ];
  it.each(cases)("agrees with zod on %s", (_, value) => {
    const input = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const parsed = registeredDatasetCardSchema.safeParse(input);
    const valid = parsed.success && isDeepStrictEqual(parsed.data, input);
    expect(validate(input)).toBe(valid);
  });

  it("leaves only the period order to the application", () => {
    // JSON Schema cannot compare dates; validate-dataset-card-schema.mjs
    // and the application check the order.
    const reversed = { ...card, periodStart: "2026-10-01" };
    expect(registeredDatasetCardSchema.safeParse(reversed).success).toBe(false);
    expect(validate(reversed)).toBe(true);
  });
});

describe("the card body registerDataset stores", () => {
  const declared = datasetCardSchema.parse({
      schemaVersion: "1.0",
      name: "Applicant holdout",
      version: "2026-Q3",
      artifactId: "EV-holdout",
      owner: "Credit risk analytics",
      split: "test",
      population: "Consumer credit applications, Q3 2026",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      collectionMethod: "Exported from the decision log",
      independence: "Held out from training and tuning",
      sensitiveDataBasis: "",
      limitations: "Online channel only",
    }),
    artifact = { sha256: "a".repeat(64), name: "holdout.csv", size: 4096 },
    baseline = {
      id: "AS-baseline",
      sha256: "b".repeat(64),
      body: { artifactSha256: "c".repeat(64) },
    };
  const refusal = (f: () => unknown) => {
    try {
      f();
    } catch (error) {
      return error;
    }
    throw Error("expected a refusal");
  };

  it("meets the registered card contract, with and without a baseline", () => {
    const plain = registeredCard(declared, artifact);
    expect(validate(plain)).toBe(true);
    expect(registeredDatasetCardSchema.parse(plain)).toEqual(plain);
    const withBaseline = registeredCard(
      {
        ...declared,
        baselineDatasetRecordId: "AS-baseline",
        baselineRationale: "The prior quarter in production",
      },
      artifact,
      baseline,
    );
    expect(validate(withBaseline)).toBe(true);
    expect(withBaseline.baselinePin).toEqual({
      recordId: "AS-baseline",
      sha256: "b".repeat(64),
      artifactSha256: "c".repeat(64),
    });
    // The stored bytes keep the order the body was built in.
    expect(Object.keys(plain).slice(-3)).toEqual([
      "artifactSha256",
      "artifactName",
      "artifactSize",
    ]);
  });

  it("is exported from the registry in the canonical schema (#234 item 9)", () => {
    for (const body of [
      registeredCard(declared, artifact),
      registeredCard(
        {
          ...declared,
          baselineDatasetRecordId: "AS-baseline",
          baselineRationale: "The prior quarter in production",
        },
        artifact,
        baseline,
      ),
    ]) {
      // A record body with a field outside the contract keeps it out of
      // the export.
      const { fileName, card } = datasetCardExport({
        body: { ...body, internalNote: "not part of the card" },
      });
      expect(validate(card)).toBe(true);
      expect(card).toEqual(body);
      expect(fileName).toBe("dataset-card-applicant-holdout-2026-q3.json");
    }
  });

  it("refuses a body the contract rejects instead of storing it", () => {
    for (const [why, f] of [
      [
        "artifactName",
        () => registeredCard(declared, { ...artifact, name: "x".repeat(301) }),
      ],
      [
        "artifactSha256",
        () => registeredCard(declared, { ...artifact, sha256: "not-a-digest" }),
      ],
      [
        "baselinePin.artifactSha256",
        () =>
          registeredCard(
            {
              ...declared,
              baselineDatasetRecordId: "AS-baseline",
              baselineRationale: "The prior quarter in production",
            },
            artifact,
            // A baseline record stored without its bytes' digest.
            { ...baseline, body: {} },
          ),
      ],
    ] as const) {
      const error = refusal(f);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).message).toContain(why);
    }
  });
});
