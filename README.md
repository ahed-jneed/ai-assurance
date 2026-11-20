# AI Assurance & Audit Platform

A workspace for independent AI auditors: plan an engagement, test an AI system, document the work in reviewed working papers, and issue a signed, verifiable report under the EU AI Act, ISO/IEC 42001 and EN 18286, NYC Local Law 144 and the NIST AI RMF.

It is a reference implementation. Do not describe it as a certified or fully hardened compliance service: a diagnostic result is evidence for the auditor's judgement, not a conformity decision, and the legal content is pending qualified legal review (see [Status](#status)).

> **Disclaimer.** This software supports professional auditors. It does not provide legal advice and does not determine legal compliance or conformity, and its outputs are not certifications. The regulatory content reflects research as of the dates stated in each source, and may be incomplete or out of date. Consult qualified counsel before relying on it.

## Who it is for

Independent assessors: specialist AI-audit firms, the technology-assurance teams of audit and testing firms, and AI testing labs, who sign conclusions about AI systems and must defend them to reviewers, regulators and clients. The engagement team (Lead Auditor, Auditor, Reviewer and Engagement Quality Reviewer) works in the practice workspace; the client contributes evidence and reads released reports in a client portal. The [product direction](docs/product/direction.md) explains the choice.

## What it does

The [capability matrix](docs/capabilities.md) lists every capability with the code that implements it and the tests that cover it. In short:

- **Practice and access.** Six roles (Auditor, Lead Auditor, Reviewer, Engagement Quality Reviewer, Client Viewer, Client Contributor) plus a practice-admin flag, all checked on the server. Internal roles need a grant per engagement; client roles see only their client's released projection. Invitations, revocation that cascades, a paged audit trail and an admin-only Access log with CSV export.
- **Audit workflow.** Engagement brief and audit program with independent approval, an acceptance and independence gate before fieldwork, procedures bound to plan hashes, working papers with revisions and review, findings with independent retest, and stage gates from Planning to Sign-off. Separation of duties is enforced: no self-review, the signer differs from the reviewer, the report creator cannot approve it and the approver cannot release it. Key decisions are attested with a rationale and a content hash.
- **Evidence.** Uploads of up to 50 MB to R2 with SHA-256 and an acceptance disposition; evidence requests answered by client contributors in packages of 1 to 10 files up to 10 MB in total.
- **Regulatory content.** Rule pack 2026.11.2 with per-provision dates and the 2 Dec 2026 milestones, classification v2 (tri-state facts, Art 5 practices, GPAI roles, Art 50 triggers) and Art 50 working papers.
- **Frameworks as data.** Criteria packs with typed crosswalks and coverage views: the EU AI Act pack, an EN 18286 + ISO/IEC 42001 management-system pack (draft), the NYC LL144 bias-audit pack and NIST AI RMF / AI 600-1 crosswalks.
- **Testing.** Hosted diagnostics in the Worker (up to 10,000 rows, 200 columns and 50 groups) and an external Python worker for larger jobs, with statistics in which confidence intervals and exact tests decide outcomes. Special-category data needs a recorded legal basis, or runs client-local so the platform never receives it. GenAI evaluation evidence (Inspect, lm-eval-harness, promptfoo, garak, PyRIT exports) is ingested and recomputed, never executed.
- **Reporting.** Report model v2 with engagement type, assurance level and ISAE 3000 conclusion types; fixed snapshots, approval, release, supersession and withdrawal; an Engagement Quality Reviewer sign-off; Ed25519-signed dossiers that verify offline.

## Architecture

A React 19 single-page app and its API run in one Cloudflare Worker (Vinext), with D1 for records and R2 for evidence and immutable blobs. Sign-in uses built-in accounts (email and password, with the first account as the owner), or optionally Cloudflare Access, through an adapter that denies by default. The Python engine in `engine/` runs diagnostics, statistics and GenAI ingestion as an external worker and as offline tools. The [codebase map](docs/engineering/codebase-map.md) describes the components, data flow, storage and module layout; [docs/security/identity.md](docs/security/identity.md) and [docs/security/signing-keys.md](docs/security/signing-keys.md) cover identity and signing.

| Folder | Contents |
|---|---|
| `site-app/` | The workspace: Worker, API, UI, D1 migrations, harnesses and the e2e suite ([site-app/README.md](site-app/README.md)) |
| `engine/` | Python diagnostics, statistics, external worker, GenAI ingestion and assurance CLIs ([engine/README.md](engine/README.md)) |
| `schemas/` | JSON Schema contracts for runs, procedures, working papers, dataset cards, criteria packs and GenAI evidence, with validators |
| `templates/` | The methodology: 36 working papers and 12 memos in `templates/catalog.json`, the Annex IV map and the criteria packs in `templates/criteria/` ([templates/README.md](templates/README.md)) |
| `docs/` | Product direction and decisions, designs, research, security notes, the capability matrix and the codebase map |
| `db/postgres.sql` | A superseded v0 PostgreSQL design, kept for reference only (decision D-13) |

## Quick start

Run your own copy with one command. Then open <http://localhost:8787>: the first visit asks you to create the **owner account**, and the owner invites everyone else from **Members & access** by sending each person a sign-up link. There is no external sign-in service to set up.

> **The self-hosted runtime is a preview.** It starts the app with `wrangler dev --local`, which is Cloudflare's local development runtime, not a production-hardened server (see the last lines of [`site-app/scripts/self-host.mjs`](site-app/scripts/self-host.mjs)). Use it to evaluate the platform, or for a small team whose members you trust, and put it behind HTTPS as soon as anyone reaches it over a network. It has not been hardened as a production service, and this repository records no load test of it.
>
> **No independent security assessment has been done.** This reference implementation has not had an independent security assessment. Do a security review of your own before you deploy it with real audit evidence. [SECURITY.md](SECURITY.md) says how to report a vulnerability and links the hardening notes.

**With Docker**, building the image on your machine (run this in the repository root):

```bash
docker compose up -d
```

**With Docker, without building.** `docker-compose.pull.yml` downloads ("pulls") the ready-made image `ghcr.io/ahed-jneed/ai-assurance` from the GitHub container registry instead of building it:

```bash
docker compose -f docker-compose.pull.yml up -d
```

By default this runs the tag `latest`, the newest published build. Every build of `main` is published as `latest` after it passes a start-up test; a release is also published under its version, so `v0.1.0`, the first public preview, gets the tags `v0.1.0`, `0.1.0` and `0.1`. To stay on one release, which is the safer choice for a real installation, set `AI_ASSURANCE_VERSION`, for example `AI_ASSURANCE_VERSION=0.1.0 docker compose -f docker-compose.pull.yml up -d`. A version tag exists only once that release is published; the header of [`docker-compose.pull.yml`](docker-compose.pull.yml) explains the details.

With either compose file, the data (database, evidence and the generated secret) lives in a Docker volume, a disk area that Docker manages and that outlives the container. The compose files call it `ai-assurance-data`, and Docker Compose puts the project name, which is the name of the directory, in front: in a directory called `ai-assurance` the volume is `ai-assurance_ai-assurance-data`. Both compose files, used from the same directory, share that volume. The [backup guide](docs/self-hosting/backup-restore.md#the-name-of-the-docker-volume) explains this.

**With Node.js** (22.13 or later):

```bash
cd site-app
npm ci
npm run self-host
```

The data lives in `site-app/data/`. Back it up together with `data/secrets.env`, which holds the key that signs reports and sign-up links; the [backup and restore guide](docs/self-hosting/backup-restore.md) has the commands. `PORT`, `HOST` and `DATA_DIR` change where it listens and stores data, for example `PORT=3000 npm run self-host`; the [configuration reference](docs/self-hosting/configuration.md) lists every setting.

**Self-hosting guides:**

- [HTTPS with Caddy](docs/self-hosting/https-caddy.md): serve the app over HTTPS, with a ready-made compose overlay (a second compose file that adds to the first).
- [Back up and restore](docs/self-hosting/backup-restore.md): what to copy, how to get it back, and what happens if `secrets.env` is lost.
- [Upgrading](docs/self-hosting/upgrading.md): move to a newer version without losing data. Back up first.
- [Configuration reference](docs/self-hosting/configuration.md): every setting, its default, and how to set it under Docker and under Node.js. [`.env.example`](.env.example) is the matching example file.

**Forgot a password?** Run `npm run self-host -- reset-password <email>` (in Docker: `docker compose exec ai-assurance node scripts/self-host.mjs reset-password <email>`). It prints a temporary password.

**Reaching it from other machines.** Put it behind a reverse proxy that serves HTTPS (a server that sits in front of the app and passes requests on to it) and forwards `X-Forwarded-Proto`, so the session cookie is marked `Secure`. The [HTTPS with Caddy guide](docs/self-hosting/https-caddy.md) shows one tested way, with `docker-compose.caddy.yml` and a `Caddyfile` that you do not need to edit; nginx or another proxy works on the same principle. The Docker image listens on all interfaces; `npm run self-host` listens on `127.0.0.1` unless you set `HOST=0.0.0.0`.

To deploy to Cloudflare Workers behind Cloudflare Access instead, see [docs/security/identity.md](docs/security/identity.md#configure-cloudflare-access).

## Development

Node >=22.13.0 (CI uses Node 22) and Python 3.12, the engine's one supported version (see `engine/README.md`, section Packaging). The development server signs you in as a test persona instead of an account.

```bash
cd site-app
npm ci
npm run build             # writes dist/server/wrangler.json, which the migration reads
npm run db:migrate:local  # creates the local D1 tables; required before dev and seed:demo
npm run dev
# in another terminal, while the dev server runs: the persona demo practice
npm run seed:demo
```

The migration step is not optional. Without it the dev server still starts and its pages still load, but the local D1 database (`site-app/.wrangler/state`) has no tables: every API request answers 500 and the dev log shows `D1_ERROR: no such table: ...`, the workspace shows a request error instead of data, and `npm run seed:demo` stops with `GET /api/workspace answered 500`. To recover, stop the dev server, run `npm run db:migrate:local`, start it again and rerun `npm run seed:demo`.

On Windows, keep the checkout path short (`site-app\` under about 120 characters): workerd stores the local database about 125 characters below `site-app\` and cannot open a path past the 260-character limit, so in a deeper checkout `npm run db:migrate:local` fails with `SQLITE_CANTOPEN`.

Then open the URL the dev server prints (port 5173 by default) and sign in with the loopback simulation, `/auth/sign-in?return_to=/`. To pick another port, pass it after `--` and give the seed the same URL; the commands are the same in PowerShell and in a macOS or Linux shell:

```sh
npm run dev -- --port 5180 --strictPort
# in another terminal
npm run seed:demo -- http://127.0.0.1:5180
```

`--strictPort` makes the dev server stop with an error when the port is taken instead of moving to the next free one. `npm start` (the built Worker, below) listens on port 8787; pass `npm start -- --port <port>` for another. To work as a persona, run `npm run seed:demo` first and sign in with `/auth/sign-in?as=<persona>&return_to=/`:

| Persona | Role in the demo practice |
|---|---|
| `qa-lead` | Lead Auditor and practice admin |
| `qa-auditor` | Auditor |
| `qa-reviewer` | Reviewer |
| `qa-lead2` | A second Lead Auditor, who also leads a practice of their own |
| `qa-eqr` | Engagement Quality Reviewer |
| `qa-contrib` | Client Contributor for the client Acme |
| `qa-viewer` | Client Viewer for Acme |
| `qa-outsider` | No membership (isolation checks) |

The seed creates the client Acme, a structured engagement, every persona's membership and grant, and an evidence request for `qa-contrib`; it is safe to run again. The account menu switches persona and signs out. `npm run db:migrate:local` applies only the migrations not yet applied, so it is safe to run again after pulling. The personas exist only on the development server; every build signs people in with the built-in accounts, or with the identity source `IDENTITY_MODE` names ([docs/security/identity.md](docs/security/identity.md)). The build uses the `DB` and `BUCKET` bindings. [site-app/README.md](site-app/README.md) has the details, including `npm start` for the built Worker.

## Checks

CI (`.github/workflows/ci.yml`) runs its jobs on every pull request and on pushes to `main`. In `site-app/`, `npm run check` runs the same steps as the `web` job, in order:

| Command | What it does |
|---|---|
| `npm run format:check` | Verify Prettier formatting (`npm run format` applies it) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint; any warning fails |
| `npm test` | Vitest unit tests (`*.test.ts` under `lib/`, `app/`, `build/`, `hooks/`, `components/`, `e2e/` and `scripts/`, plus `app/**/*.test.tsx`, as listed in `vitest.config.ts`); `*.local-calendar.test.ts` files run in a project of their own with `TZ=Europe/Vienna` |
| `npm run check:sync` | Generated files match their canonical sources (see below) |
| `npm run check:build` | Production Worker build (`npm run build`), failing if the output reports any warning |
| `npm run check:harnesses` | Every `scripts/*-check.mjs` harness against the built Worker in Miniflare; needs a build first. A harness never loads TypeScript sources or rewrites import paths: a check of a pure module is a Vitest test |
| `npm run check:fixtures` | Validate the run, external-run and procedure records the harnesses just produced against `schemas/` |

The harnesses run from any working directory (`scripts/harness/env.mjs` moves them to `site-app/`). On Windows they also need a short temp directory: Miniflare keeps each test database as an SQLite file about 150 characters below the temp directory, and workerd fails with `SQLITE_CANTOPEN` (or does not start) past the 260-character path limit. When `TEMP` is longer than 100 characters, `scripts/harness/env.mjs` switches the harnesses and their child processes to `%LOCALAPPDATA%\Temp\aa-harness` (else `%SystemDrive%\aa-harness-tmp`) and says so; set `ASSURANCE_HARNESS_TEMP` to choose another short directory. If none is writable, the harness stops with a message naming the fix. The ones that start Python use `ASSURANCE_TEST_PYTHON`, then `PYTHON`, then `python` on Windows and `python3` elsewhere, with `engine/requirements-dev.txt` installed. `check:sync` also runs Python (`PYTHON`, same default). The API harnesses (`workspace-access`, `criteria-pins`, `work-inbox-api`, `practice-management` and `engagement-lifecycle`, which share `scripts/harness/worker.mjs`, and the access, identity and assurance harnesses) provision an ephemeral local Miniflare database/object store and inject fictional fixture identity headers directly into the local Worker only, after opting in to the loopback-only `trusted-headers` identity mode; they do not exercise Cloudflare Access, and `scripts/harness/worker.mjs` refuses non-loopback URLs. `identity-check.mjs` checks that every other mode refuses forged identity headers, verifies Cloudflare Access tokens against a stub key set, and checks that builds contain no development personas.

The `e2e` job builds the Worker and runs `npm run test:e2e`, the Playwright persona suite with axe accessibility checks (`site-app/e2e/README.md`); run it locally after `npm run build` and, once, `npx playwright install chromium`. Do not run `npm run build` or `npm run check` in the same checkout while the e2e server runs: the build rewrites `dist/` under it (see the e2e README).

The `engine` job runs the commands below from the repository root on Python 3.12, the engine's one supported version. The validators load Ajv from `site-app/node_modules`, so run `npm ci` in `site-app/` first. Locally, create a Python 3.12 virtual environment outside the checkout and put it first on `PATH` for the current shell, so that `python` below is that interpreter. On macOS or Linux:

```sh
python3.12 -m venv ../engine-venv
source ../engine-venv/bin/activate
```

On Windows, in PowerShell (`py` is the Python launcher that the python.org installer adds; this changes `PATH` for the current window only and needs no change to the script execution policy):

```powershell
py -3.12 -m venv ..\engine-venv
$env:PATH = (Resolve-Path ..\engine-venv\Scripts).Path + ";" + $env:PATH
```

Then, on every platform:

```sh
python -m pip install -r engine/requirements-dev.txt
python -m unittest discover -s engine/tests -v
node schemas/validate-rule-pack.mjs
node schemas/validate-art50-research.mjs
node schemas/validate-criteria.mjs
node schemas/validate-run-schema.mjs
node schemas/validate-procedure-schema.mjs
node schemas/validate-working-paper-schema.mjs
node schemas/validate-dataset-card-schema.mjs
node schemas/validate-genai-schema.mjs
python schemas/generate-external-fixtures.py --output tmp/external-runs.v1.5.json
node schemas/validate-run-schema.mjs --external-fixtures-1.5 tmp/external-runs.v1.5.json
```

The last two recompute the external-run fixtures with the current engine (run contract 1.5) and validate them; `tmp/` is ignored by Git. CI also sets `GENAI_REQUIRE_ZSTD=1` and `ENGINE_REQUIRE_CRYPTOGRAPHY=1` for the unit tests, so the Inspect `.eval` and Ed25519 signature tests fail instead of skipping, passes `--base <commit>` to `validate-criteria.mjs` to check the criteria index history against the base branch, and builds the compute image from `engine/Dockerfile`.

## Canonical sources and generated copies

The root `docs/`, `engine/`, `schemas/` and `templates/` folders are canonical. These committed files are generated from them; edit the source, then run `npm run sync` in `site-app/` and commit both. CI fails when a copy drifts.

| Generated file | Source |
|---|---|
| `site-app/lib/catalog.json`, `site-app/lib/annex-iv-map.json` | `templates/` (byte copies) |
| `site-app/lib/obligation-subitems.json` | `docs/obligation-subitems.json` |
| `docs/obligation-subitems.json`, `templates/annex-iv-map.json` | the default criteria pack in `templates/criteria/` (its AI Act framework's obligation subitems and its Annex IV map) |
| `site-app/lib/criteria/bundle.generated.json` | `templates/criteria/` |
| `site-app/public/tools/assurance-verifier.py` | `engine/assurance.py` |
| `site-app/public/tools/assurance-runtime.zip` | `engine/` (without `engine/tests/`) and `schemas/`, via `python -m engine.package_runtime` (see `engine/RUNTIME_PACKAGE.md`) |
| `schemas/test-run.schema.json` | `schemas/test-run.base.json` (hand-maintained legacy run body and shared definitions), `schemas/.build-run-schema.py` and `.extend-assurance-schema.py` |

The working-paper contract is `schemas/working-paper.schema.json`; `templates/working-paper.blank.json` is its draft specimen.

Run the diagnostics CLI with `python -m engine --data engine/examples/predictions.csv --reference engine/examples/reference.csv --config engine/examples/config.json --output new-report.json`; it refuses to overwrite an existing output.

`site-app/package-lock.json` is maintained with npm 11. Change dependencies with `npx npm@11 install …`: npm 10 (bundled with Node 22) rewrites unrelated lockfile entries.

Formatting-only commits are listed in `.git-blame-ignore-revs`. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone so `git blame` skips them; GitHub's blame view does this automatically.

## Current legal snapshot

> Pending qualified legal review. This is not legal advice, and it may be out of date.

Legal text: the consolidated version `02024R1689-20260727` of Regulation (EU) 2024/1689, in force since 27 July 2026 and the latest consolidation at the research date (5 November 2026; not re-checked in the 14 November refresh). Rule pack: revision `2026.11.2` (2026.11.1 plus the Art 50 research edits), researched 5 November 2026 and pending qualified legal review. Chapter III Sections 1–3, except Article 6(5), apply from 2 December 2027 for Article 6(2)/Annex III systems and 2 August 2028 for Article 6(1)/Annex I systems, subject to actor/provision/sector/transitional analysis; under Article 111(2) as replaced, a system already on the market before its route's date is covered only after a significant design change, and legacy systems used by public authorities must comply by 2 August 2030. From 2 December 2026 the new Article 5(1)(ba) and (bb) prohibitions apply, and providers of generative systems placed on the market before 2 August 2026 must comply with Article 50(2) (Article 111(4)). Transparency can overlap with high-risk duties. EN 18286:2026 is the only harmonised AI Act standard cited in the Official Journal (Implementing Decision (EU) 2026/2274, OJ L 14.10.2026); ISO/IEC 42001 gives no presumption of conformity. Article 4a and data-protection requirements must be reviewed before sensitive-category bias processing; a selected upload label is not authorization.

Sources and detailed applicability: `docs/audit-methodology.md` and the rule pack (`regulatorySnapshot` in `templates/catalog.json`). The authentic amendment is [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744) (ELI `http://data.europa.eu/eli/reg/2026/1744/oj`).

## Status

At 20 Nov 2026 the project is preparing its first public preview, **v0.1.0**. The [v0.1 release checklist](https://github.com/ahed-jneed/ai-assurance/issues/262) tracks what is left, and the [v0.1 Public preview milestone](https://github.com/ahed-jneed/ai-assurance/milestone/5) holds its issues.

- **The November 2026 roadmap cycle is finished.** Milestones M0 to M3 are closed on GitHub, and every issue in them is closed. That includes the seven issues that were still open at the 14 Nov 2026 refresh: the dead-code sweep ([#37](https://github.com/ahed-jneed/ai-assurance/issues/37)), the five fixes from the release-candidate verification ([#199](https://github.com/ahed-jneed/ai-assurance/issues/199), [#201](https://github.com/ahed-jneed/ai-assurance/issues/201) to [#204](https://github.com/ahed-jneed/ai-assurance/issues/204)) and the documentation refresh ([#38](https://github.com/ahed-jneed/ai-assurance/issues/38)). Their pull requests reached `main` on 15 Nov 2026. See [ROADMAP.md](ROADMAP.md) for the outcome, the Later list, the watch list and the owner actions, and [CHANGELOG.md](CHANGELOG.md) for each merged PR.
- **Self-hosting is a preview.** `docker compose up -d` and `npm run self-host` start the app with `wrangler dev --local`, Cloudflare's local development runtime, not a production-hardened server. See the note in the [Quick start](#quick-start) and the guides listed there.
- **No independent security assessment.** This reference implementation has not had an independent security assessment. Do a security review of your own before you deploy it with real audit evidence ([SECURITY.md](SECURITY.md)).
- **Pending expert review** ([#261](https://github.com/ahed-jneed/ai-assurance/issues/261)): qualified legal review of the rule pack, Art 50 and LL144 content (shown as pending review); licensed copies of EN 18286 and ISO/IEC 42001 and counsel's sign-off before pack #2 leaves draft; and a practitioner review of the ISAE 3000 wording. **Pending owner actions** for a Cloudflare Workers deployment: deploy settings such as the `DOSSIER_KEK` secret (a self-hosted install creates this secret itself on first start).
- **GitHub CI** did not run from 14 to 18 Nov 2026, for a hosting-account reason that had nothing to do with the code. Changes merged in that window were checked locally with the commands above; CI has run on every pull request and on `main` again since 18 Nov 2026.
- **Not built:** upload malware scanning, retention and region controls, RFC 3161 timestamps, qualified signatures and WORM storage, per-practice SSO, MFA and SCIM through the host, native model runtimes in the default worker image, SHAP or LIME explanations, adversarial evaluations and inference-log connectors. These and the other deferred items are on the [Later list](ROADMAP.md#later).
- **Production limits:** an engagement's metadata is capped at 1.5 MB, and hosted diagnostics accept at most 10,000 rows; larger datasets go to the external worker. Before processing real audit evidence, an operator still needs the deploy actions, infrastructure observability, recovery exercises and an independent security assessment.
- **Next:** [v0.2 Contributor-ready](https://github.com/ahed-jneed/ai-assurance/milestone/6) collects maintenance work that is open to contributors, and [Regulatory content review](https://github.com/ahed-jneed/ai-assurance/milestone/7) holds the expert review ([#261](https://github.com/ahed-jneed/ai-assurance/issues/261)).

## Documentation

| Document | Covers |
|---|---|
| [docs/capabilities.md](docs/capabilities.md) | What `main` does, with code and tests per capability |
| [ROADMAP.md](ROADMAP.md), [CHANGELOG.md](CHANGELOG.md) | The November 2026 cycle's outcome, deferred work, watch list and owner actions; merged PRs |
| [docs/product/direction.md](docs/product/direction.md), [docs/product/decisions.md](docs/product/decisions.md) | Who we serve and why; the decision log (D-01 to D-50) |
| [docs/engineering/codebase-map.md](docs/engineering/codebase-map.md) | Components, data flow, storage, identity, module layout and file ownership |
| [docs/audit-methodology.md](docs/audit-methodology.md) | The audit methodology and the regulatory snapshot |
| [docs/design/](docs/design/) | Statistics, criteria-model and GenAI-evidence designs |
| [docs/research/](docs/research/) | Verified research behind the rule pack, Art 50 and LL144, and the November 2026 research record |
| [docs/self-hosting/https-caddy.md](docs/self-hosting/https-caddy.md) | Self-hosting: HTTPS through Caddy, with a compose overlay |
| [docs/self-hosting/backup-restore.md](docs/self-hosting/backup-restore.md) | Self-hosting: back up and restore, and what happens if `secrets.env` is lost |
| [docs/self-hosting/upgrading.md](docs/self-hosting/upgrading.md) | Self-hosting: upgrade to a newer version, and go back if an upgrade fails |
| [docs/self-hosting/configuration.md](docs/self-hosting/configuration.md) | Self-hosting: every setting with its default, and [`.env.example`](.env.example) |
| [docs/security/](docs/security/) | Identity modes and dossier signing keys |
| [site-app/e2e/README.md](site-app/e2e/README.md) | The Playwright persona suite |
| [engine/README.md](engine/README.md) and the other `engine/*.md` files | The engine, worker, runtime package, GenAI ingestion and assurance CLIs |

The dated documents in `docs/` from October 2026 (architecture, increments, UX updates, validation record) and `db/postgres.sql` describe earlier designs and are marked superseded; design and research documents cite file paths as they were when written ([docs/capabilities.md](docs/capabilities.md#older-documents-and-historical-paths) maps them to the current layout).

## Contributing, security and licence

- [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and conventions.
- [SECURITY.md](SECURITY.md) explains how to report a vulnerability privately.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Licensed under the [Apache License 2.0](LICENSE). Third-party material is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
