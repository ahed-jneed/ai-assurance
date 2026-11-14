// The papers an internal export carries as working-paper contract documents
// (#51): the dossier files them under papers/, and the report package lists
// them as workingPapers.
import type { Engagement, Report } from "../domain/types";
import { completionMemo } from "./completion";
import type { PaperRevision } from "./revision";

/**
 * The papers the report captured (snapshot.workingPapers) and, once the final
 * package is released, its completion memo. Empty for packages captured
 * before the contract: they keep their captured papers only.
 */
export async function exportedPapers(
  ctx: { tenantId: string },
  e: Engagement,
  r: Report,
): Promise<PaperRevision[]> {
  const captured = r.snapshot.workingPapers as
    { documents?: PaperRevision[] } | undefined;
  if (!Array.isArray(captured?.documents)) return [];
  const memo = await completionMemo(e, r, ctx.tenantId);
  return [...captured.documents, ...(memo ? [memo] : [])];
}
