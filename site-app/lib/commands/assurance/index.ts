import { ApiError } from "../../http";
import type { Context } from "../../tenancy";
import type { CommandData } from "../command";
import { access } from "./access";
import { assessments } from "./assessments";
import { assistant } from "./assistant";
import { execution } from "./execution";
import { sources } from "./sources";
import { systems } from "./systems";
import type {
  AssuranceModule,
  AssuranceResult,
  AssuranceTarget,
} from "./target";
import { workers } from "./workers";
export { assuranceTarget } from "./target";
/** Every op POST /api/assurance accepts, each listed by exactly one module. */
export const assuranceModules: readonly AssuranceModule[] = [
  access,
  workers,
  systems,
  sources,
  assessments,
  assistant,
  execution,
];
export async function dispatchAssurance(
  target: AssuranceTarget,
  op: string,
  data: CommandData,
  ctx: Context,
): Promise<AssuranceResult> {
  const owner = assuranceModules.find((m) => m.ops.includes(op));
  if (!owner) throw new ApiError(400, "Unknown assurance action");
  return owner.run(target, op, data, ctx);
}
