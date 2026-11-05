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

Node >=22.13.0 (CI uses Node 22) and Python 3.11. Install the web workspace from the lockfile with `npm ci` in `site-app/` (`npm run install:ci` remains available for the Sites tooling). Build the Worker with `npm run build`, apply the local D1 migrations in order (every file in `site-app/drizzle/`; see `site-app/README.md`), then start `npm run dev` and use the loopback Sign in with ChatGPT simulation. Hosting uses dispatch-owned identity, not the local mock. `site-app/.openai/hosting.json` is checkout-local and optional: without it, the build uses the `DB` and `BUCKET` bindings.

```powershell
cd site-app
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_sour_tana_nile.sql
# ...repeat for each later migration in drizzle/, in order
npm run dev
```

Apply each migration once; do not replay already-applied migrations. Hosting applies production migrations separately.

### Checks

CI (`.github/workflows/ci.yml`) runs two jobs on every pull request and on pushes to `main`. In `site-app/`, `npm run check` runs the same steps as the `web` job, in order:

| Command | What it does |
|---|---|
| `npm run format:check` | Verify Prettier formatting (`npm run format` applies it) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint; any warning fails |
| `npm test` | Vitest unit tests (`lib/**/*.test.ts`) |
| `npm run build` | Production Worker build; must stay warning-free |
| `npm run check:harnesses` | Every `scripts/*-check.mjs` harness; needs a build first |

The assurance harness starts Python: set `ASSURANCE_TEST_PYTHON` to the interpreter to use, with `engine/requirements-dev.txt` installed. The integration harnesses provision an ephemeral local Miniflare database/object store and inject fictional fixture identity headers directly into the local Worker only; they do not exercise Sites' real authentication dispatcher, and `integration-check.mjs` refuses non-loopback URLs.

The `engine` job runs, from the repository root (the validators load Ajv from `site-app/node_modules`):

```powershell
python -m pip install -r engine/requirements-dev.txt
python -m unittest discover -s engine/tests -v
node schemas/validate-run-schema.mjs
node schemas/validate-procedure-schema.mjs
```

Run the diagnostics CLI with `python -m engine --data engine/examples/predictions.csv --reference engine/examples/reference.csv --config engine/examples/config.json --output new-report.json`; it refuses to overwrite an existing output.

`site-app/package-lock.json` is maintained with npm 11. Change dependencies with `npx npm@11 install …`: npm 10 (bundled with Node 22) rewrites unrelated lockfile entries.

## Current legal snapshot

Rule-pack version: `02024R1689-20260727`, researched 5 October 2026. Chapter III Sections 1–3, except Article 6(5), apply from 2 December 2027 for Article 6(2)/Annex III systems and 2 August 2028 for Article 6(1)/Annex I systems, subject to actor/provision/sector/transitional analysis. Transparency can overlap with high-risk duties. Article 4a and data-protection requirements must be reviewed before sensitive-category bias processing; a selected upload label is not authorization.

Sources and detailed applicability: `docs/audit-methodology.md`. The authentic amendment is [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744).

## Production limits

This reference uses bounded engagement aggregates with atomic version checks plus append-only history. It is not the normalized production store and limits each aggregate to 1.5 MB. Native model runtimes, SHAP/LIME, training reproduction/cross-validation, adversarial evaluations and operational inference-log connectors need additional integration and validation. The Python runner includes optional ONNX/PMML/native tree adapters, Parquet and trusted permutation/perturbation functions, but missing optional runtimes prevented golden-model tests.

Complete the production acceptance roadmap before processing enterprise audit evidence: IdP/MFA/SCIM, normalized RLS deployment, engagement-level membership, malware scanning, customer-controlled sensitive-data computation, external queue workers, region/retention controls, immutable vaults/signatures, infrastructure observability, recovery exercises and an independent security assessment.
