// HTTP plumbing shared by the API routes: caller-safe errors, bounded request
// bodies, the same-origin check for mutations and error responses.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/**
 * A D1 (or SQLite) uniqueness violation: a unique or primary key another
 * request won the race for. NOT NULL, CHECK and FOREIGN KEY failures are
 * programming errors, not races, and stay a logged 500.
 */
const uniquenessRace = (error: unknown) =>
  error instanceof Error &&
  /\b(?:UNIQUE|PRIMARY KEY) constraint failed|SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)\b/i.test(
    error.message,
  );
/**
 * The response for a failed request: an ApiError as it says (a request body
 * that is not JSON arrives here as ApiError(400) from parseJsonBody), a
 * uniqueness race as 409 (F-54), and anything else, including a SyntaxError
 * from stored data, as a logged 500 that does not reveal its cause.
 */
export function responseError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (uniquenessRace(error)) {
    console.warn("Audit workspace request lost a uniqueness race", message);
    return Response.json(
      {
        error:
          "Another change was saved at the same time. Reload and apply your changes again.",
      },
      { status: 409 },
    );
  }
  console.error("Audit workspace request failed", message);
  return Response.json(
    {
      error:
        "The request could not be completed. Your changes were not confirmed.",
    },
    { status: 500 },
  );
}
/**
 * Decode a request body as JSON. Only this parse answers 400: a SyntaxError
 * anywhere else comes from stored data and is a server fault.
 */
export function parseJsonBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "The request body is not valid JSON");
  }
}
/** Read a bounded request body and decode it as JSON (see parseJsonBody). */
export async function readJson(request: Request, limit: number) {
  return parseJsonBody(await readBounded(request, limit));
}
export async function readBounded(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Request body required");
  const pieces: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "Request exceeds the permitted size");
    }
    pieces.push(part.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of pieces) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new ApiError(403, "A same-origin request is required");
}
