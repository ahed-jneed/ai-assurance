import type { Engagement } from "../domain";
import { ApiError } from "../http";
import { refuseQualityReviewer, type Context } from "../tenancy";
import { classification } from "./classification";
import type { CommandData, CommandModule, CommandResult } from "./command";
import { engagement } from "./engagement";
import { evidenceRequests } from "./evidence-requests";
import { findings } from "./findings";
import { ll144 } from "./ll144";
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
  return target.run(e, op, data, ctx);
}
