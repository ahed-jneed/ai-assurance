// The Art 50 applicability suggestion of one paper as the workspace shows it
// (#120, #152): from the engagement's classification, the catalogue item's
// research procedures and the pinned rule pack's Art 50 dates against the
// engagement period. The audit program shows it on the paper's plan, and
// the paper editor on the papers of engagements without a program. Pure.
import { classificationRules } from "@/lib/classification-rules";
import type { Engagement } from "@/lib/domain";
import {
  art50Dating,
  art50PaperSuggestion,
  type PaperSuggestion,
} from "@/lib/domain/art50-papers";
import { asRulePack, engagementPeriod } from "@/lib/rule-pack";
import { packFeatures, type WorkspaceData } from "../workspace-types";

/** The suggestions of an engagement, by catalogue template id. */
export function art50Suggestions(
  data: Pick<WorkspaceData, "catalog" | "criteria"> | null | undefined,
  e: Pick<Engagement, "classification" | "workflow"> | null | undefined,
): (templateId: string) => PaperSuggestion | null {
  if (!e?.classification || !packFeatures(data).aiActClassification)
    return () => null;
  const pack = asRulePack(data?.catalog?.regulatorySnapshot),
    rules = classificationRules(pack),
    timing = { period: engagementPeriod(e), dating: art50Dating(pack) };
  return (templateId) => {
    const item = data?.catalog?.items.find((i) => i.id === templateId);
    return item
      ? art50PaperSuggestion(e.classification, rules, item, timing)
      : null;
  };
}
