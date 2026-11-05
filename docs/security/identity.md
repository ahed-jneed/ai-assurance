# Identity: trust boundary runbook

The workspace never decides on its own whom to trust. The Worker entry (`site-app/build/sites-worker.ts`) runs the identity adapter (`site-app/lib/identity.ts`) before the app sees a request. The Worker variable `IDENTITY_MODE` selects the one credential that is trusted. **With no mode configured, nothing is trusted:** every request is anonymous and the API answers 401. An unknown or incomplete mode behaves the same way and logs the problem once per isolate (`Identity: ...`). The one exception is the Sites build, which uses `sites` while `IDENTITY_MODE` is unset (see below).

## Modes

| `IDENTITY_MODE` | Trusted credential | Where to use it | Also requires |
|---|---|---|---|
| *(unset)* | nothing (401) | the safe default of every build except the Sites build | — |
| `sites` | `oai-authenticated-user-*` headers | OpenAI Sites only: dispatch strips inbound copies and sets them | set by the Sites build, as a Worker variable and as its compiled-in default |
| `cloudflare-access` | `Cf-Access-Jwt-Assertion`, an RS256 JWT from Cloudflare Access | Cloudflare Workers and custom domains behind an Access application | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` |
| `trusted-headers` | `oai-authenticated-user-*` headers sent by a test client | the Miniflare harnesses and local end-to-end tests | `IDENTITY_TRUSTED_HEADERS=loopback-tests`; loopback requests only |
| `dev` | headers set by the dev server's persona sign-in | `npm run dev` only | the development server (compiled out of builds); loopback requests only |

**Why headers are stripped.** Any client can send `oai-authenticated-user-id`. Only Sites dispatch removes forged copies before the Worker sees the request, so outside `sites` mode those headers are an authentication bypass (F-02). Outside `sites` mode, the Worker entry removes every inbound `oai-*` header before the app runs. App code reads the caller through `currentUser()` (`lib/identity.ts`), never from headers. `/api/runner` keeps its own bearer-token authentication and does not use the user identity.

**Loopback** means that the request URL's host is `127.0.0.1`, `localhost` or `::1` and that `CF-Connecting-IP`, if present, is a loopback address. On Cloudflare, the edge routes only the Worker's own hostnames and sets `CF-Connecting-IP` to the real client, so a deployed Worker never passes this check. In a local runtime (`wrangler dev`, `npm start`, Miniflare) the check cannot tell which machine connected: the Worker sees the `Host` the client sent and a `CF-Connecting-IP` that is loopback, missing or also sent by the client. There, **the listener's bind address is what keeps other machines out** (`npm start` binds `127.0.0.1`). Never combine `trusted-headers` with `--ip 0.0.0.0`, a LAN listener or a tunnel, and never enable it on a host that is not your own machine. The `dev` mode does not rely on this check: the dev server checks the socket address itself and removes inbound identity headers.

## Which mode is configured where

`site-app/vite.config.ts` writes the mode into the Worker variables:

- **`npm run dev`** (portable profile): `IDENTITY_MODE=dev`, with the loopback persona mock. The managed-linux profile has no mock and no mode, so it answers 401.
- **The Sites build:** `npm run build` in a checkout with `.openai/hosting.json` (a Sites project) writes `IDENTITY_MODE=sites` into `dist/server/wrangler.json`. It also compiles `sites` in as the default while `IDENTITY_MODE` is unset (a `define` in `vite.config.ts`), so the Site does not depend on the Sites publisher applying those variables. An explicit `IDENTITY_MODE`, such as `--var IDENTITY_MODE:cloudflare-access`, still wins.
- **Any other build** (clean clones, CI) configures no mode and has no default, so the build answers 401 until its deployment sets one. Never deploy a Sites build anywhere except Sites: it trusts dispatch headers even when no variable is set.

Local overrides go in `site-app/.dev.vars` for the dev server, or are passed as `--var` to Wrangler for the built Worker, for example `npm start -- --var IDENTITY_MODE:trusted-headers --var IDENTITY_TRUSTED_HEADERS:loopback-tests`.

## Configure Cloudflare Access

1. In Cloudflare Zero Trust, create a **self-hosted Access application** that covers the Worker's hostname, with the identity providers and policies of your practice. Copy the application's **Audience (AUD) tag**. Your **team domain** is `<team>.cloudflareaccess.com`.
2. Add a **Bypass** (or service-token) policy for `/api/runner*`. Runners authenticate with their own bearer tokens and carry no Access session.
3. Build in a clean clone, not a Sites checkout, so that a missing variable means 401 rather than `sites`. Deploy with the identity variables:

   ```sh
   npm run build
   npx wrangler deploy --config dist/server/wrangler.json \
     --var IDENTITY_MODE:cloudflare-access \
     --var CF_ACCESS_TEAM_DOMAIN:<team>.cloudflareaccess.com \
     --var CF_ACCESS_AUD:<aud-tag>
   ```

   `CF_ACCESS_AUD` may list several comma-separated tags. Neither value is a secret.
4. Check the deployment: a request without the Access cookie must be stopped by Access. A request with a forged `oai-authenticated-user-id` header must still get 401 from `/api/workspace`. Because the Worker verifies the token itself, a hostname that bypasses Access (such as `*.workers.dev`) stays anonymous, and its `/signin-with-chatgpt` answers 401; disable it anyway.

The Worker verifies each token's RS256 signature against the team keys at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. It checks the issuer, the audience and the validity window (with 30 seconds of clock skew allowed for `nbf`/`iat`), then maps `sub` to the user ID, plus `email` and the optional `name`. Tokens with any other algorithm (including `none` and `HS256`), an unknown key ID, a bad signature, or no user (service tokens) are refused. The key set is cached for an hour. An unknown key ID triggers at most one refetch a minute, and a failed fetch is retried after 5 seconds. Until a fetch succeeds, requests are refused (fail closed).

Access signs the user in before a request reaches the Worker, so `/signin-with-chatgpt` only returns to the return path, and only when the request carries a verified token. Without one (a hostname Access does not cover, a wrong `CF_ACCESS_AUD` or team domain, or no signing keys) it answers 401 (`Cloudflare Access did not authenticate this request.`), because a redirect would send the visitor back to the page that asked for sign-in, in a loop. The Worker then logs `Identity: sign-in on <host> has no verified Cloudflare Access token` once per isolate. `/signout-with-chatgpt` redirects to `/cdn-cgi/access/logout`.

## Development personas and the demo practice

Persona sign-in exists only in the dev server (`build/sites-vite-plugin.ts`) and only for loopback requests. Builds contain neither the mechanism nor the persona fixture; `scripts/identity-check.mjs` checks the build output for this.

- `/signin-with-chatgpt?return_to=/` signs in as the default local identity (`local_seedy`).
- `/signin-with-chatgpt?as=<persona>&return_to=/` signs in as `qa-lead`, `qa-auditor`, `qa-reviewer`, `qa-lead2`, `qa-contrib`, `qa-viewer` or `qa-outsider` (`site-app/fixtures/dev-personas.json`). The account menu offers the same switch, and the signed-out screen lists the personas.
- With `npm run dev` running, `npm run seed:demo` (from `site-app/`) provisions qa-lead's practice through the app's own API. The practice has the client "Acme", a structured engagement, every persona's membership and engagement grant, and an evidence request assigned to `qa-contrib`. `qa-lead2` also leads a practice of their own, so practice switching is reachable. `qa-outsider` stays outside the practice. Run the seed before signing in as a persona: a persona's first sign-in without a membership provisions a practice of its own. The seed prints a sign-in link for each persona. Running it again changes nothing. Pass a URL for another port, and `--trusted-headers` to seed a built Worker in `trusted-headers` mode.

## Verification

- `site-app/lib/identity.test.ts` and `lib/cloudflare-access.test.ts` (Vitest) cover mode selection, forged headers in every mode, header removal and token verification, using a locally generated key pair and a stub key set.
- `site-app/scripts/identity-check.mjs` runs the same matrix against the built Worker in Miniflare, including Access tokens served by a stub `outboundService`, and checks that an anonymous `/report` in `cloudflare-access` mode ends at a 401 from sign-in instead of looping. It also checks that the build configures `sites` mode, and defaults to it, only for Sites checkouts, and that it contains no personas.
- The integration harnesses opt in to `trusted-headers` explicitly.
