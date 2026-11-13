// The package verification UI shows the exported working-paper documents the
// proof lists (#137), and nothing for a package without them.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportedPapers, exportedPaperItems } from "./exported-papers";

const items = [
  { kind: "evidence", id: "EV-1", title: "data.csv", sha256: "e".repeat(64) },
  {
    kind: "working_paper",
    id: "P-1",
    revision: 1,
    title: "Captured paper",
    sha256: "f".repeat(64),
  },
  {
    kind: "working_paper_document",
    id: "ENG-1-MEM-AC-01",
    revision: 2,
    title: "Acceptance memo",
    catalogId: "MEM-AC-01",
    status: "sealed",
    sha256: "a".repeat(64),
    basis: "snapshot" as const,
  },
  {
    kind: "working_paper_document",
    id: "REPORT-1-MEM-SO-01",
    revision: 1,
    title: "Completion memo",
    catalogId: "MEM-SO-01",
    status: "sealed",
    sha256: "b".repeat(64),
    basis: "release_record" as const,
    bindsPackage: true,
  },
];

describe("ExportedPapers", () => {
  it("lists each exported document with its digest and basis", () => {
    expect(exportedPaperItems(items).map((i) => i.id)).toEqual([
      "ENG-1-MEM-AC-01",
      "REPORT-1-MEM-SO-01",
    ]);
    const html = renderToStaticMarkup(<ExportedPapers items={items} />);
    expect(html).toContain("Exported working papers (2)");
    expect(html).toContain("MEM-AC-01 · Acceptance memo");
    expect(html).toContain("Revision 2 · sealed · Captured in the snapshot");
    expect(html).toContain(
      "Revision 1 · sealed · Built from the release record; binds this package",
    );
    expect(html).toContain('title="' + "b".repeat(64) + '"');
    expect(html).not.toContain("Captured paper");
  });

  it("states a completion memo that does not bind the package", () => {
    const html = renderToStaticMarkup(
      <ExportedPapers items={[{ ...items[3], bindsPackage: false }]} />,
    );
    expect(html).toContain("does not bind this package");
  });

  it("renders nothing for a package without contract documents", () => {
    expect(
      renderToStaticMarkup(<ExportedPapers items={items.slice(0, 2)} />),
    ).toBe("");
  });
});
