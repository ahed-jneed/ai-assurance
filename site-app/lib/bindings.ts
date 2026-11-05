// The Worker's D1 database and R2 bucket. A missing binding answers a
// retryable 503 instead of failing the request with a TypeError.
import { env } from "cloudflare:workers";
import { ApiError } from "./http";
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
