import type { AssuranceRecord } from "./assurance-core";
import type { AssuranceRecordPage } from "./assurance-store";
export function currentAssessments(all: AssuranceRecord[]) {
  const superseded = new Set(
    all
      .filter((r) => ["assertion", "impact", "obligation"].includes(r.kind))
      .map((r) => r.body.supersedesId)
      .filter(Boolean),
  );
  return all.filter(
    (r) =>
      ["assertion", "impact", "obligation"].includes(r.kind) &&
      !superseded.has(r.id),
  );
}
export function reviewFor(all: AssuranceRecord[], source: AssuranceRecord) {
  return all
    .filter(
      (r) =>
        r.kind === source.kind + "_review" &&
        (r.body.assertionId ?? r.body.impactId ?? r.body.obligationId) ===
          source.id,
    )
    .at(-1);
}
/**
 * Every assurance record of an engagement, or of one `kind`, in (created_at,
 * id) order, read page by page from GET /api/assurance. `from` is a first
 * page already fetched (the workbench view) to continue after; `onProgress`
 * hears how many records have loaded after each page.
 */
export async function assuranceRecords(
  scope: { tenantId: string; engagementId: string; kind?: string },
  {
    from,
    signal,
    onProgress,
  }: {
    from?: AssuranceRecordPage;
    signal?: AbortSignal;
    onProgress?: (loaded: number) => void;
  } = {},
) {
  const records = [...(from?.records ?? [])];
  let cursor = from ? from.nextCursor : "";
  while (cursor !== null) {
    const params = new URLSearchParams({
      tenantId: scope.tenantId,
      engagementId: scope.engagementId,
    });
    if (scope.kind) params.set("kind", scope.kind);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch("/api/assurance?" + params, {
        cache: "no-store",
        signal,
      }),
      page = (await response.json()) as AssuranceRecordPage & {
        error?: string;
      };
    if (!response.ok)
      throw Error(page.error ?? "Assurance records unavailable");
    records.push(...page.records);
    onProgress?.(records.length);
    cursor = page.nextCursor;
  }
  return records;
}
