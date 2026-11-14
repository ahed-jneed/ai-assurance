import type { Engagement, Role } from "../domain/types";
import { ApiError } from "../http";
import { requireRole, type Context } from "../tenancy";

/** The `data` object of a command envelope, validated by each handler. */
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
 * A cohesive group of ops. `dispatch` runs the module that lists the op. Each
 * bus passes its own `Target` (for POST /api/workspace the loaded engagement,
 * whose version the route has already checked) and expects its own `Result`.
 */
export type CommandModule<Target = Engagement, Result = CommandResult> = {
  readonly ops: readonly string[];
  /**
   * The roles each op declares, for modules built with defineCommands. A
   * module that checks roles inside its own service (the workflow and
   * evidence requests) has none; lib/permissions.test.ts probes those.
   */
  readonly roles?: Readonly<Record<string, readonly Role[]>>;
  run(
    target: Target,
    op: string,
    data: CommandData,
    ctx: Context,
  ): Result | Promise<Result>;
};

export type CommandHandler<Target = Engagement, Result = CommandResult> = {
  /**
   * The roles that may issue the op, checked before `handle` runs. Required,
   * so no op ships without an authorization decision.
   */
  roles: Role[];
  /** `op` tells a handler shared by several ops which one it is running. */
  handle(
    target: Target,
    data: CommandData,
    ctx: Context,
    op: string,
  ): Result | Promise<Result>;
};

/** A module with one handler per op, so adding an op means adding one entry. */
export function defineCommands<Target = Engagement, Result = CommandResult>(
  handlers: Record<string, CommandHandler<NoInfer<Target>, NoInfer<Result>>>,
): CommandModule<Target, Result> {
  const table = new Map(Object.entries(handlers));
  return {
    ops: [...table.keys()],
    roles: Object.fromEntries(
      Object.entries(handlers).map(([op, h]) => [op, h.roles]),
    ),
    run(target, op, data, ctx) {
      const handler = table.get(op);
      if (!handler) throw new ApiError(400, "Unknown command");
      requireRole(ctx, handler.roles);
      return handler.handle(target, data, ctx, op);
    },
  };
}
