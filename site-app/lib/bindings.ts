// The Worker's D1 database and R2 bucket. A missing binding answers a
// retryable 503 instead of failing the request with a TypeError. The only lib
// module that loads `cloudflare:workers`: modules that read Worker variables
// or secrets take `env` from here.
import { env } from "cloudflare:workers";
import { ApiError } from "./http";
export { env };
export function db() {
  if (!env.DB)
    throw new ApiError(503, "Workspace storage is unavailable. Please retry.");
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET)
    throw new ApiError(503, "Evidence storage is unavailable. Please retry.");
  return env.BUCKET;
}
