import { z } from "zod";
const short = z.string().trim().min(1).max(300),
  note = z.string().trim().min(1).max(5000);
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Use a valid calendar date");
/**
 * The fields of a dataset governance card as an auditor declares it. The
 * language-neutral contract is schemas/dataset-card.schema.json; the test
 * lib/dataset-card-contract.test.ts fails when the two disagree.
 */
export const datasetCardFields = z
  .object({
    schemaVersion: z.literal("1.0"),
    name: short,
    version: short,
    artifactId: short,
    owner: short,
    split: z.enum(["training", "validation", "test", "reference", "unknown"]),
    population: note,
    periodStart: calendarDate,
    periodEnd: calendarDate,
    collectionMethod: note,
    independence: note,
    sensitiveDataBasis: z.string().trim().max(5000),
    limitations: note,
    baselineDatasetRecordId: short.optional(),
    baselineRationale: z.string().trim().max(5000).default(""),
  })
  .strict();
type CardRules = {
  periodStart: string;
  periodEnd: string;
  baselineDatasetRecordId?: string;
  baselineRationale: string;
};
const periodOrdered = (v: CardRules) => v.periodStart <= v.periodEnd,
  baselineExplained = (v: CardRules) =>
    !v.baselineDatasetRecordId || !!v.baselineRationale;
export const datasetCardSchema = datasetCardFields
  .refine(periodOrdered, "The end date must follow the start date")
  .refine(baselineExplained, "Explain the baseline selection");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
/**
 * The card body the records API stores for registerDataset and runs pin as
 * `manifest.dataset.cardPin.card`: the declared card with the accepted bytes
 * it describes and, for a regression baseline, the baseline card's pin.
 */
export const registeredDatasetCardFields = datasetCardFields
  .extend({
    artifactSha256: digest,
    // Upload names are sanitised and cut to 200 characters.
    artifactName: z.string().max(300),
    artifactSize: z.number().int().min(0),
    baselinePin: z
      .object({
        recordId: short,
        sha256: digest,
        artifactSha256: digest,
      })
      .strict()
      .optional(),
  })
  .strict();
export const registeredDatasetCardSchema = registeredDatasetCardFields
  .refine(periodOrdered, "The end date must follow the start date")
  .refine(baselineExplained, "Explain the baseline selection");
export type DatasetCard = z.infer<typeof datasetCardSchema>;
export type RegisteredDatasetCard = z.infer<typeof registeredDatasetCardSchema>;

/** A registered dataset card record, as the assurance records API returns it. */
type CardRecord = {
  id: string;
  kind: string;
  body: { artifactId?: unknown; artifactSha256?: unknown };
};
/**
 * Whether a registered card record describes these exact bytes: a dataset
 * card for the artifact id and its SHA-256.
 */
export function cardDescribes(
  card: CardRecord,
  artifact: { id: string; sha256: string },
) {
  return (
    card.kind === "dataset" &&
    card.body.artifactId === artifact.id &&
    card.body.artifactSha256 === artifact.sha256
  );
}
/**
 * The dataset card to pin to an evaluation of `artifact`: the `preferred`
 * card when it describes these exact bytes, otherwise the latest card that
 * does. Records are in registration order. A card for other bytes is never
 * chosen, so a card handed over for one evaluation cannot leak into another.
 */
export function datasetCardFor<T extends CardRecord>(
  cards: readonly T[],
  artifact: { id: string; sha256: string } | undefined,
  preferred?: string,
): T | undefined {
  if (!artifact) return undefined;
  const matching = cards.filter((c) => cardDescribes(c, artifact));
  return matching.find((c) => c.id === preferred) ?? matching.at(-1);
}
