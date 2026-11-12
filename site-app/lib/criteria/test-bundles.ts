// Bundles the tests inject (docs/design/criteria-model.md section 14.4): the
// committed bundle plus the section 12 sample pack. The app never imports
// this module.
import { readFileSync } from "node:fs";
import {
  buildBundle,
  digest,
  readCriteria,
} from "../../../schemas/validate-criteria.mjs";
import generated from "./bundle.generated.json";
import type { Bundle, CriteriaDocument, IndexEntry } from "./types";

const sample = JSON.parse(
  readFileSync(
    new URL(
      "../../../schemas/fixtures/criteria-pack.en18286-iso42001.sample.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Bundle;

/** The committed #28 pack, its frameworks and crosswalks (drafts in index order). */
const committedDrafts = () => {
  const { index, documents } = readCriteria();
  return index.documents
    .filter((e: IndexEntry) => e.status === "draft")
    .map((e: IndexEntry) => ({
      entry: structuredClone(e),
      doc: structuredClone(documents.get(e.path)) as CriteriaDocument,
    }));
};

/**
 * The committed bundle plus the committed #28 drafts as the owner actions of
 * #57 would release them: licences confirmed (Q1), the legal effects'
 * review completed (Q8) and the approvals of rule 12b, from two people for
 * the crosswalk with a legal effect. The data is otherwise unchanged, so the
 * tests show what the release would serve.
 */
export function withManagementSystemPack(): Bundle {
  const bundle = structuredClone(generated) as unknown as Bundle;
  for (const { entry, doc } of committedDrafts()) {
    if (doc.documentType === "framework") doc.licence.status = "confirmed";
    let legalEffect = false;
    if (doc.documentType === "crosswalk")
      for (const x of doc.entries)
        if (x.legalEffect) {
          x.legalEffect.provenance.legalReview = "completed";
          legalEffect = true;
        }
    bundle.documents.push(doc);
    bundle.index.documents.push({
      ...entry,
      status: "released",
      releasedAt: "2026-12-01",
      approvals: [
        { role: "methodology_owner", by: "Owner", at: "2026-12-01" },
        ...(legalEffect
          ? [
              {
                role: "legal_reviewer" as const,
                by: "Counsel",
                at: "2026-12-01",
              },
            ]
          : []),
      ],
      sha256: digest(doc),
    });
  }
  return bundle;
}

/** The local draft preview bundle (CRITERIA_INCLUDE_DRAFTS=1). */
export const draftPreviewBundle = (): Bundle =>
  structuredClone(
    buildBundle(readCriteria(), { includeDrafts: true }),
  ) as unknown as Bundle;

/**
 * The committed bundle plus the EN 18286 + ISO/IEC 42001 documents of
 * section 12, released once their licences are confirmed (as step 7 of
 * section 12 does after Q1). Pass `draft` to keep them drafts.
 */
export function withSamplePack({ draft = false } = {}): Bundle {
  const bundle = structuredClone(generated) as unknown as Bundle;
  for (const [i, entry] of sample.index.documents.entries()) {
    const doc = structuredClone(sample.documents[i]);
    if (doc.documentType === "framework" && !draft)
      doc.licence.status = "confirmed";
    bundle.documents.push(doc);
    bundle.index.documents.push(
      draft
        ? (entry as IndexEntry)
        : {
            ...(entry as IndexEntry),
            status: "released",
            releasedAt: "2027-01-15",
            approvals: [
              { role: "methodology_owner", by: "Owner", at: "2027-01-15" },
            ],
            sha256: digest(doc),
          },
    );
  }
  return bundle;
}
