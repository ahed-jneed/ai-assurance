import { AsyncLocalStorage } from "node:async_hooks";

// A page cannot set its HTTP status in the App Router: only notFound(),
// forbidden() and unauthorized() change it, and vinext answers a segment
// error boundary (error.tsx) with 200. A page that renders its own failure
// fallback records the status here instead, and the Worker entry
// (build/sites-worker.ts) applies it to the response (#216).
const slots = new AsyncLocalStorage<{ status?: number }>();

/**
 * Runs one request and applies a status a page recorded with
 * setResponseStatus. Only a 200 is replaced, so a redirect, a refusal or a
 * failure vinext already answered keeps its own status.
 */
export async function withResponseStatus(
  run: () => Promise<Response>,
): Promise<Response> {
  const slot: { status?: number } = {};
  const response = await slots.run(slot, run);
  if (slot.status === undefined || response.status !== 200) return response;
  return new Response(response.body, {
    status: slot.status,
    headers: response.headers,
  });
}

/** Records the status the current request should answer with. */
export function setResponseStatus(status: number) {
  const slot = slots.getStore();
  if (slot) slot.status = status;
}
