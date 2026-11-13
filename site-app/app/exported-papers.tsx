// The working-paper contract documents an internal export carries (#51), as
// the package proof lists them (#137): each document with the SHA-256 of the
// bytes the dossier files under papers/, and whether the snapshot digest
// covers it or the release record binds it.
export type ExportedPaperItem = {
  kind: string;
  id: string;
  revision?: number;
  title: string;
  sha256: string;
  catalogId?: string;
  status?: string;
  basis?: "snapshot" | "release_record";
  bindsPackage?: boolean;
};

const basisLabel = (item: ExportedPaperItem) =>
  item.basis === "release_record"
    ? item.bindsPackage
      ? "Built from the release record; binds this package"
      : "Built from the release record; does not bind this package"
    : "Captured in the snapshot";

/** The exported documents among the proof's leaves, in proof order. */
export const exportedPaperItems = (items: readonly ExportedPaperItem[]) =>
  items.filter((i) => i.kind === "working_paper_document");

export function ExportedPapers({
  items,
}: {
  items: readonly ExportedPaperItem[];
}) {
  const documents = exportedPaperItems(items);
  if (!documents.length) return null;
  return (
    <section className="exported-papers" aria-label="Exported working papers">
      <h3>Exported working papers ({documents.length})</h3>
      <p className="subtle">
        The internal report package and dossier carry these documents
        (papers/&lt;id&gt;-r&lt;revision&gt;.json in the dossier).
      </p>
      <ul>
        {documents.map((d) => (
          <li key={d.id + "-r" + d.revision}>
            <strong>
              {d.catalogId ? d.catalogId + " · " : ""}
              {d.title}
            </strong>
            <span>
              Revision {d.revision} · {d.status} · {basisLabel(d)}
            </span>
            <code title={d.sha256}>SHA-256 {d.sha256.slice(0, 16)}…</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
