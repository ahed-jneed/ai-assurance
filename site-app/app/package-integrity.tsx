"use client";
import { useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Download, ShieldCheck } from "lucide-react";
import type { Engagement, Report, Role } from "@/lib/domain/types";
import { DossierControls } from "./dossier-controls";
import { ExportedPapers, type ExportedPaperItem } from "./exported-papers";
export function PackageIntegrity({
  tenantId,
  engagement,
  report,
  role,
  onRefresh,
}: {
  tenantId: string;
  engagement: Engagement;
  report: Report;
  role: Role;
  onRefresh?: () => Promise<unknown>;
}) {
  const engagementId = engagement.id,
    reportId = report.id;
  const [result, setResult] = useState<{
      valid: boolean;
      items: ExportedPaperItem[];
    } | null>(null),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(false),
    query = new URLSearchParams({ tenantId, engagementId, reportId });
  async function check() {
    setChecking(true);
    setError("");
    try {
      const v = await fetchJson<{
        valid: boolean;
        items: ExportedPaperItem[];
      }>("/api/report-package?" + query, { cache: "no-store" });
      setResult({ valid: v.valid, items: v.items });
    } catch (e) {
      setError(errorMessage(e, "Could not verify package"));
    } finally {
      setChecking(false);
    }
  }
  return (
    <>
      <details className="package-integrity-tools">
        <summary>Integrity & downloads</summary>
        <section className="release-controls">
          <h3>Snapshot verification</h3>
          <div className="row-actions">
            <Button
              variant="outline"
              disabled={checking}
              onClick={() => void check()}
            >
              <ShieldCheck size={15} />
              {checking ? "Checking…" : "Verify captured content"}
            </Button>
            <a
              className="download-link"
              href={"/api/report-package?" + query + "&download=1"}
            >
              <Download size={14} />
              Download captured snapshot
            </a>
          </div>
        </section>
        <DossierControls
          tenantId={tenantId}
          engagement={engagement}
          report={report}
          role={role}
          onRefresh={onRefresh}
        />
      </details>
      {result && (
        <p className={result.valid ? "subtle" : "form-error"} role="status">
          {result.valid
            ? "Captured content matches its recorded SHA-256 digest."
            : "Package integrity check failed."}{" "}
          {result.items.length} captured manifest references.
        </p>
      )}
      {result && <ExportedPapers items={result.items} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
