import type { AssuranceRecord } from "../../assurance-core";
import type { Engagement } from "../../domain";
import { ApiError } from "../../http";
import type { CommandModule } from "../command";

/** What an assurance op runs against, built once per POST /api/assurance. */
export type AssuranceTarget = ReturnType<typeof assuranceTarget>;

/**
 * Most ops answer with the record they wrote, which the route returns as
 * `{ record }`. An op that answers with something else (a worker token shown
 * once, a signed briefing packet, a queued job) returns its own Response.
 */
export type AssuranceResult = { record: AssuranceRecord } | Response;

export type AssuranceModule = CommandModule<AssuranceTarget, AssuranceResult>;

/**
 * The engagement and all of its assurance records, with the lookups the ops
 * share: an existing record of a kind, accepted evidence (optionally of one
 * category), and the record an assessment revises, which must not already
 * have a successor.
 */
export function assuranceTarget(e: Engagement, all: AssuranceRecord[]) {
  const find = (value: unknown, kind: string) => {
    const r = all.find((r) => r.id === value && r.kind === kind);
    if (!r) throw new ApiError(400, "Select an existing " + kind + " record");
    return r;
  };
  const accepted = (value: unknown, category?: string) => {
    const r = e.artifacts.find(
      (r) =>
        r.id === value &&
        r.status === "accepted" &&
        (!category || r.category === category),
    );
    if (!r)
      throw new ApiError(
        400,
        "Select accepted " + (category ?? "source") + " evidence",
      );
    return r;
  };
  const revision = (value: unknown, kind: string) => {
    if (!value) return undefined;
    const previous = find(value, kind);
    if (all.some((r) => r.kind === kind && r.body.supersedesId === previous.id))
      throw new ApiError(409, "This assessment already has a successor");
    return previous;
  };
  return { e, all, find, accepted, revision };
}
