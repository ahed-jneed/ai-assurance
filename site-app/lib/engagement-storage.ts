import { bucket } from "./bindings";
import type { Engagement } from "./domain";
import { ApiError } from "./http";
import { sha256 } from "./ids";
import type { Context } from "./tenancy";
type Ref = { key: string; sha256: string };
export async function dehydrate(ctx: Context, e: Engagement) {
  const copy = structuredClone(e) as Engagement & {
      storageRefs?: {
        reports: Record<string, { snapshot: Ref; clientSnapshot?: Ref }>;
        histories: Record<string, Ref>;
        results: Record<string, Ref>;
      };
    },
    refs = {
      reports: {} as Record<string, { snapshot: Ref; clientSnapshot?: Ref }>,
      histories: {} as Record<string, Ref>,
      results: {} as Record<string, Ref>,
    };
  async function put(type: string, value: unknown) {
    const body = JSON.stringify(value),
      hash = await sha256(body),
      key = ctx.tenantId + "/" + e.id + "/immutable/" + type + "/" + hash;
    await bucket().put(key, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: hash },
    });
    return { key, sha256: hash };
  }
  for (const r of copy.reports) {
    refs.reports[r.id] = {
      snapshot: await put("report", r.snapshot),
      ...(r.clientSnapshot
        ? { clientSnapshot: await put("client-report", r.clientSnapshot) }
        : {}),
    };
    r.snapshot = {};
    delete r.clientSnapshot;
  }
  for (const p of copy.papers)
    if (p.history.length) {
      refs.histories[p.id] = await put("paper-history", p.history);
      p.history = [];
    }
  for (const r of copy.runs)
    if (r.results.length) {
      refs.results[r.id] = await put("results", r.results);
      r.results = [];
    }
  copy.storageRefs = refs;
  return copy;
}
export async function hydrate(e: Engagement) {
  const copy = e as Engagement & {
      storageRefs?: {
        reports: Record<string, { snapshot: Ref; clientSnapshot?: Ref }>;
        histories: Record<string, Ref>;
        results: Record<string, Ref>;
      };
    },
    refs = copy.storageRefs;
  if (!refs) return e;
  async function get(ref: Ref) {
    const o = await bucket().get(ref.key);
    if (!o)
      throw new ApiError(
        503,
        "An immutable audit record is temporarily unavailable",
      );
    const bytes = await o.arrayBuffer();
    if ((await sha256(bytes)) !== ref.sha256)
      throw new ApiError(409, "Immutable audit record integrity mismatch");
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  for (const r of e.reports) {
    const ref = refs.reports[r.id];
    if (ref) {
      r.snapshot = await get(ref.snapshot);
      if (ref.clientSnapshot) r.clientSnapshot = await get(ref.clientSnapshot);
    }
  }
  for (const p of e.papers)
    if (refs.histories[p.id]) p.history = await get(refs.histories[p.id]);
  for (const r of e.runs)
    if (refs.results[r.id]) r.results = await get(refs.results[r.id]);
  delete copy.storageRefs;
  return e;
}
