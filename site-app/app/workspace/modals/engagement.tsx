"use client";
import { Input } from "@/components/ui/input";
import type { PackSummary } from "@/lib/criteria/types";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** The pack a new engagement is pinned to: the one chosen, else the default. */
export function chosenPack(
  packs: PackSummary[],
  choices: Record<string, string>,
): PackSummary | undefined {
  return (
    packs.find((p) => p.id === choices.packId) ??
    packs.find((p) => p.isDefault) ??
    packs[0]
  );
}

/** What a pack card says (docs/design/criteria-model.md section 15.1). */
function PackCard({ pack }: { pack: PackSummary }) {
  return (
    <span className="pack-card">
      <b>
        {pack.title} <span className="subtle">{pack.version}</span>
        {pack.isDefault && <span className="badge"> Default</span>}
        {pack.draft && <span className="badge"> Draft preview</span>}
      </b>
      {pack.draft && (
        <small className="block">
          Not released: a local draft preview. Its clause numbers and licences
          are not yet confirmed, and its coverage never shows Covered.
        </small>
      )}
      <small className="block">
        {pack.frameworks
          .map((f) => f.shortTitle + " (" + f.edition + ")")
          .join(" + ")}
      </small>
      <small className="block">
        {pack.workingPapers} working papers, {pack.memos} memos.
        {pack.phases.length ? " " + pack.phases.join(" and ") + "." : ""}
        {pack.crosswalksTo.length
          ? " Crosswalks to: " + pack.crosswalksTo.join(", ") + "."
          : ""}
      </small>
      {pack.legalReviewPending && (
        <small className="block">
          Legal content pending qualified legal review.
        </small>
      )}
      {pack.clauseNumbersOnly && (
        <small className="block">
          Clause numbers only: the team needs licensed copies of the standards.
        </small>
      )}
    </span>
  );
}

function EngagementFields({ choices, choice, data }: ModalFieldsProps) {
  const packs = data?.selectablePacks ?? [];
  const chosen = chosenPack(packs, choices);
  return (
    <>
      <label>
        Client
        <Choice
          label="Client"
          value={choices.clientId ?? ""}
          values={
            data?.clients.map((c) => ({
              value: c.id,
              label: c.name,
            })) ?? []
          }
          onChange={(v) => choice("clientId", v)}
        />
      </label>
      <label>
        Engagement title
        <Input name="title" required maxLength={300} />
      </label>
      {packs.length > 0 && (
        <fieldset className="pack-choice">
          <legend>Criteria pack</legend>
          {packs.length === 1 ? (
            <PackCard pack={packs[0]} />
          ) : (
            packs.map((p) => (
              <label key={p.id} className="pack-option">
                <input
                  type="radio"
                  name="packId"
                  value={p.id}
                  checked={chosen?.id === p.id}
                  onChange={() => choice("packId", p.id)}
                />
                <PackCard pack={p} />
              </label>
            ))
          )}
          <p className="subtle">
            The pack is pinned to this engagement. New pack versions never
            change it; moving it to a newer version will be a reviewed step.
          </p>
        </fieldset>
      )}
    </>
  );
}
export const engagementModal: ModalDefinition = {
  title: "New engagement",
  submitLabel: "Create engagement",
  Fields: EngagementFields,
  validate: ({ choices }) => {
    if (!choices.clientId) throw Error("Choose a client for this engagement.");
  },
  submit: async ({ manage, load, data, values: v, choices, followUps }) => {
    const pack = chosenPack(data?.selectablePacks ?? [], choices);
    const result = await manage("createEngagement", {
      clientId: choices.clientId,
      title: v.title,
      ...(pack ? { packId: pack.id, packVersion: pack.version } : {}),
    });
    if (result.details?.engagementId) {
      await load(data!.tenantId, result.details.engagementId);
      followUps.showEngagementOverview();
    }
  },
};
