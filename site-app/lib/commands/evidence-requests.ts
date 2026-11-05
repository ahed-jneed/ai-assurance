import { id, now } from "../engagement-repo";
import {
  evidenceRequestOps,
  evidenceRequestCommand,
  EvidenceRequestError,
} from "../evidence-requests";
import { templatePaper } from "../factories";
import { ApiError } from "../http";
import type { CommandModule } from "./command";
/** Evidence requests from lib/evidence-requests.ts, which checks its own roles. */
export const evidenceRequests: CommandModule = {
  ops: evidenceRequestOps,
  run(e, op, d, ctx) {
    try {
      return {
        details: evidenceRequestCommand(e, op, d, {
          role: ctx.role,
          userId: ctx.user.userId,
          at: now(),
          id: () => id("REQ"),
          makeLimitationPaper: () =>
            templatePaper("MEM-EX-01", ctx.user.userId),
        }),
      };
    } catch (error) {
      if (error instanceof EvidenceRequestError)
        throw new ApiError(error.status, error.message);
      throw error;
    }
  },
};
