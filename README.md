# AI Assurance & Audit Platform

Implemented reference platform and enterprise architecture, delivered 5 October 2026.

The private workspace provides actual persistence, evidence uploads, permission checks, working-paper revisions, independent review, findings, diagnostic execution and fixed report snapshots. The normalized production architecture and acceptance roadmap are separate from the deployed reference implementation. Do not describe this repository as a certified or fully hardened enterprise compliance service.

## Deliverables

| Deliverable | File |
|---|---|
| Components, data boundaries, diagrams, stack and operational design | `docs/system-architecture.md` |
| Core relational schema; 43 tenant-scoped tables with FORCE RLS | `db/postgres.sql` |
| Standard workspace, procedures, lifecycle and regulatory mapping | `docs/audit-methodology.md` |
| 33 working papers, 12 memos and reusable narrative/JSON templates | `templates/catalog.json`, `templates/README.md` |
| Annex IV nine-section evidence compiler map | `templates/annex-iv-map.json` |
| Common working-paper / diagnostic contracts | `schemas/*.schema.json` |
| CSV metrics, read-only SQL extraction, optional model/data adapters | `engine/README.md` |
| Ingestion → queue → worker → paper → immutable report pipeline | `engine/ASYNC_INTEGRATION.md` |
| What is implemented and production acceptance requirements | `docs/implementation-roadmap.md` |
| Verified checks and their limits | `docs/validation-results.md` |

## Workspace

The [workspace redesign](docs/ui-design.md) introduces Notion-inspired database views, document editing, a light sidebar, contextual creation, and Settings & members. Search and filters survive return navigation; unsaved papers are protected. The earlier [usability update](docs/usability-update.md) documents the underlying client and access-management changes.

Source: `site-app/`. Stack: React, TypeScript, Vinext, Cloudflare Worker, D1 and R2. Enterprise target architecture uses PostgreSQL, an OIDC control plane and isolated Python jobs; that stack is specified rather than deployed.

The four server-authorized roles are Auditor, Lead Auditor, Reviewer and Client Viewer. Each authenticated principal has explicit practice membership; client viewers are client-scoped and receive released report projections rather than internal aggregates. Client and engagement selection never grants access. The private Sites audience remains owner-only until deliberately shared through Sites access controls.

Each engagement starts with the same 33-paper methodology. Two post-audit remediation/monitoring papers are supplementary until scoped into the program. Memos are instantiated from the 12-item memo library. Scope exclusions require a reasoned not-applicable conclusion and signed independent review before issue.

Papers retain historical body, evidence, run links, contributors and approvals. Editing/reopening invalidates current approval. A prior substantive preparer cannot independently review their paper. The lead signer must differ from the approving reviewer. The same person may prepare and lead-sign after another qualified independent reviewer approves.

Evidence up to 10 MB goes to R2 under engagement-scoped content-addressed keys, with SHA-256 and an acceptance disposition. Model binaries remain quarantined. Acceptance and evidence handling declarations are workflow records, not malware scans or legal authorization.

The interactive binary prediction suite accepts up to 1 MB / 10,000 rows / 50 groups. It computes performance, demographic parity, impact ratio and equalized odds, preserves configured internal thresholds and automatically creates linked draft papers. Jobs have durable execution states; the browser initiates execution. An interrupted run can be recovered after two minutes and resubmitted as a new request. Distributed workers and leases are a documented production integration.

Every report is a fixed snapshot. Final issuance requires signed required/excluded papers, independent classification approval, terminal jobs and Sign-off stage. Open high/critical findings block a positive readiness opinion; reviewed qualified/adverse/inability reports can disclose them. A separate hashed client projection excludes internal artifacts, detailed diagnostics and internal findings. Print layout and JSON export are implemented. Qualified signatures, external timestamping and WORM vaults are not yet integrated.

## Run locally

Node >=22.13.0 (CI uses Node 22) and Python 3.11. Install the web workspace from the lockfile with `npm ci` in `site-app/` (`npm run install:ci` remains available for the Sites tooling). Build the Worker with `npm run build`, apply the local D1 migrations with `npm run db:migrate:local` (idempotent; see `site-app/README.md`), then start `npm run dev` and use the loopback Sign in with ChatGPT simulation. To exercise several roles, run `npm run seed:demo` while the dev server is up and sign in as a test persona with `/signin-with-chatgpt?as=<persona>` (`qa-lead`, `qa-auditor`, `qa-reviewer`, `qa-lead2`, `qa-contrib`, `qa-viewer`, `qa-outsider`); the account menu switches persona and signs out. Hosting uses dispatch-owned identity, not the local mock. The Worker trusts only the identity source that `IDENTITY_MODE` names (Sites dispatch, Cloudflare Access, or the loopback test and dev modes) and answers 401 when none is configured; see [`docs/security/identity.md`](docs/security/identity.md). `site-app/.openai/hosting.json` is checkout-local and optional: without it, the build uses the `DB` and `BUCKET` bindings.

```powershell
cd site-app
npm ci
npm run build
npm run db:migrate:local
npm run dev
# in another terminal: the persona demo practice
npm run seed:demo
```

`npm run db:migrate:local` applies only the migrations not yet applied, so it is safe to run again after pulling. Hosting applies production migrations separately.

### Checks

CI (`.github/workflows/ci.yml`) runs its jobs on every pull request and on pushes to `main`. In `site-app/`, `npm run check` runs the same steps as the `web` job, in order:

| Command | What it does |
|---|---|
| `npm run format:check` | Verify Prettier formatting (`npm run format` applies it) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint; any warning fails |
| `npm test` | Vitest unit tests (`lib/**/*.test.ts`, `app/**/*.test.ts`) |
| `npm run check:sync` | Generated files match their canonical sources (see below) |
| `npm run check:build` | Production Worker build (`npm run build`), failing if the output reports any warning |
| `npm run check:harnesses` | Every `scripts/*-check.mjs` harness; needs a build first |
| `npm run check:fixtures` | Validate the run, external-run and procedure records the harnesses just produced against `schemas/` |

The assurance harness starts Python: set `ASSURANCE_TEST_PYTHON` to the interpreter to use, with `engine/requirements-dev.txt` installed. `check:sync` also runs Python (`PYTHON`, default `python` on Windows and `python3` elsewhere). The integration harnesses provision an ephemeral local Miniflare database/object store and inject fictional fixture identity headers directly into the local Worker only, after opting in to the loopback-only `trusted-headers` identity mode; they do not exercise Sites' real authentication dispatcher, and `integration-check.mjs` refuses non-loopback URLs. `identity-check.mjs` checks that every other mode refuses forged identity headers, verifies Cloudflare Access tokens against a stub key set, and checks that builds contain no development personas.

The `e2e` job builds the Worker and runs `npm run test:e2e`, the Playwright persona suite with axe accessibility checks (`site-app/e2e/README.md`); run it locally after `npm run build` and, once, `npx playwright install chromium`.

The `engine` job runs, from the repository root (the validators load Ajv from `site-app/node_modules`):

```powershell
python -m pip install -r engine/requirements-dev.txt
python -m unittest discover -s engine/tests -v
node schemas/validate-run-schema.mjs
node schemas/validate-procedure-schema.mjs
node schemas/validate-working-paper-schema.mjs
python schemas/generate-external-fixtures.py --output tmp/external-runs.v1.2.json
node schemas/validate-run-schema.mjs --external-fixtures tmp/external-runs.v1.2.json
```

### Canonical sources and generated copies

The root `docs/`, `engine/`, `schemas/` and `templates/` folders are canonical. These committed files are generated from them; edit the source, then run `npm run sync` in `site-app/` and commit both. CI fails when a copy drifts.

| Generated file | Source |
|---|---|
| `site-app/lib/catalog.json`, `site-app/lib/annex-iv-map.json` | `templates/` (byte copies) |
| `site-app/lib/obligation-subitems.json` | `docs/obligation-subitems.json` |
| `site-app/public/tools/assurance-verifier.py` | `engine/assurance.py` |
| `site-app/public/tools/assurance-runtime.zip` | `engine/` (without `engine/tests/`) and `schemas/`, via `python -m engine.package_runtime` (see `engine/RUNTIME_PACKAGE.md`) |
| `schemas/test-run.schema.json` | `schemas/test-run.base.json` (hand-maintained legacy run body and shared definitions), `schemas/.build-run-schema.py` and `.extend-assurance-schema.py` |

The working-paper contract is `schemas/working-paper.schema.json`; `templates/working-paper.blank.json` is its draft specimen.

Run the diagnostics CLI with `python -m engine --data engine/examples/predictions.csv --reference engine/examples/reference.csv --config engine/examples/config.json --output new-report.json`; it refuses to overwrite an existing output.

`site-app/package-lock.json` is maintained with npm 11. Change dependencies with `npx npm@11 install …`: npm 10 (bundled with Node 22) rewrites unrelated lockfile entries.

Formatting-only commits are listed in `.git-blame-ignore-revs`. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone so `git blame` skips them; GitHub's blame view does this automatically.

## Current legal snapshot

Legal text: the consolidated version `02024R1689-20260727` of Regulation (EU) 2024/1689, in force since 27 July 2026 and still the latest consolidation. Rule pack: revision `2026.11.2` (2026.11.1 plus the Art 50 research edits), researched 5 November 2026 and pending qualified legal review. Chapter III Sections 1–3, except Article 6(5), apply from 2 December 2027 for Article 6(2)/Annex III systems and 2 August 2028 for Article 6(1)/Annex I systems, subject to actor/provision/sector/transitional analysis; under Article 111(2) as replaced, a system already on the market before its route's date is covered only after a significant design change, and legacy systems used by public authorities must comply by 2 August 2030. From 2 December 2026 the new Article 5(1)(ba) and (bb) prohibitions apply, and providers of generative systems placed on the market before 2 August 2026 must comply with Article 50(2) (Article 111(4)). Transparency can overlap with high-risk duties. EN 18286:2026 is the only harmonised AI Act standard cited in the Official Journal (Implementing Decision (EU) 2026/2274, OJ L 14.10.2026); ISO/IEC 42001 gives no presumption of conformity. Article 4a and data-protection requirements must be reviewed before sensitive-category bias processing; a selected upload label is not authorization.

Sources and detailed applicability: `docs/audit-methodology.md` and the rule pack (`regulatorySnapshot` in `templates/catalog.json`). The authentic amendment is [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744) (ELI `http://data.europa.eu/eli/reg/2026/1744/oj`).

## Production limits

This reference uses bounded engagement aggregates with atomic version checks plus append-only history. It is not the normalized production store and limits each aggregate to 1.5 MB. Native model runtimes, SHAP/LIME, training reproduction/cross-validation, adversarial evaluations and operational inference-log connectors need additional integration and validation. The Python runner includes optional ONNX/PMML/native tree adapters, Parquet and trusted permutation/perturbation functions, but missing optional runtimes prevented golden-model tests.

Complete the production acceptance roadmap before processing enterprise audit evidence: IdP/MFA/SCIM, normalized RLS deployment, engagement-level membership, malware scanning, customer-controlled sensitive-data computation, external queue workers, region/retention controls, immutable vaults/signatures, infrastructure observability, recovery exercises and an independent security assessment.
