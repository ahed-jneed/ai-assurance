# Workspace (`site-app`)

The AI Assurance workspace: a React 19 single-page app and its API in one Cloudflare Worker, built with [Vinext](https://github.com/cloudflare/vinext), with D1 for records and R2 for evidence and immutable blobs. The [root README](../README.md) says what the platform does and how to run every check; the [capability matrix](../docs/capabilities.md) maps each capability to the code and tests below; the [codebase map](../docs/engineering/codebase-map.md) describes the architecture.

## Layout

| Path | Contents |
|---|---|
| `app/` | Pages and UI. `app/page.tsx` loads the workspace shell in `app/workspace/` (shell, hooks, modals, views, navigation guards); large screens live in `app/audit-program/`, `app/assurance-workbench/` and `app/testing-lab/`; `app/report/` is the server-rendered print view; `app/operator/` the platform operator console; `app/ll144-summary/` the publishable LL144 summary |
| `app/api/*/route.ts` | HTTP routes: `workspace`, `assurance` and `management` (GET read models and POST commands), `evidence`, `client-submission`, `report-package`, `dossier` (and `dossier/keys`), `coverage`, `audit-trail`, `access-log`, `ll144-summary`, `work-inbox`, `workspace-state`, `evaluation/dataset`, `operator` and `runner` (bearer token, for the external worker) |
| `lib/commands/` | Every POST op of `/api/workspace`, `/api/assurance` (`lib/commands/assurance/`) and `/api/management` (`lib/commands/management/`), each a `defineCommands({ op: { roles, handle } })` handler with required roles; the dispatcher tests pin each op set and its roles |
| `lib/read-models/` | The GET read models (workspace, assurance, coverage, GenAI, LL144 summary, audit trail, Access log) |
| `lib/domain/`, `lib/workflow/` | The audit domain (types, classification, gates, report model, quality review, Art 50 papers) and the workflow services; `lib/workflow/dispatch.ts` dispatches the workflow ops |
| `lib/criteria/`, `lib/genai/`, `lib/papers/` | The criteria model and coverage, GenAI evidence, and paper revisions and exports |
| `lib/http.ts`, `lib/tenancy.ts`, `lib/engagement-repo.ts`, `lib/factories.ts`, `lib/ids.ts`, `lib/bindings.ts` | HTTP helpers; identity-to-tenant context, `requireRole`, `requireAdmin` and provisioning; engagement persistence; record factories; ids, `now` and `sha256`; the `DB` and `BUCKET` bindings |
| `lib/identity.ts`, `lib/permissions.ts` | The identity adapter, and the one permission map that the UI and the tests share |
| `db/schema.ts`, `drizzle/` | The Drizzle declaration of every D1 table, and the SQL migrations (`0000` to `0017`; take the next free number) |
| `build/`, `vite.config.ts` | The Worker entry (`build/worker.ts`) and the development sign-in plugin (`build/dev-sign-in.ts`) |
| `scripts/` | Build, sync, seed and migration scripts, and the Miniflare harnesses (`*-check.mjs`, sharing `scripts/harness/`) |
| `e2e/` | The Playwright persona suite ([e2e/README.md](e2e/README.md)) |
| `fixtures/dev-personas.json` | The loopback development personas |
| `lib/catalog.json`, `lib/annex-iv-map.json`, `lib/obligation-subitems.json`, `lib/criteria/bundle.generated.json`, `public/tools/` | Generated copies of the root `templates/`, `docs/` and `engine/` sources: edit the source and run `npm run sync` |

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install from the lockfile |
| `npm run dev` | The development server with hot reload and the loopback sign-in simulation (port 5173; pass `-- --port <port> --strictPort` for another) |
| `npm run build` | Build the Worker into `dist/` |
| `npm start` | Run the built Worker locally through Wrangler on `127.0.0.1` (port 8787; pass `-- --port <port>` for another), sharing `.wrangler/state` with the development server; no sign-in simulation |
| `npm run db:migrate:local` | Apply the pending D1 migrations to the local database (idempotent) |
| `npm run seed:demo` | Seed the persona demo practice into a running development server |
| `npm run db:generate` | Generate a Drizzle migration after a schema change |
| `npm run sync` | Regenerate the generated copies from the root sources |
| `npm run format` | Apply Prettier |
| `npm run check` | Everything the CI `web` job runs: `format:check`, `typecheck`, `lint`, `test` (Vitest), `check:sync`, `check:build`, `check:harnesses`, `check:fixtures` |
| `npm run test:e2e` | The Playwright persona suite against the built Worker (CI runs it in the `e2e` job) |

The harnesses that start Python use `ASSURANCE_TEST_PYTHON`, then `PYTHON`, then `python` on Windows and `python3` elsewhere, with `../engine/requirements-dev.txt` installed. On Windows the harnesses need a short temp directory (workerd cannot open an SQLite path past 260 characters): when `TEMP` is longer than 100 characters, `scripts/harness/env.mjs` switches them to `%LOCALAPPDATA%\Temp\aa-harness` (else `%SystemDrive%\aa-harness-tmp`), and `ASSURANCE_HARNESS_TEMP` chooses another short directory. `package-lock.json` is maintained with npm 11: change dependencies only with `npx npm@11 install ...`.

## Local development and sign-in

The development server simulates sign-in only for loopback requests, and the Worker trusts it only in `IDENTITY_MODE=dev`, which exists only on the development server:

- `/auth/sign-in?return_to=/` signs in as `local_seedy` (`seedy@personas.test`, "Seedy");
- `/auth/sign-in?as=<persona>&return_to=/` signs in as a persona from `fixtures/dev-personas.json` (`qa-lead`, `qa-auditor`, `qa-reviewer`, `qa-lead2`, `qa-eqr`, `qa-contrib`, `qa-viewer`, `qa-outsider`);
- `/auth/sign-out?return_to=/` signs out. The account menu in the sidebar footer offers Sign out and, on the development server, the persona switch.

The sign-in cookie is named for the port (`__dev_sign_in_<port>`), so development servers on different ports keep separate sign-ins. Personas are compiled out of builds.

With the development server running and the local migrations applied (`npm run db:migrate:local`, below; without them every API call answers 500 with `no such table` and the seed stops), `npm run seed:demo` provisions a demo practice through the app's own API: qa-lead's practice with the client "Acme", a structured engagement, each persona's membership and engagement grant, and an evidence request that `qa-contrib` can answer in the client portal; `qa-lead2` also leads a practice of their own and `qa-outsider` stays outside. Run it before signing in as a persona, since a first sign-in without a membership provisions a separate practice. It prints a sign-in link per persona and is safe to run again. Pass another URL (`npm run seed:demo -- http://127.0.0.1:5184`), or `--trusted-headers` with the URL for a built Worker in `trusted-headers` mode (`npm run seed:demo -- --trusted-headers http://127.0.0.1:8787`, after starting it with `SELF_SIGNUP` as below); that server has no persona sign-in route, so the seed then prints the `x-assurance-user-id` and `x-assurance-user-email` headers to send as each persona instead of links.

A server-rendering error in the development server is printed to its log as `[ssr] Server rendering error; ...` with its stack (`build/ssr-error-log.ts`): Vinext otherwise answers such a page with a silent 500 and lets the browser render it.

`npm start` serves the built Worker without a sign-in simulation: the build trusts no identity and the API answers 401. For local end-to-end tests and the seeded personas, stop the development server (both use `.wrangler/state`) and start the built Worker in the loopback-only `trusted-headers` mode, then send the `x-assurance-user-*` headers from the test client:

```sh
npm start -- --var IDENTITY_MODE:trusted-headers --var IDENTITY_TRUSTED_HEADERS:loopback-tests --var SELF_SIGNUP:open
# in another terminal, while it runs (http://127.0.0.1:8787)
npm run seed:demo -- --trusted-headers http://127.0.0.1:8787
```

To serve it on another port, add `--port` to the same command and give the seed that URL, for example `npm start -- --port 8788 --var IDENTITY_MODE:trusted-headers --var IDENTITY_TRUSTED_HEADERS:loopback-tests --var SELF_SIGNUP:open` and `npm run seed:demo -- --trusted-headers http://127.0.0.1:8788`. These commands are the same in PowerShell and in a macOS or Linux shell.

Outside the development server self-signup is off unless `SELF_SIGNUP` allows it ([docs/security/identity.md](../docs/security/identity.md#who-gets-a-practice-invitations-and-self-signup)), so without `--var SELF_SIGNUP:open` (or `--var SELF_SIGNUP:@personas.test`, the persona domain) a fresh database answers the seed's first persona with 403 "You have no practice membership or pending invitation", and the seed stops and names the setting.

Local previews use Miniflare's placeholder `Request.cf` metadata; set `CLOUDFLARE_CF_FETCH_ENABLED=true` to fetch it. Wrangler metrics are off unless `WRANGLER_SEND_METRICS=true`.

## Identity

`lib/identity.ts` resolves the caller at the Worker entry according to `IDENTITY_MODE`: `cloudflare-access` (a verified Access token) in production, or the loopback-only `trusted-headers` and `dev` modes. With no mode, every request is anonymous and the API answers 401 (decision D-23). In every mode the Worker entry removes inbound `x-assurance-user-*` headers before the app runs, and app code reads the caller only through `currentUser()`. See [docs/security/identity.md](../docs/security/identity.md).

`/auth/sign-in` and `/auth/sign-out` are answered by the development server in `dev` mode and by the Worker entry in every other mode (behind Cloudflare Access, sign-in returns a verified caller to the page and sign-out goes to the Access logout). Do not implement app routes for those paths, and start sign-in only as a top-level navigation (build links with `signInPath()` and `signOutPath()` from `lib/auth-paths.ts`). Sign-in establishes identity only; practice membership and roles are checked on the server (`lib/tenancy.ts`).

## Local D1 migrations

Build once (`npm run build`) to generate `dist/server/wrangler.json`, rebuilding if bindings change, then apply the pending migrations:

```sh
npm run db:migrate:local
```

`scripts/db-migrate-local.mjs` applies every `drizzle/*.sql` file not yet applied, in order, through `wrangler d1 execute --local`, and records each one in the local table `local_migrations` with the SHA-256 of its content, so running it again changes nothing. A migration is identified by that hash, not only by its file name: a file renamed after it was applied is recognised as applied and its record renamed, and a file edited after it was applied stops the run before anything is applied, naming the file (an applied migration is never edited: add a new one, or delete the local state directory and migrate again). Line endings are normalised before hashing, so a CRLF checkout names the same migration. A table recorded before content hashes gets them once, from the files as they are at that run; an edit made before then cannot be detected, and a file renamed before then matches no record and is applied again (the run names the recorded migrations that have no file; give the file its old name back for that run, or delete the local state directory). A database whose migrations were applied by hand before the script existed is adopted once: a migration counts as applied when every table, index, trigger and added column it creates exists, and a data-only migration (such as `0005`) when a later migration is applied. Pass `--persist-to <dir>` for another state directory (default `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories) and `--binding <name>` if the D1 binding is not `DB`. This updates only the preview database; publishing applies production migrations separately.

Without the local migrations the development server still starts, but every API request answers 500 (`D1_ERROR: no such table: ...`) and `npm run seed:demo` stops; stop the server, run `npm run db:migrate:local`, start it again and rerun the seed. On Windows, keep the checkout path short (`site-app\` under about 120 characters): workerd stores the local database about 125 characters below `site-app\`, and past the 260-character limit `npm run db:migrate:local` fails with `SQLITE_CANTOPEN`.

## End-to-end tests

`npm run test:e2e` runs the Playwright persona suite with axe accessibility checks against the built Worker on a fresh database in `.wrangler/e2e-state` (run `npm run build` and, once, `npx playwright install chromium` first). Do not run `npm run build` or `npm run check` in the same checkout while the suite's server runs. See [e2e/README.md](e2e/README.md) for the flows, the tracked accessibility exceptions and the CI job.

## Deployment

The Worker runs on Cloudflare Workers with D1 and R2 bindings named `DB` and `BUCKET` (`cloudflare-env.d.ts`), behind a Cloudflare Access application. [docs/security/identity.md](../docs/security/identity.md#configure-cloudflare-access) walks through the Access setup and the deploy command; [docs/security/signing-keys.md](../docs/security/signing-keys.md) covers the `DOSSIER_KEK` secret. Apply the migrations in `drizzle/` to the production database, in order, before deploying a build that needs them. `.wrangler/` and `.vinext/` hold disposable local state and are ignored by Git.

