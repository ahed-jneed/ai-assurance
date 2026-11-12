import { db, id, now, sha256 } from "../engagement-repo";
import { pinned } from "../criteria/pin";
import { templatePaper } from "../factories";
import { seedWorkflow } from "../workflow-seed";
import { ApiError } from "../http";
import {
  workflowCommand,
  workflowOps,
  WorkflowError,
} from "../workflow-service";
import type { CommandModule } from "./command";
import { assertReleasable } from "./reports";
/**
 * The structured audit workflow from lib/workflow-service.ts, which checks its
 * own roles. Releasing a report first re-checks the captured snapshot.
 */
export const workflow: CommandModule = {
  ops: workflowOps,
  async run(e, op, d, ctx) {
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
        }),
      };
    } catch (error) {
      if (error instanceof WorkflowError)
        throw new ApiError(error.status, error.message);
      throw error;
    }
  },
};
