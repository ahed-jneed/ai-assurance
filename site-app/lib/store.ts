// Compatibility barrel for code written before the store was split. New code
// imports from the focused modules directly.
export { ApiError, checkOrigin, readBounded, responseError } from "./http";
export { context, requireAdmin, requireRole, type Context } from "./tenancy";
export {
  bucket,
  db,
  getEngagement,
  id,
  now,
  save,
  sha256,
} from "./engagement-repo";
export { freshEngagement, templatePaper } from "./factories";
export { sanitize } from "./client-projection";
