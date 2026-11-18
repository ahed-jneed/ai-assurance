import { z } from "./zod";
export const savedViewSchema = z
  .object({
    id: z.string().max(80),
    name: z.string().trim().min(1).max(60),
    module: z.string().max(80),
    search: z.string().max(300),
    filter: z.string().max(80),
    facet: z.string().max(80),
    sort: z.string().max(80),
  })
  .strict();
export const preferencesSchema = z
  .object({
    views: z.array(savedViewSchema).max(20),
    reminderDays: z.union([z.literal(1), z.literal(3), z.literal(7)]),
    snoozed: z
      .array(
        z.object({ id: z.string().max(500), until: z.string().datetime() }),
      )
      .max(100),
    /**
     * The coverage heatmap's filters (docs/design/criteria-model.md section
     * 15.2): a state, an actor and an applicability date, each "all", "none"
     * or a value. Optional, so preferences saved before #135 still parse.
     */
    coverage: z
      .object({
        state: z.string().min(1).max(40),
        actor: z.string().min(1).max(80),
        date: z.union([
          z.literal("all"),
          z.literal("none"),
          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ]),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PersonalPreferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: PersonalPreferences = {
  views: [],
  reminderDays: 3,
  snoozed: [],
};
export const draftKinds = [
  "paper",
  "brief",
  "procedure-plan",
  "procedure-execution",
  "procedure-assessment",
] as const;
export type DraftKind = (typeof draftKinds)[number];
