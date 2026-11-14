"use client";

import { Button } from "@/components/ui/button";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { classificationRules } from "@/lib/classification-rules";
import type { ObligationOptions } from "@/lib/criteria/types";
import { asRulePack } from "@/lib/rule-pack";
import { ObligationSuggestions } from "../obligation-suggestions";
import { packFeatures, type WorkspaceData } from "../workspace-types";
import {
  pendingLegalReview,
  type Engagement,
  type OpenForm,
  type RegisterList,
} from "./types";

/** Impact: change assessments and, where the pack has them, obligations. */
export function ImpactSection({
  data,
  engagement: e,
  obligations,
  records,
  writer,
  open,
  list,
}: {
  data: WorkspaceData;
  engagement: Engagement;
  obligations: ObligationOptions | undefined;
  records: AssuranceRecord[];
  writer: boolean;
  open: OpenForm;
  list: RegisterList;
}) {
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Change impact</h2>
          <p className="subtle">
            Keep historical decisions fixed and open targeted review for changed
            dependencies.
          </p>
        </div>
        {writer && (
          <div className="row-actions">
            {!!obligations && (
              <Button
                variant="outline"
                onClick={() => open("obligationDecision")}
              >
                Assess obligation
              </Button>
            )}
            <Button onClick={() => open("impact")}>Assess change</Button>
          </div>
        )}
      </div>
      {list(["impact"], "No change assessments recorded")}
      {obligations && (
        <>
          {packFeatures(data).aiActClassification && (
            <ObligationSuggestions
              classification={e.classification}
              rules={classificationRules(
                asRulePack(data.catalog?.regulatorySnapshot),
              )}
              assessed={
                new Set(
                  records
                    .filter((r) => r.kind === "obligation")
                    .map((r) => String(r.body.code)),
                )
              }
              writer={writer}
              onAssess={(code, actor) =>
                open("obligationDecision", null, { code, actor })
              }
            />
          )}
          <h2 className="workbench-subhead">Obligation assessments</h2>
          {list(["obligation"], "No subitem assessments recorded")}
          <details className="help-panel">
            <summary>
              Obligation subitems · {obligations.items.length} review prompts
            </summary>
            <p>{obligations.scope}</p>
            <p>{obligations.providerResponsibility}</p>
            <a
              className="source-link"
              href={obligations.source.url}
              target="_blank"
              rel="noreferrer"
            >
              Reviewed legal source · {obligations.source.version}
            </a>
            <div className="obligation-list">
              {obligations.items.map((o) => (
                <div key={o.code}>
                  <b>
                    {o.article} · {o.title}
                  </b>
                  {o.legalReview?.required && (
                    <>
                      {" "}
                      <span
                        className="badge amber"
                        title={o.reviewNote ?? "Pending qualified legal review"}
                      >
                        {pendingLegalReview(o.legalReview.itemIds)}
                      </span>
                    </>
                  )}
                  <small className="block subtle">
                    {o.actor.join(", ")} · {o.code} ·{" "}
                    {o.evidenceCategories.join(", ")}
                  </small>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </>
  );
}
