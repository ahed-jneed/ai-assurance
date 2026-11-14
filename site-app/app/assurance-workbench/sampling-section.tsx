"use client";

import { Button } from "@/components/ui/button";
import type { OpenForm, RegisterList } from "./types";

/** Sampling: reproducible samples, collection and statistics packets. */
export function SamplingSection({
  writer,
  hasDatasets,
  open,
  list,
}: {
  writer: boolean;
  // Whether the engagement has an accepted dataset.
  hasDatasets: boolean;
  open: OpenForm;
  list: RegisterList;
}) {
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Population, sampling and operation</h2>
          <p className="subtle">
            Reconcile completeness before interpreting a sample or statistical
            result.
          </p>
        </div>
        {writer && (
          <div className="row-actions">
            <Button variant="outline" onClick={() => open("importPacket")}>
              Import collection / statistics
            </Button>
            <Button disabled={!hasDatasets} onClick={() => open("sample")}>
              Select sample
            </Button>
          </div>
        )}
      </div>
      {list(
        ["sample", "operational", "statistics"],
        "No reproducible samples or collection packets yet",
      )}
      <details className="help-panel">
        <summary>External tools and assumptions</summary>
        <p>
          The portable engine supports read-only operational JSONL
          reconciliation, replay comparison against independently obtained
          outputs, entity/split leakage checks, intersectional slices, IID and
          clustered bootstrap. It records missing events, duplicates and
          limitations. Import permitted aggregate packets after assessing their
          origin.
        </p>
        <p>
          Interactive sampling supports 1 MB and 10,000 rows. Stratified sample
          size is requested per stratum; selection does not establish
          representativeness. Larger populations use the portable assurance CLI.
        </p>
      </details>
    </>
  );
}
