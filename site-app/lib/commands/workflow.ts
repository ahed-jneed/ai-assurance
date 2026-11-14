import { db } from "../bindings";
import { id, now, sha256 } from "../ids";
import { pinned } from "../criteria/pin";
import { templatePaper } from "../factories";
import { linkedReadiness } from "../genai/store";
import { seedWorkflow } from "../workflow-seed";
import { ApiError } from "../http";
import { WorkflowError } from "../workflow/command";
import { workflowCommand, workflowOps } from "../workflow/dispatch";
import { workflowRoleRefusal } from "../permissions";
import type { CommandModule } from "./command";
import { assertReleasable } from "./reports";
/**
 * The structured audit workflow from lib/workflow/dispatch.ts, which checks its
 * own roles. Releasing a report first re-checks the captured snapshot.
 */
export const workflow: CommandModule = {
  ops: workflowOps,
  async run(e, op, d, ctx) {
    // The role check comes first, as for every other op: some commands
    // validate their data before their own role guard runs.
    const refusal = workflowRoleRefusal(ctx.role, op);
    if (refusal) throw new ApiError(403, refusal);
    if (op === "releaseReport") await assertReleasable(e, d, ctx);
    try {
      return {
        details: await workflowCommand(e, op, d, {
          role: ctx.role,
          userId: ctx.user.userId,
          at: now(),
          id,
          sha256,
          makePaper: (t) => templatePaper(pinned(e), t, ctx.user.userId),
          seedWorkflow: (at) => seedWorkflow(pinned(e), ctx.user.userId, at),
          member: (uid) =>
            db()
              .prepare(
                "SELECT m.role,m.client_id,m.status,m.access_since FROM memberships m WHERE m.tenant_id=? AND m.user_id=? AND (m.role IN ('Client Viewer','Client Contributor') OR EXISTS(SELECT 1 FROM engagement_access a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.engagement_id=? AND a.active=1))",
              )
              .bind(ctx.tenantId, uid, e.id)
              .first(),
          displayName: async (uid) =>
            (
              await db()
                .prepare(
                  "SELECT display_name FROM memberships WHERE tenant_id=? AND user_id=?",
                )
                .bind(ctx.tenantId, uid)
                .first<{ display_name: string | null }>()
            )?.display_name,
          genaiReadiness: (ids) => linkedReadiness(ctx, e, ids),
        }),
      };
    } catch (error) {
      if (error instanceof WorkflowError)
        throw new ApiError(error.status, error.message);
      throw error;
    }
  },
};
