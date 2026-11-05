"use client";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { classify, type Engagement } from "@/lib/domain";
import { articleCoverage } from "../coverage";
import { Badge } from "../workspace-ui";

/** The engagement's risk classification and article-to-evidence coverage. */
export function RegulatoryMapping({
  engagement: e,
  reviewer,
  busy,
  onApprove,
}: {
  engagement: Engagement;
  reviewer: boolean;
  busy: boolean;
  /** Independent approval of a provisional classification. */
  onApprove: () => void;
}) {
  return (
    <>
      <div className="split-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Risk classification</h2>
            <Badge value={e.classification.status} />
          </div>
          <div className="content-pad body-copy">
            <h3>{classify(e.classification)}</h3>
            <p>
              {e.classification.rationale ||
                "Complete the guided assessment and record your legal classification rationale."}
            </p>
            <p>
              <b>Operator:</b> {e.classification.operatorRole}
              <br />
              <b>Route:</b> {e.classification.annexRoute}
              <br />
              <b>Transparency duties:</b>{" "}
              {e.classification.transparency
                ? "Flagged separately"
                : "Not flagged"}
              <br />
              <b>Profiling:</b>{" "}
              {e.classification.profiling
                ? "Flagged; high-risk assessment required"
                : "Not flagged"}
            </p>
            <p>
              <b>Intended purpose:</b>{" "}
              {e.classification.intendedPurpose || "Unrecorded"}
            </p>
            {reviewer && e.classification.status === "provisional" && (
              <Button disabled={busy} onClick={onApprove}>
                Approve independently
              </Button>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Regulatory basis</h2>
            <BookOpen size={20} />
          </div>
          <div className="content-pad body-copy">
            <details className="regulatory-detail">
              <summary>Applicable dates and legal sources</summary>
              <p>
                Current snapshot: <b>02024R1689-20260727</b>, researched 5
                October 2026.
              </p>
              <p>
                Chapter III Sections 1–3, except Article 6(5): Annex III applies
                from <b>2 December 2027</b>; Annex I from <b>2 August 2028</b>.
                Assess each provision and transitional rule.
              </p>
              <p>
                Articles 4, 5, 26, 27, 50, 72 and 73, quality management,
                conformity routes and sector rules have separate applicability
                checks in the work program.
              </p>
              <a
                className="source-link"
                href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744"
                target="_blank"
                rel="noreferrer"
              >
                Authentic amendment (EU) 2026/1744
              </a>
              <p className="subtle">
                Annex I Section B requires sector-specific legal review.
                Sensitive-category bias processing under Article 4a requires
                assessment of access restrictions and data-protection law.
              </p>
            </details>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Article-to-evidence mapping</h2>
        </div>
        {articleCoverage(e).map((c) => (
          <div className="control-row" key={c.article}>
            <span className="article">{c.article}</span>
            <div>
              <b>{c.title}</b>
              <p className="control-result">
                {c.papers.map((p) => p.templateId).join(" · ") ||
                  "No required papers"}
              </p>
              <Progress
                value={c.coverage}
                aria-label={c.title + " signed coverage"}
              />
            </div>
            <Badge value={c.coverage === 100 ? "signed" : "not evaluated"} />
          </div>
        ))}
      </section>
    </>
  );
}
