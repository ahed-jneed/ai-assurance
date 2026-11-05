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
export function responseError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Audit workspace request failed",
    error instanceof Error ? error.message : "Unknown failure",
  );
  return Response.json(
    {
      error:
        "The request could not be completed. Your changes were not confirmed.",
    },
    { status: 500 },
  );
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
