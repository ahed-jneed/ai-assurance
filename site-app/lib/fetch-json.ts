// One way for the browser to call the JSON API (F-71): the status is checked
// before the body is parsed, so a non-JSON answer (a 413 from the edge, a 502
// page) becomes a readable message instead of "Unexpected token", and every
// failure says what kind it is, so the error surface can offer the right next
// step: retry a transient failure, reload after a conflict, sign in again.

/** What went wrong, as the person can act on it. */
export type FailureKind =
  | "network"
  | "signed_out"
  | "forbidden"
  | "missing"
  | "conflict"
  | "too_large"
  | "invalid"
  | "transient";

export class FetchError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or 0 when no response arrived. */
    public status: number,
    public kind: FailureKind,
    /** The failed response's JSON body, when it had one. */
    public body?: unknown,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/** The kind of failure an HTTP status is. */
export function failureKind(status: number): FailureKind {
  if (status === 401) return "signed_out";
  if (status === 403) return "forbidden";
  if (status === 404) return "missing";
  if (status === 409) return "conflict";
  if (status === 413) return "too_large";
  if (status === 400 || status === 422) return "invalid";
  return "transient";
}

/** The message for a failed response that carried no error of its own. */
export function statusMessage(status: number) {
  switch (failureKind(status)) {
    case "signed_out":
      return "Your session ended. Sign in again to continue.";
    case "forbidden":
      return "Your access does not allow this.";
    case "missing":
      return "This record is no longer available.";
    case "conflict":
      return "The record changed. Reload before saving.";
    case "too_large":
      return "The request is too large. Send fewer or smaller files.";
    case "invalid":
      return "The request was not accepted. Check the entries and try again.";
    default:
      return status >= 500
        ? "The service is temporarily unavailable. Try again in a moment."
        : "The request failed (HTTP " + status + ").";
  }
}

/** Whether trying the same request again may succeed. */
export function retryable(error: unknown) {
  return (
    error instanceof FetchError &&
    (error.kind === "network" || error.kind === "transient")
  );
}

/** The message to show for any error a request threw. */
export function errorMessage(error: unknown, fallback = "Request failed") {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Fetches `input` and returns its JSON body. Throws FetchError for a network
 * failure, a failed status (with the body's `error` when it is JSON, else the
 * status's message) or an unreadable success body. An abort is rethrown as
 * the fetch threw it.
 */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new FetchError(
      "The server could not be reached. Check your connection and try again.",
      0,
      "network",
    );
  }
  const body = await bodyOf(response);
  if (!response.ok) {
    const own =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: unknown }).error
        : undefined;
    throw new FetchError(
      typeof own === "string" && own ? own : statusMessage(response.status),
      response.status,
      failureKind(response.status),
      body,
    );
  }
  if (body === undefined)
    throw new FetchError(
      "The server sent an unreadable answer. Try again in a moment.",
      response.status,
      "transient",
    );
  return body as T;
}

/** A JSON POST through fetchJson. */
export function postJson<T>(path: string, payload: unknown) {
  return fetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
