// Sign-in and sign-out locations, shared by the server and the browser. The
// paths are the ones Sites dispatch owns; in the other identity modes the
// development server (build/sites-vite-plugin.ts) or the Worker entry
// (lib/identity.ts) answers them. See docs/security/identity.md.
export const SIGN_IN_PATH = "/signin-with-chatgpt";
export const SIGN_OUT_PATH = "/signout-with-chatgpt";
export const CALLBACK_PATH = "/callback";
const reservedPaths = new Set([SIGN_IN_PATH, SIGN_OUT_PATH, CALLBACK_PATH]);
/** Development persona ids, as in fixtures/dev-personas.json. */
const personaPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Whether the path is one of the reserved sign-in routes. */
export function isAuthPath(pathname: string): boolean {
  return reservedPaths.has(pathname);
}

/**
 * A same-origin path to return to, or "/" for anything else: absolute and
 * protocol-relative URLs, backslash tricks and the reserved sign-in routes.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.invalid");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.invalid" || isAuthPath(url.pathname))
    return "/";
  return url.pathname + url.search + url.hash;
}

/** Sign in, then return to `returnTo`; `persona` picks a development persona. */
export function signInPath(returnTo: string, persona?: string): string {
  const query = new URLSearchParams();
  if (persona !== undefined) {
    if (!personaPattern.test(persona)) throw new Error("Invalid persona id");
    query.set("as", persona);
  }
  query.set("return_to", safeReturnPath(returnTo));
  return SIGN_IN_PATH + "?" + query;
}

/** Sign out, then return to `returnTo`. */
export function signOutPath(returnTo = "/"): string {
  return (
    SIGN_OUT_PATH +
    "?" +
    new URLSearchParams({ return_to: safeReturnPath(returnTo) })
  );
}
