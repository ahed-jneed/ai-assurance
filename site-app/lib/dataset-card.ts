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
export const datasetCardSchema = z
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
  .strict()
  .refine(
    (v) => v.periodStart <= v.periodEnd,
    "The end date must follow the start date",
  )
  .refine(
    (v) => !v.baselineDatasetRecordId || !!v.baselineRationale,
    "Explain the baseline selection",
  );
export type DatasetCard = z.infer<typeof datasetCardSchema>;

/** A registered dataset card record, as the assurance records API returns it. */
type CardRecord = {
  id: string;
  kind: string;
  body: { artifactId?: unknown; artifactSha256?: unknown };
};
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
  const matching = cards.filter(
    (c) =>
      c.kind === "dataset" &&
      c.body.artifactId === artifact.id &&
      c.body.artifactSha256 === artifact.sha256,
  );
  return matching.find((c) => c.id === preferred) ?? matching.at(-1);
}
