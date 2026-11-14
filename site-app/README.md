# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback. A server-rendering error in the development server is printed to its log as `[ssr] Server rendering error; ...` with its stack (`build/ssr-error-log.ts`): vinext otherwise answers such a page with a silent 500 and lets the browser render it.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests, and the Worker trusts it only in `IDENTITY_MODE=dev`, which exists only on the development server. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`), `/signin-with-chatgpt?as=<persona>&return_to=/` to sign in as one of the test personas in `fixtures/dev-personas.json` (`qa-lead`, `qa-auditor`, `qa-reviewer`, `qa-lead2`, `qa-contrib`, `qa-viewer`, `qa-outsider`), and `/signout-with-chatgpt?return_to=/` to sign out. The account menu in the sidebar footer offers Sign out and, on the development server, the persona switch; the signed-out screen lists the personas. The sign-in cookie is named for the dev server's port (`__sites_local_auth_<port>`), so dev servers on different ports keep separate sign-ins and never sign each other out; it preserves the identity across restarts on the same port. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

With the dev server running and the local migrations applied (`npm run db:migrate:local`, below; without them every API call answers 500 with `no such table` and the seed stops), `npm run seed:demo` provisions a demo practice through the app's own API: qa-lead's practice with the client "Acme", a structured engagement, each persona's membership and engagement grant, and an evidence request that `qa-contrib` can answer in the client portal; `qa-lead2` also leads a practice of their own (practice switching) and `qa-outsider` stays outside. Run it before signing in as a persona, since a first sign-in without a membership provisions a separate practice. It prints a sign-in link per persona and is safe to run again. Pass the URL for another port (`npm run seed:demo -- http://127.0.0.1:5184`), or `--trusted-headers` for a built Worker in `trusted-headers` mode.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port. Outside a Sites checkout the build trusts no identity and the API answers 401; for local end-to-end tests pass `npm start -- --var IDENTITY_MODE:trusted-headers --var IDENTITY_TRUSTED_HEADERS:loopback-tests` and send the `oai-authenticated-user-*` headers from the test client.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `lib/identity.ts` resolves the caller at the Worker entry according to `IDENTITY_MODE` (`sites`, `cloudflare-access`, `trusted-headers` or `dev`); with no mode the API answers 401. See [`docs/security/identity.md`](../docs/security/identity.md)
- `app/chatgpt-auth.ts` provides `requireChatGPTUser()` for server-rendered pages; `lib/auth-paths.ts` builds sign-in and sign-out links
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings; it is checkout-local (ignored by Git), and builds without it use the `DB`/`BUCKET` bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

On Sites, dispatch sends signed-in visitors' identity in headers. In this workspace only the identity adapter (`lib/identity.ts`) reads them, and only in `sites` mode or in the loopback `trusted-headers` and `dev` modes; in every other mode the Worker entry removes inbound `oai-*` headers before the app runs. App code reads the caller with `currentUser()` from `lib/identity.ts` and never reads these headers itself.

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

The adapter treats the full name as optional: `currentUser()` returns `{ userId, email, displayName, fullName }`, where `displayName` falls back to the email when no full name is present.

## Optional Dispatch-Owned ChatGPT Sign-In

Use these helpers when the site needs optional or required sign-in:

- Use `currentUser()` from `lib/identity.ts` for optional signed-in UI in server code; it returns `null` for anonymous requests.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` from `app/chatgpt-auth.ts` for server-rendered pages that should send anonymous visitors to sign-in. That module is server-only; do not import it into a Client Component.
- Build links with `signInPath(returnTo)` and `signOutPath(returnTo)` from `lib/auth-paths.ts` (usable in Client Components too), for example `<a href={signInPath(returnTo)} target="_top">`.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out, normally the current location so that deep links survive. The helpers validate and safely encode it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Outside Sites, the development server answers them in `dev` mode and the Worker entry answers them in the other modes: in `cloudflare-access` mode sign-in returns to the return path once Access has authenticated the request (401 otherwise) and sign-out redirects to `/cdn-cgi/access/logout`; without an interactive sign-in they answer 401. The workspace's sign-in button says "Sign in with ChatGPT" only in the Sites build and on the development server, and "Sign in" in every other build (`signInLabel()` in `lib/auth-paths.ts`). Routes that do not call the helpers remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. Then apply the pending migrations:

```sh
npm run db:migrate:local
```

`scripts/db-migrate-local.mjs` applies every `drizzle/*.sql` file not yet applied, in order, through `wrangler d1 execute --local`, and records each one in the local table `local_migrations` with the SHA-256 of its content, so running it again changes nothing. A migration is identified by that hash, not only by its file name: a file renamed after it was applied is recognised as applied and its record renamed, and a file edited after it was applied stops the run before anything is applied, naming the file (an applied migration is never edited: add a new one, or delete the local state directory and migrate again). Line endings are normalised before hashing, so a CRLF checkout names the same migration. A table recorded before content hashes gets them once, from the files as they are at that run; an edit made before then cannot be detected, and a file renamed before then matches no record and is applied again (the run names the recorded migrations that have no file; give the file its old name back for that run, or delete the local state directory). A database whose migrations were applied by hand before the script existed is adopted once: a migration counts as applied when every table, index, trigger and added column it creates exists, and a data-only migration (such as `0005`) when a later migration is applied. Pass `--persist-to <dir>` for another state directory (default `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories) and `--binding <name>` if the D1 binding is not `DB`. This updates only the preview database; publishing applies production migrations separately.

## End-to-end tests

`npm run test:e2e` runs the Playwright persona suite with axe accessibility checks against the built Worker on a fresh database in `.wrangler/e2e-state` (run `npm run build` and, once, `npx playwright install chromium` first). See [`e2e/README.md`](e2e/README.md) for the flows, the tracked accessibility exceptions and the CI job.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run seed:demo`: seed the persona demo practice into a running dev server
- `npm run db:migrate:local`: apply the pending D1 migrations to the local database (idempotent)
- `npm run test:e2e`: run the Playwright persona suite against the built Worker (not part of `npm run check`; CI runs it in the `e2e` job)
- `npm run check`: run everything CI runs for this workspace (`format:check`, `typecheck`, `lint`, `test`, `build`, `check:harnesses`); each step is also its own script

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
