// Stable props for the memoised workspace views (#63, F-48). The shell's
// hooks (location, navigation, lab intent) return a new object with new
// handler functions on every render, so a memoised view that receives them
// would still re-render on each keystroke anywhere in the workspace.
// useStableShape returns the same object, and the same nested objects, for
// as long as their values are unchanged, and replaces each handler with a
// stable function that calls the handler of the latest render.
//
// Only for event handlers: a stable handler calls the version committed last,
// so a function called during render (a name resolver, say) must be passed
// as itself, memoised on what it reads.
import { useLayoutEffect, useRef, useState } from "react";

type Path = readonly string[];
type Handler = (...args: unknown[]) => unknown;

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * `next` with the parts that equal `previous` replaced by those of
 * `previous`: plain objects and arrays are compared entry by entry (down to
 * `depth` levels, without limit by default), a function is always the same stable handler
 * (`handler(path)`), anything else compares by identity. Returns `previous`
 * itself when nothing changed.
 */
export function stabilize<T>(
  previous: unknown,
  next: T,
  handler: (path: Path) => Handler,
  depth = Infinity,
  path: Path = [],
): T {
  if (typeof next === "function")
    return (typeof previous === "function" ? previous : handler(path)) as T;
  if (depth <= 0) return next;
  if (Array.isArray(next)) {
    const base = Array.isArray(previous) ? previous : undefined,
      result = next.map((item, i) =>
        stabilize(base?.[i], item, handler, depth - 1, [...path, String(i)]),
      );
    return (
      base?.length === result.length && result.every((x, i) => x === base[i])
        ? base
        : result
    ) as T;
  }
  if (!plain(next)) return next;
  const base = plain(previous) ? previous : undefined;
  let changed = !base || Object.keys(base).length !== Object.keys(next).length;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    result[key] = stabilize(base?.[key], next[key], handler, depth - 1, [
      ...path,
      key,
    ]);
    if (!base || !(key in base) || result[key] !== base[key]) changed = true;
  }
  return (changed ? result : base) as T;
}

const at = (value: unknown, path: Path) =>
  path.reduce<unknown>(
    (v, key) => (v as Record<string, unknown> | undefined)?.[key],
    value,
  );

/** `value` with stable identity while its values are unchanged; see stabilize. */
export function useStableShape<T>(value: T): T {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  // A stable handler calls the function at its path in the latest value.
  const [handler] = useState(
    () =>
      (path: Path): Handler =>
      (...args) =>
        (at(latest.current, path) as Handler)(...args),
  );
  const [stable, setStable] = useState(() =>
    stabilize(undefined, value, handler),
  );
  const next = stabilize(stable, value, handler);
  // Stores the value of this render for the next one; React re-runs the
  // component at once, before it renders any child. Hence `value` must hold
  // only handlers, primitives, plain objects and arrays (compared in full) or
  // values whose identity is stable: a part made anew on every render would
  // never settle.
  if (next !== stable) setStable(next);
  return next;
}
