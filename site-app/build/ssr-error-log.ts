// Logs server-rendering errors in the development server (#204).
//
// vinext renders the HTML of an App Router page in its SSR entry
// (vinext/dist/server/app-ssr-entry.js). When React fails to render the shell
// there, vinext answers 500 with an empty error document whose bootstrap
// script lets the browser render the page on its own, and it reports the
// error nowhere: React's onError only keeps it for redirect and not-found meta
// tags. The page then "recovers" in the browser while the development log
// stays empty. Errors in the RSC render reach instrumentation's
// onRequestError; SSR errors have no such hook.
//
// This plugin, which runs only in the development server, adds one line to
// that onError: an error without a Next.js digest (redirect() and notFound()
// carry one and are not failures) is printed with its stack. React calls it
// for a shell error (the silent 500 above) and for an error inside a Suspense
// boundary (the response stays 200 and the browser retries that part). The anchor is
// vinext's own onError; if a vinext upgrade changes it, the server warns once
// and build/ssr-error-log.test.ts fails against the installed vinext.
import type { Plugin } from "vite";

const SSR_ENTRY = /\/vinext\/dist\/server\/app-ssr-entry\.js(?:\?.*)?$/;
const ON_ERROR =
  /onError\(error\) \{\s*if \(pprFallbackShellSignal && isPprFallbackShellAbortError\(error\)\) return;/;
const LOG_LINE =
  'if (!(error && typeof error === "object" && typeof error.digest === "string")) console.error("[ssr] Server rendering error; the browser renders the affected part itself:", error);';

/** Whether a module id is vinext's App Router SSR entry. */
export const isSsrEntry = (id: string) =>
  SSR_ENTRY.test(id.replace(/\\/g, "/"));

/** The SSR entry's code with the logging line, or null if the anchor is gone. */
export function addSsrErrorLog(code: string): string | null {
  const match = ON_ERROR.exec(code);
  if (!match) return null;
  const end = match.index + match[0].length;
  return code.slice(0, end) + LOG_LINE + code.slice(end);
}

/** The development-only plugin; builds keep vinext's code unchanged. */
export function ssrErrorLog(): Plugin {
  let warned = false;
  return {
    name: "ai-assurance:ssr-error-log",
    apply: "serve",
    transform(code, id) {
      if (!isSsrEntry(id)) return;
      const patched = addSsrErrorLog(code);
      if (patched !== null) return { code: patched, map: null };
      if (!warned) {
        warned = true;
        this.warn(
          "vinext's SSR entry changed: server-rendering errors are not logged (build/ssr-error-log.ts).",
        );
      }
    },
  };
}
