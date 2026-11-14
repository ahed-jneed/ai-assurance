import type { AssuranceRecord } from "../../assurance-core";
import {
  hasSuccessor,
  recordsById,
  type AssessmentKind,
} from "../../assurance-store";
import type { Engagement } from "../../domain/types";
import { ApiError } from "../../http";
import type { Context } from "../../tenancy";
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
 * The engagement and the record lookups the ops share. An engagement may hold
 * any number of assurance records, so none are loaded up front: an op loads
 * the records it names. `lookup` loads records by id in (created_at, id)
 * order, `pick` takes an existing record of a kind from loaded records and
 * `find` does both for one id. `accepted` takes accepted evidence (optionally
 * of one category) and `revision` the record an assessment revises, which
 * must not already have a successor.
 */
export function assuranceTarget(e: Engagement, ctx: Context) {
  const lookup = (ids: readonly unknown[]) => recordsById(ctx, e.id, ids);
  const pick = (records: AssuranceRecord[], value: unknown, kind: string) => {
    const r = records.find((r) => r.id === value && r.kind === kind);
    if (!r) throw new ApiError(400, "Select an existing " + kind + " record");
    return r;
  };
  const find = async (value: unknown, kind: string) =>
    pick(await lookup([value]), value, kind);
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
  const revision = async (value: unknown, kind: AssessmentKind) => {
    if (!value) return undefined;
    const previous = await find(value, kind);
    if (await hasSuccessor(ctx, e.id, kind, previous.id))
      throw new ApiError(409, "This assessment already has a successor");
    return previous;
  };
  return { e, lookup, pick, find, accepted, revision };
}
