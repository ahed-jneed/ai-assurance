import type { CommandHandler, CommandModule } from "../command";

/**
 * What a management op runs against: the tenant-level batch it adds its
 * statements to. Each statement carries `guard`, which holds only once this
 * command has bumped the tenant's management version, and the route commits
 * the statements with that bump and the management event.
 */
export type ManagementBatch = {
  commandId: string;
  timestamp: string;
  guard: string;
  statements: D1PreparedStatement[];
};

/** The management event details, which the route also returns. */
export type ManagementDetails = Record<string, unknown>;

/**
 * Practice administration, not the membership role, authorizes management:
 * the route requires a practice admin for every op, so each op admits every
 * role and checks any narrower rule itself.
 */
export type ManagementHandler = CommandHandler<
  ManagementBatch,
  ManagementDetails
>;

export type ManagementModule = CommandModule<
  ManagementBatch,
  ManagementDetails
>;
