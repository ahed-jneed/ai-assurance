// Bundles the tests inject (docs/design/criteria-model.md section 14.4): the
// committed bundle plus the section 12 sample pack. The app never imports
// this module.
import { readFileSync } from "node:fs";
import { digest } from "../../../schemas/validate-criteria.mjs";
import generated from "./bundle.generated.json";
import type { Bundle, IndexEntry } from "./types";

const sample = JSON.parse(
  readFileSync(
    new URL(
      "../../../schemas/fixtures/criteria-pack.en18286-iso42001.sample.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Bundle;

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
