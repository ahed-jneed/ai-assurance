// The development server logs server-rendering errors (#204): the plugin
// finds its anchor in the installed vinext, and the line it adds prints an
// error without a Next.js digest and stays quiet for redirect() and
// notFound().
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addSsrErrorLog, isSsrEntry, ssrErrorLog } from "./ssr-error-log";

const installedEntry = fileURLToPath(
  new URL(
    "../node_modules/vinext/dist/server/app-ssr-entry.js",
    import.meta.url,
  ),
);

/** Runs the onError the plugin produces, as vinext's renderer calls it. */
function onErrorFrom(patched: string) {
  const start = patched.indexOf("onError(error) {");
  const body = patched.slice(start + "onError(error) {".length);
  const firstStatement = body.indexOf("return;") + "return;".length;
  const logLine = body.slice(
    firstStatement,
    body.indexOf("\n", firstStatement),
  );
  return new Function("error", logLine) as (error: unknown) => void;
}

afterEach(() => vi.restoreAllMocks());

describe("the SSR error log", () => {
  it("finds vinext's onError in the installed SSR entry", () => {
    const code = readFileSync(installedEntry, "utf8");
    const patched = addSsrErrorLog(code);
    expect(patched).not.toBeNull();
    expect(patched).toContain("[ssr] Server rendering error");
    // One line added, nothing else changed.
    expect(patched!.replace(/if \(!\(error[^\n]*?error\);/, "")).toBe(code);
  });

  it("prints an error without a digest and skips redirect and notFound", () => {
    const patched = addSsrErrorLog(readFileSync(installedEntry, "utf8"))!;
    const onError = onErrorFrom(patched);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("window is not defined");
    onError(failure);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toBe(failure);
    onError(
      Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/;307;",
      }),
    );
    onError(
      Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      }),
    );
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("matches only the SSR entry, with Windows and query forms", () => {
    expect(isSsrEntry(installedEntry)).toBe(true);
    expect(
      isSsrEntry("C:\\x\\node_modules\\vinext\\dist\\server\\app-ssr-entry.js"),
    ).toBe(true);
    expect(
      isSsrEntry("/x/node_modules/vinext/dist/server/app-ssr-entry.js?v=1a2b"),
    ).toBe(true);
    expect(
      isSsrEntry("/x/node_modules/vinext/dist/server/app-page-render.js"),
    ).toBe(false);
  });

  it("runs only in the development server and warns once if the anchor is gone", () => {
    const plugin = ssrErrorLog();
    expect(plugin.apply).toBe("serve");
    const warn = vi.fn();
    const transform = plugin.transform as unknown as (
      this: { warn: typeof warn },
      code: string,
      id: string,
    ) => unknown;
    const id = "/x/node_modules/vinext/dist/server/app-ssr-entry.js";
    expect(transform.call({ warn }, "export {}", id)).toBeUndefined();
    expect(transform.call({ warn }, "export {}", id)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(
      transform.call({ warn }, "export {}", "/x/app/page.tsx"),
    ).toBeUndefined();
  });
});
