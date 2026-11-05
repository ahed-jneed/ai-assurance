import type { Engagement, Role } from "../domain";
import { ApiError } from "../http";
import { requireRole, type Context } from "../tenancy";

/** The validated `data` of a workspace command. */
export type CommandData = Record<string, unknown>;

/**
 * What a command hands back to POST /api/workspace. Usually it has changed the
 * loaded engagement in memory, and the route saves it with `details` as the
 * audit event details and `extras` in the same batch. A command that persists
 * its own intermediate states returns the engagement it saved instead.
 */
export type CommandResult =
  | {
      details: Record<string, unknown>;
      extras?: (commandId: string) => D1PreparedStatement[];
    }
  | { saved: Engagement };

/**
 * A cohesive group of ops. `dispatch` runs the module that lists the op; the
 * route has already checked `e.version` against the caller's expectedVersion.
 */
export type CommandModule = {
  readonly ops: readonly string[];
  run(
    e: Engagement,
    op: string,
    data: CommandData,
    ctx: Context,
  ): CommandResult | Promise<CommandResult>;
};

export type CommandHandler = {
  /** The roles that may issue the op, checked before `handle` runs. */
  roles?: Role[];
  handle(
    e: Engagement,
    data: CommandData,
    ctx: Context,
  ): CommandResult | Promise<CommandResult>;
};

/** A module with one handler per op, so adding an op means adding one entry. */
export function defineCommands(
  handlers: Record<string, CommandHandler>,
): CommandModule {
  const table = new Map(Object.entries(handlers));
  return {
    ops: [...table.keys()],
    run(e, op, data, ctx) {
      const handler = table.get(op);
      if (!handler) throw new ApiError(400, "Unknown command");
      if (handler.roles) requireRole(ctx, handler.roles);
      return handler.handle(e, data, ctx);
    },
  };
}
