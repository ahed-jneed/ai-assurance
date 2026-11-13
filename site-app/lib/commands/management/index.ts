import { ApiError } from "../../http";
import type { Context } from "../../tenancy";
import type { CommandData } from "../command";
import type {
  ManagementBatch,
  ManagementDetails,
  ManagementModule,
} from "./batch";
import { clients } from "./clients";
import { engagements } from "./engagements";
import { incidents } from "./incidents";
import { admins } from "./admins";
import { invitations } from "./invitations";
import { members } from "./members";
import { practice } from "./practice";
import { signingKeys } from "./signing-keys";
/** Every op POST /api/management accepts, each listed by exactly one module. */
export const managementModules: readonly ManagementModule[] = [
  clients,
  engagements,
  members,
  admins,
  invitations,
  practice,
  signingKeys,
  incidents,
];
/**
 * The ops in module order, which is also the order the envelope's
 * "Invalid enum value" error lists them in.
 */
export const managementOps = managementModules.flatMap((m) => m.ops) as [
  string,
  ...string[],
];
export async function dispatchManagement(
  batch: ManagementBatch,
  op: string,
  data: CommandData,
  ctx: Context,
): Promise<ManagementDetails> {
  const owner = managementModules.find((m) => m.ops.includes(op));
  if (!owner) throw new ApiError(400, "Unknown management action");
  return owner.run(batch, op, data, ctx);
}
