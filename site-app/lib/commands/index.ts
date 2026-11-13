import {
  attestationDigest,
  attestationInput,
  attestationSubject,
  attestedOps,
  isAttestedOp,
  type AttestationRecord,
  type AttestedOp,
} from "../attestation";
import type { Engagement } from "../domain";
import { ApiError } from "../http";
import { refuseQualityReviewer, requireRole, type Context } from "../tenancy";
import { classification } from "./classification";
import type { CommandData, CommandModule, CommandResult } from "./command";
import { engagement } from "./engagement";
import { evidenceRequests } from "./evidence-requests";
import { findings } from "./findings";
import { ll144 } from "./ll144";
import { managementSystem } from "./management-system";
import { papers } from "./papers";
import { qualityReview } from "./quality-review";
import { reports } from "./reports";
import { runs } from "./runs";
import { specialCategory } from "./special-category";
import { workflow } from "./workflow";
/** Every op POST /api/workspace accepts, each listed by exactly one module. */
export const commandModules: readonly CommandModule[] = [
  workflow,
  evidenceRequests,
  engagement,
  papers,
  classification,
  findings,
  managementSystem,
  runs,
  ll144,
  specialCategory,
  reports,
  qualityReview,
];
export async function dispatch(
  e: Engagement,
  op: string,
  data: CommandData,
  ctx: Context,
): Promise<CommandResult> {
  const target = commandModules.find((m) => m.ops.includes(op));
  if (!target) throw new ApiError(400, "Unknown command");
  refuseQualityReviewer(ctx, op);
  if (isAttestedOp(op)) return attested(target, e, op, data, ctx);
  return target.run(e, op, data, ctx);
}

/**
 * An attested decision (F-45, lib/attestation.ts): after the op's role check,
 * the caller's rationale is required, and the revision and digest they saw
 * must still be current. The op runs without the attestation, and its audit
 * event records the attestation next to the op's own details.
 */
async function attested(
  target: CommandModule,
  e: Engagement,
  op: AttestedOp,
  data: CommandData,
  ctx: Context,
): Promise<CommandResult> {
  const roles = target.roles?.[op];
  if (roles) requireRole(ctx, roles);
  const { attestation, ...rest } = data;
  if (attestation === undefined)
    throw new ApiError(
      400,
      "Attest this decision: give your rationale for the record you reviewed",
    );
  const input = attestationInput.parse(attestation),
    subject = attestationSubject(e, op, rest);
  let record: AttestationRecord | undefined;
  if (subject) {
    const digest = await attestationDigest(subject);
    if (
      (input.revision !== undefined && input.revision !== subject.revision) ||
      (input.digest !== undefined && input.digest !== digest)
    )
      throw new ApiError(
        409,
        "The record changed after you reviewed it. Reload and attest again.",
      );
    record = {
      statement: attestedOps[op].statement,
      record: subject.record,
      revision: subject.revision,
      digest,
      rationale: input.rationale,
    };
  }
  const result = await target.run(e, op, rest, ctx);
  if (!record || !("details" in result)) return result;
  return { ...result, details: { ...result.details, attestation: record } };
}
