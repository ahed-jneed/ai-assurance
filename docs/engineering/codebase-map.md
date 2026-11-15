# Codebase map

> **Snapshot of `main` at commit `74c6463`, 5 November 2026.** These are sections 1, 2 and 7 of the verified codebase review that the [roadmap](../../ROADMAP.md) was planned from, renumbered 1 to 3. The review combined six subsystem reports (API, persistence and authorization; domain and workflow; UI; tooling and tests; Python engine; docs and methodology) with read-only spot checks of `main`. The research behind the roadmap is in [docs/research/2026-11/](../research/2026-11/README.md).
>
> - **Line numbers refer to commit `74c6463`, before the Prettier reformat** (commit `ef0286f`, merged with [PR #2](https://github.com/ahed-jneed/ai-assurance/pull/2) for [#1](https://github.com/ahed-jneed/ai-assurance/issues/1)). At `74c6463` most `site-app` files were dense single-line code. The reformat moved every `site-app` line number, so find code by the quoted identifiers.
> - **Finding ids (F-xx)** come from the review's findings table, which is not reproduced here. Most roadmap issues quote the ids they fix, and [ROADMAP.md](../../ROADMAP.md) names the findings placed in issues on 5 November 2026 and those deferred to Later.
> - **Counts, sizes and limits** (85 KB files, 17 tables, a 1.5 MB engagement body and so on) describe `74c6463` and will drift. The rules in section 3 are the review's recommendations for parallel work; where an issue says otherwise, the issue wins.
> - **Edits to the review's text.** Apart from the renumbering, twelve lines differ from the review. Nine pointed to review sections not reproduced here (3, 5 and 6.5) or to its Wave 0 and Wave 1 plan; they now point to the README, to the note above, or to the issue or PR that does the work. Three gained issue references: the `hosting.json` setup step, and the `lib/domain.ts` and `lib/workflow-service.ts` rows of section 3.2. The `---` rules between the review's sections were dropped.
> - **Kept current since.** Later PRs updated the descriptions of behaviour they changed (identity, roles, permissions, storage, flows). On 14 Nov 2026 ([#38](https://github.com/ahed-jneed/ai-assurance/issues/38)) the module paths were brought up to the layout after the barrel deletions of [#70](https://github.com/ahed-jneed/ai-assurance/issues/70) and [#37](https://github.com/ahed-jneed/ai-assurance/issues/37) and the screen splits of [#64](https://github.com/ahed-jneed/ai-assurance/issues/64); section 0 below lists that layout. Sizes and counts quoted "at `74c6463`" remain historical, and the hot-file rules of section 3.2 record how the parallel work was organised. Also on 14 Nov 2026 ([#212](https://github.com/ahed-jneed/ai-assurance/issues/212)), every statement of section 2 was checked against the release candidate; its note says which PRs that covers.

## 0. Module layout on `main` (14 Nov 2026)

Paths are relative to `site-app/`. The [capability matrix](../capabilities.md) maps each capability to its modules and tests.

| Area | Modules |
|---|---|
| Worker entry and identity | `build/sites-worker.ts` (Worker entry, wraps requests in the Sites connector binding), `build/sites-vite-plugin.ts` (dev sign-in), `lib/identity.ts` (identity modes), `lib/cloudflare-access.ts`, `lib/auth-paths.ts` |
| HTTP, tenancy and persistence | `lib/http.ts` (`readBounded`, `checkOrigin`, errors), `lib/tenancy.ts` (`context`, `requireRole`, `requireAdmin`, provisioning, sign-in recording), `lib/engagement-repo.ts` (`getEngagement`, `save`), `lib/engagement-storage.ts` (R2 blobs), `lib/factories.ts`, `lib/ids.ts` (`id`, `now`, `sha256`), `lib/bindings.ts` (`db`, `bucket`). The `lib/store.ts` barrel is gone ([#70]) |
| Routes | `app/api/*/route.ts`: `workspace`, `assurance`, `management`, `evidence`, `client-submission`, `report-package`, `dossier` (and `dossier/keys`), `coverage`, `audit-trail`, `access-log`, `ll144-summary`, `work-inbox`, `workspace-state`, `evaluation/dataset`, `operator`, `runner` |
| Commands (every POST op) | `lib/commands/*.ts` (`/api/workspace`), `lib/commands/assurance/**` (`/api/assurance`), `lib/commands/management/**` (`/api/management`); each a `defineCommands({ op: { roles, handle } })` handler, with dispatcher tests that pin the op sets and roles |
| Read models (GET) | `lib/read-models/**`: workspace, assurance, coverage, GenAI, LL144 summary, audit trail, Access log |
| Domain | `lib/domain/` (`types.ts`, `classification.ts`, `risk.ts`, `gates.ts`, `report-model.ts`, `report-gates.ts`, `quality-review.ts`, `management-system.ts`, `art50-papers.ts`, `release-time.ts`). The `lib/domain.ts` barrel is gone ([#37]); import from the owning module |
| Workflow | `lib/workflow/` (`brief-program.ts`, `procedures.ts`, `acceptance.ts`, `client-grants.ts`, `finding-assurance.ts`, `monitoring.ts`, `report-release.ts`, `command.ts`), with `lib/workflow/dispatch.ts` (`workflowOps`, `workflowCommand`), which replaced `lib/workflow-service.ts` ([#37]); `lib/workflow-state.ts`, `lib/workflow-types.ts`, `lib/workflow-seed.ts` |
| Other domain modules | `lib/evidence-requests.ts`, `lib/{paper,finding,auditor}-workflow.ts`, `lib/papers/`, `lib/work-items.ts`, `lib/work-inbox.ts`, `lib/client-projection.ts`, `lib/report-package.ts`, `lib/permissions.ts`, `lib/attestation.ts` |
| Evaluation and statistics | `lib/diagnostics.ts`, `lib/evaluation.ts`, `lib/evaluation-service.ts`, `lib/statistics.ts`, `lib/hosted-statistics.ts`, `lib/dataset-card.ts`, `lib/special-category.ts`, `lib/ll144.ts` |
| Criteria and GenAI | `lib/criteria/`, `lib/genai/` |
| Assurance and signing | `lib/assurance-{core,packet,store,store-client,query,search}.ts`, `lib/dossier.ts`, `lib/dossier-scope.ts`, `lib/signing-keys.ts` |
| Workspace UI | `app/workspace/` (shell, hooks, `modals/`, `views/`, navigation guards); the split screens `app/audit-program/`, `app/assurance-workbench/` and `app/testing-lab/` ([#64]: [#186], [#187], [#188], [#193]), whose former files `app/audit-program.tsx`, `app/assurance-workbench.tsx` and `app/testing-lab.tsx` are now entries that re-export them |
| Storage | `db/schema.ts` (Drizzle declaration of every D1 table), `drizzle/0000`–`0017` |

[#37]: https://github.com/ahed-jneed/ai-assurance/issues/37
[#64]: https://github.com/ahed-jneed/ai-assurance/issues/64
[#70]: https://github.com/ahed-jneed/ai-assurance/issues/70
[#186]: https://github.com/ahed-jneed/ai-assurance/issues/186
[#187]: https://github.com/ahed-jneed/ai-assurance/issues/187
[#188]: https://github.com/ahed-jneed/ai-assurance/issues/188
[#193]: https://github.com/ahed-jneed/ai-assurance/issues/193

## 1. Architecture map

### 1.1 Components

| Component | Where | Responsibility |
|---|---|---|
| Web UI | `site-app/app/`: the shell in `app/workspace/` (at `74c6463`, one 85 KB `app/workspace.tsx` and 39 client components) | React 19 single-page app rendered by Vinext (Vite 8, rolldown, RSC). Navigation is state-driven across 14 views and mirrored to the URL. Components fetch `/api/*` themselves. Built on shadcn/Radix (18 of 61 vendored components are used) and 11 global stylesheets |
| API | `site-app/app/api/*/route.ts`: 11 handlers | `workspace`: GET returns the aggregate view; POST is a command bus with about 26 inline ops plus the 32 `workflowCommand` ops and 6 `evidenceRequestCommand` ops it dispatches. Also `management`, `assurance` (22 ops), `evidence`, `client-submission`, `dossier`, `report-package`, `work-inbox`, `workspace-state`, `evaluation/dataset`, and `runner` (bearer token) |
| Tenancy, authorization and persistence core | `lib/tenancy.ts`, `lib/engagement-repo.ts`, `lib/http.ts`, `lib/client-projection.ts`, `lib/engagement-storage.ts` (at `74c6463`, all in `lib/store.ts`) | `context()` maps identity to tenant, role, client and practice-admin flag, and auto-provisions new users. `getEngagement()` authorizes and hydrates. `save()` runs the compare-and-swap batch. `sanitize()` builds the client projection. Also `readBounded`, `checkOrigin`, `responseError` |
| Audit domain | `lib/domain/`, `lib/workflow/` (dispatch in `lib/workflow/dispatch.ts`), `lib/workflow-{types,state,seed}.ts`, `lib/evidence-requests.ts`, `lib/{paper,finding,auditor}-workflow.ts`, `lib/work-items.ts`, `lib/work-inbox.ts`, `lib/client-projection.ts`, `lib/report-package.ts` | The engagement aggregate, lifecycle gates, brief/program/procedure workflow, independence rules, report approval and release, monitoring |
| Evaluation | `lib/diagnostics.ts`, `lib/evaluation.ts`, `lib/evaluation-service.ts`, `lib/dataset-card.ts`, `lib/testing-readiness.ts` | CSV diagnostics computed inside the Worker (binary, multiclass, regression, plus demographic parity, disparate impact and equalized odds); frozen run manifests |
| Assurance and signing | `lib/assurance-{core,packet,store}.ts`, `lib/dossier.ts`, `lib/signing-keys.ts` | Append-only assurance records, an external job queue with fenced leases, and Ed25519-signed dossiers and briefing packets with wrapped practice keys (`docs/security/signing-keys.md`) |
| Worker entry and build | `build/sites-worker.ts`, `build/sites-vite-plugin.ts`, `vite.config.ts`, `scripts/run-framework.mjs` | Worker fetch wrapper; dev-only mock sign-in; copies `hosting.json` and `drizzle/` into `dist/.openai` |
| Python engine | `engine/` | Stdlib-only diagnostics CLI, a pull worker for `/api/runner` (child process or Docker executor), assurance CLIs (sampling, bootstrap, dossier verify/sign), registry import, cited assistant, runtime packager. 120 unittest cases |
| Contracts | `schemas/` | Draft 2020-12 run contract (1.0 legacy, 1.1 hosted, 1.2 external), procedure-execution and working-paper schemas, and Ajv validators |
| Methodology | `templates/`, `docs/obligation-subitems.json` | 33 working papers and 12 memos, the Annex IV map, 68 obligation prompts. The obligation file and the Annex IV map are generated from the default criteria pack in `templates/criteria/` (#61). Byte-identical copies in `site-app/lib/` seed the app |
| Specification only | `db/postgres.sql`, `docs/system-architecture.md` | Target PostgreSQL/OIDC/KMS design. Not deployed |
| Copies | `site-app/reference/` (88 files, 5 diverged), `site-app/public/tools/` (runtime zip, plus a verifier identical to `engine/assurance.py`) | Duplicates with no sync check |

### 1.2 Diagram

The request path at `74c6463`, with module names updated to section 0. Since then the Worker entry resolves identity through `lib/identity.ts` and strips untrusted `oai-*` headers ([#11](https://github.com/ahed-jneed/ai-assurance/issues/11)), and more routes exist (section 0).

```
Browser: React 19 SPA (app/workspace/ shell + feature components)
   |  same-origin fetch /api/*  (JSON or multipart; every POST needs a matching Origin)
   v
Identity in front of the Worker
   prod : OpenAI Sites dispatch, "Sign in with ChatGPT" -> injects oai-authenticated-user-id / -email
   dev  : build/sites-vite-plugin.ts mock, loopback only, one user (local_seedy)
   start: nothing; the caller must send the headers itself (wrangler dev of dist/)
   |
   v
Cloudflare Worker: build/sites-worker.ts -> vinext fetch handler   (no header filtering)
   app/page.tsx (client shell)           app/report/page.tsx (server-rendered print view)
   app/api/ workspace  management  assurance  evidence  client-submission  dossier
            report-package  work-inbox  workspace-state  evaluation/dataset
   app/api/runner  <-- bearer token + HMAC, fenced 120 s leases -------------------+
   lib/tenancy.ts context() / engagement-repo.ts getEngagement(), save()           |
   lib/domain/  lib/workflow/  lib/commands/  evidence-requests.ts  diagnostics.ts |
   evaluation-service.ts  assurance-*.ts  dossier.ts  engagement-storage.ts        |
        |                                    |                                     |
        v                                    v                                     |
   D1 (SQLite): tables in db/schema.ts, R2: evidence bytes, content-addressed      |
   drizzle/0000-0017, append-only       report/paper/run blobs, sealed dossiers,   |
   triggers, engagement JSON bodies     runner results                             |
                                                                                   |
Python engine (operator host): engine/worker.py --- HTTPS pull --------------------+
   -> compute child process or digest-pinned Docker -> engine/diagnostics.py
Offline CLIs: python -m engine | engine.assurance verify/sign | registry_import | cited_assistant
Repo data: schemas/ (run, procedure, working-paper contracts)
           templates/ + docs/obligation-subitems.json -> copied into site-app/lib/*.json
```

### 1.3 Data flow

1. **Bootstrap.** `GET /` returns the client shell and loads no data on the server. `Workspace` then calls `GET /api/workspace?tenantId&engagementId`:
   - `context()` resolves the identity headers to a membership. A user with no membership gets a personal tenant.
   - The engagement list is filtered by calling `getEngagement()` on every row. Each call parses the D1 body and hydrates every R2 blob.
   - The selected engagement is hydrated a second time and passed through `sanitize()` for client roles.
   - The response contains identity, memberships, clients, engagements, the selected engagement, members and people, the last 30 audit and management events, and the methodology catalog.
2. **Commands.** `POST /api/workspace {tenantId, engagementId, expectedVersion, op, data}` goes through `checkOrigin`, then `readBounded` (2 MB), zod validation, `context`, `getEngagement` and a version check. A handler (inline, `workflowCommand` or `evidenceRequestCommand`) mutates the aggregate in memory. `save()` then:
   - runs one D1 batch: the guarded `UPDATE engagements` (checking version, membership, and access or grant), a full `engagement_snapshots` row, a hash-chained `audit_events` row, and any op-specific statements;
   - re-uploads the content-addressed blobs to R2 through `dehydrate()`.

   The UI then reloads the whole workspace. Management ops use the tenant version and write `management_events` instead.
3. **Evidence.**
   - Upload: multipart `POST /api/evidence` (up to 50 MB). The server computes SHA-256 and stores the file in R2 under a tenant/engagement-prefixed key. The artifact starts as awaiting acceptance.
   - Download: `GET` streams the file with an `X-Evidence-SHA256` header.
   - Client deliveries: client contributors use `/api/client-submission` (up to 10 files, 10 MB) under time-boxed grants stored in the engagement JSON.
4. **Diagnostics.**
   - Interactive runs (`queueRun`/`executeRun`): `lib/diagnostics.ts` runs inside the Worker on accepted CSV bytes and auto-drafts papers.
   - External runs (`queueExternal`): an `execution_jobs` request is frozen. The Python worker claims it, downloads the pinned inputs, computes, and completes with an HMAC. `importJob` compiles the result into a 1.2 run and a draft paper.
5. **Reporting.**
   - `createReport` freezes an internal snapshot and a client snapshot, both hashed and offloaded to R2.
   - `approveReportPackage` approves both hashes with the approver's MEM-SO-01 completion checklist answers; `releaseReport` releases the client projection, copies the checklist into `release.completion` and records the `notify_client` event, which the client sees as a notification on its overview.
   - `/api/report-package` re-verifies the digests.
   - `/api/dossier` seals an Ed25519-signed dossier per audience, which can be verified offline with `engine/assurance.py verify`; `/api/dossier/keys` lists the practice's active and retired verification keys, and a practice administrator rotates the key with the management op `rotateSigningKey`.

### 1.4 Storage

**D1** (`db/schema.ts` declares every table; migrations `drizzle/0000`–`0017`; at `74c6463` there were 17 tables and migrations `0000`–`0004`):

| Group | Tables |
|---|---|
| Tenancy and access | `tenants` (version, last_command_id; `eqr_cooling_off_days` since `drizzle/0011`), `memberships` (role, client_id, status; identity `email` since `drizzle/0013`), `invitations`, `clients`, `practice_admins`, `engagement_access`, `engagement_access_history` (every grant change with the holder's role, written by triggers, immutable; since `drizzle/0011`), `engagement_access_policies`, `sign_in_events` (members' recorded sign-ins for the Access log, append-only, kept 400 days; since `drizzle/0017`) |
| Engagement aggregate | `engagements` (JSON body up to 1.5 MB, version), `engagement_snapshots` (full body on every save), `audit_events` (hash-chained), `management_events` (not chained) |
| Assurance and execution | `assurance_records`, `execution_jobs`, `execution_attempts`, `runner_workers` (stores only the token's SHA-256), `dossier_keys` (private keys wrapped under the `DOSSIER_KEK` secret since `drizzle/0009`; retired keys keep only the public key) |
| Per user | `personal_preferences`, `workspace_drafts` |
| Platform operator | `operator_events` (immutable audit trail of practice deletions, `lib/operator.ts`), `practice_erasures` (a marker that exists only inside the deletion batch; the append-only delete triggers admit that practice's rows only while it exists); both since `drizzle/0013`; `tenants.archived_at` (a practice with issued work archived instead of deleted, kept archived and closed to new members by the triggers of `drizzle/0015`); `integrity_incidents.handling` (open, acknowledged or resolved by a practice administrator, `drizzle/0016`) |

**Invariants.** Append-only triggers protect `audit_events`, `engagement_snapshots`, `management_events`, `assurance_records`, and completed jobs and attempts. Unique indexes on `json_extract` expressions stop revision forks. All of these exist only in hand-written SQL (`0001`, `0003`).

**Hard limits that act as cliffs:**
- an engagement body is capped at 1.5 MB;
- 1,000 assurance records per engagement;
- 150 program revisions;
- 30 revisions per procedure.

**R2** holds evidence bytes; report snapshots, client snapshots, paper histories and run results (content-addressed and SHA-256-checked on every read); sealed dossiers; and runner results.

### 1.5 Identity and authorization

**Production.** OpenAI Sites dispatch injects `oai-authenticated-user-id`, `-email` and (optionally) `-full-name`. `app/chatgpt-auth.ts` trusts these headers without any signature, JWT or session check, and the Worker entry passes them through unchanged. `context()` (`lib/tenancy.ts`; `lib/store.ts` at `74c6463`) then works as follows:
1. Missing headers return 401.
2. Without an active membership it first accepts the pending invitations for the user's email (`lib/invitations.ts`). If the user has no membership at all and self-signup is allowed (`SELF_SIGNUP`, open only on the development server by default; see `docs/security/identity.md`), it creates `tenant-<sha256(userId)[:24]>`, named after the user ("<name> practice"), with the user as Lead Auditor plus an "Example client" and engagement `ENG-default`; otherwise it returns 403. If the user has only revoked memberships, it returns 403 "access revoked" instead.
3. It loads the active membership and records the identity email on it when it is missing or changed (#95).
4. It runs a legacy access-adoption write batch on every request.
5. It sets the `practiceAdmin` flag.

**Roles.** There are six: Auditor, Lead Auditor, Reviewer, Engagement Quality Reviewer (reads its engagements and records only the quality review, #24), Client Viewer, Client Contributor, plus the practice-admin flag.
- Internal roles need a per-engagement `engagement_access` row.
- Client roles are scoped by their membership's `client_id`. Contributors also need an unexpired grant inside the engagement JSON.

**Separation of duties**, enforced on the server:
- an author cannot review their own paper;
- the signer must differ from the reviewer;
- the classifier cannot approve the classification;
- whoever created a finding or wrote its remediation cannot close it;
- the report creator cannot approve the package, and the approver cannot release it;
- contributors to the brief or program cannot approve it.

**One permission map (#35).** `lib/permissions.ts` lists the roles every POST `/api/workspace` and `/api/assurance` op admits, plus route actions such as sealing a dossier. `can(role, action)`, `roleReason()` and `decisionState()` (role plus the separation-of-duties rules above) drive the workspace's buttons: a control is hidden from roles the server never admits and shown disabled, with the server's reason, to someone an independence rule bars. The server keeps its own guards (each `defineCommands` handler's `roles`, the workflow and evidence-request services' checks); the workspace route checks workflow roles from the map before a command validates its data, and `lib/permissions.test.ts` compares the map with every dispatcher's declared roles and probes the services' own checks. Management ops need the practice-admin flag (`manageState()`), and two of them a Lead Auditor. `decisionState()` also explains state-dependent narrowing (#178): once the scope or the acceptance record is approved, or the program submitted, an Auditor sees why a Lead Auditor must make the change instead of meeting a 403. The map also holds what the browser decides by role beside actions: `canSee(role, view)` for view visibility (the team scope of My work, the evidence requests tab and queue, the client portal), `isClientRole()`/`isInternalRole()`, `assignableRoles`/`canBeAssigned()` for the member pickers (matching the server's assignee checks), `duties()` for grouping work items and `canQueueAuditorModel()`. `lib/client-consumers.test.ts` scans the browser code in `app/`, `hooks/`, `components/` and the shared `lib/` modules for role names and fails on any outside the map, except the role pickers and role descriptions it allowlists by file (member management and onboarding, the client-portal grant form); server guards in `app/api/`, `lib/commands/`, `lib/workflow/`, `lib/read-models/` and the repository modules keep their own checks.

**Attested decisions (#35).** `signPaper`, `approveClassification`, `setStage`, `acceptEvidence` and `closeFinding` open the attestation dialog (`app/workspace/attestation-dialog.tsx`) instead of firing on one click. It shows the record, its revision, the change and a SHA-256 of the content the decision binds (`lib/attestation.ts`; for a paper, the hash its signature records; for evidence, the file's hash) and the statement the person makes, and requires a rationale. The command requires `data.attestation` (`rationale`, optional `revision` and `digest`, refused with 409 when stale), and its audit event records `{ statement, record, revision, digest, rationale }` next to the op's own details.

**Errors in the browser (#35).** `lib/fetch-json.ts` checks the status before parsing, so a non-JSON 413 or 502 reads as a message, and maps statuses to failure kinds. The workspace and `/api/assurance` consumers read and write through `fetchJson`/`postJson` (#178; `lib/client-consumers.test.ts` lists them and keeps raw `fetch` calls to `/api/assurance` out of browser code). A failed command reports once: in its form or dialog, or else in one toast whose action retries a transient failure or reloads after a conflict. The banner above the views is for load failures only, and its Retry retries the load. `app/error.tsx` and per-pane `ViewBoundary`s (view, paper editor, dialog, record sheet; `app/workspace/view-boundary.tsx`) replace a render exception with a "Reload view" notice instead of a blank page.

**Request hardening.** Every POST passes `checkOrigin` (exact Origin match), size caps, and zod validation per op. All SQL is parameterized and R2 keys are generated on the server.

**Runner.** Workers authenticate with a 72-character bearer token whose SHA-256 is stored. Completions carry an HMAC keyed by that hash. Leases are fenced (120 s, at most 5 attempts).

**Dev.** The Vite plugin mock works only on loopback. It strips any inbound `oai-*` headers and injects a single identity (`local_seedy` / `seedy@sites.test`) once the `__sites_local_auth=1` cookie is set. The mock does not exist in `npm start` or in production builds.

### 1.6 Deployment model

- **Production target.** OpenAI Sites is the only documented host. `npm run build` produces:
  - `dist/client`: static assets;
  - `dist/server`: an ES-module Worker plus a generated `wrangler.json`, with the Worker name `site-creator-vinext-starter`, a placeholder D1 id and no D1 `migrations_dir`;
  - `dist/.openai`: `hosting.json` plus a copy of `drizzle/`.

  Sites provisions D1 and R2, applies the migrations and owns sign-in. There is no standalone wrangler config, no CI/CD, and no identity layer for running outside Sites.
- **Local.**
  - `npm run dev` runs Vite with `@cloudflare/vite-plugin`, Miniflare D1/R2 under `.wrangler/state`, and the mock sign-in. Port 5173.
  - `npm start` runs `wrangler dev` on the built `dist/`, uses the same `.wrangler/state`, and has no sign-in. `http://127.0.0.1:8787`.
- **Concurrency.** Optimistic compare-and-swap on the engagement version and on the tenant's management version; fenced leases for runner jobs.
- **Python worker.** Operators run it themselves (process or Docker executor). It accepts HTTPS origins only.

## 2. Main user flows

> **Checked against the code on 15 Nov 2026** ([#212], [#228], [#235]): the top of the approved PR stack (`aa5f5f8`), described as it behaves once merged. The stack is the release candidate [PR #196], [PR #207], [PR #200], [PR #205], [PR #206], [PR #208] and [PR #198]; the round-2 fixes [PR #213] ([#209]), [PR #215] ([#210]) and [PR #214] ([#211]) and follow-ups [PR #218] ([#216]); the first refresh of this section, [PR #217] ([#212]); [PR #222] ([#219]); the round-3 fixes [PR #223] ([#220]) and [PR #224] ([#221]); the round-4 fixes [PR #230] ([#225]), [PR #229] ([#226]) and [PR #231] ([#227]); the second refresh of this section, [PR #232] ([#228]); and the round-5 fixes [PR #236] ([#233]) and [PR #237] ([#234]). Where this section and the code disagree, the code wins.

### 2.0 Local environment, sign-in and personas

**One-time setup per checkout or worktree** (commands: the README's [Quick start](../../README.md#quick-start); details in [site-app/README.md](../../site-app/README.md#local-development-and-sign-in)):
1. `site-app/.openai/hosting.json` is optional. Without it, the build uses the `DB` and `BUCKET` bindings ([PR #2], for [#1]).
2. Run `npm ci` in `site-app/`.
3. Run `npm run build`. It writes `dist/server/wrangler.json`, which the migration reads.
4. Run `npm run db:migrate:local`. It applies every migration in `site-app/drizzle/` that is not applied yet (18 today, `0000` to `0017`), records each by its SHA-256 and is safe to run again ([#34]; at `74c6463` the README listed only two of the five migrations then, F-15). Skipping it leaves the local D1 database without tables: every API request answers 500 with `no such table`, and `npm run seed:demo` stops.
5. On Windows, keep the checkout path short (`site-app\` under about 120 characters), or the migration fails with `SQLITE_CANTOPEN`. The check harnesses pick a short temp directory themselves when `TEMP` is long ([#204]).

**A. Personas on the development server, with hot reload (`npm run dev`).** This is the mode for manual QA.
1. Start `npm run dev` (port 5173 by default; pass `-- --port <port> --strictPort` for another). A server-rendering error is printed to the dev log as `[ssr] Server rendering error; ...` instead of a silent 500 ([#204]).
2. In another terminal, run `npm run seed:demo` (or `npm run seed:demo -- http://127.0.0.1:<port>`). It provisions qa-lead's practice through the app's own API: the client Acme, the structured engagement "Acme credit scoring model audit" with working paper WP-A10-01 and an evidence request granted to `qa-contrib`, a second engagement "Acme credit scoring model evaluation" with an approved scope and program, a registered model and linked prediction lineage, and every persona's membership and grant. `qa-lead2` also leads a practice of their own. It is safe to run again, and it prints a sign-in link per persona.
3. Sign in with `/signin-with-chatgpt?return_to=/` as `local_seedy` (Seedy, seedy@sites.test), or with `/signin-with-chatgpt?as=<persona>&return_to=/` as a persona from `site-app/fixtures/dev-personas.json`. The signed-out screen also lists the personas. Run the seed before a persona's first sign-in: a first sign-in without a membership provisions a separate practice.
4. The account menu in the sidebar footer offers Sign out and, on the development server only, Switch persona. It also appears in the minimal shell that an account without an active practice role gets (flow 3), so a refused user can still sign out or switch ([#202], [#225]). `/signout-with-chatgpt?return_to=/` signs out too.

The sign-in cookie is named for the port (`__sites_local_auth_<port>`), so development servers on different ports keep separate sign-ins. In this mode, unset `SELF_SIGNUP` means open, so any new identity provisions its own practice.

**B. Personas on the built Worker (`npm start`), with identity headers.** This is the mode the Playwright suite and the API harnesses use.
1. Stop `npm run dev` (both modes share `.wrangler/state`, so run only one at a time). Without an identity mode the built Worker trusts no identity and the API answers 401 (decision D-23). Start it in the loopback-only `trusted-headers` mode instead: `npm start -- --var IDENTITY_MODE:trusted-headers --var IDENTITY_TRUSTED_HEADERS:loopback-tests --var SELF_SIGNUP:open`. The app is at `http://127.0.0.1:8787`; add `--port <port>` to the same command for another port, and use that URL below. Outside `dev` mode, self-signup is off unless `SELF_SIGNUP` allows it, so without the last variable a user with no membership or invitation gets 403 ([#12]).
2. Every request must carry `oai-authenticated-user-id` and `oai-authenticated-user-email` (both required), and optionally `oai-authenticated-user-full-name` with `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`. The persona ids are the fixture's `userId` values (`persona-qa-lead`, `persona-qa-auditor` and so on), with emails `<persona>@personas.test`.
3. Send those headers in one of these ways:
   - **Playwright:** `npm run test:e2e` runs the persona suite with axe checks against its own built Worker on port 8790 and a fresh database ([site-app/e2e/README.md](../../site-app/e2e/README.md)). It uses one browser context per persona, with `extraHTTPHeaders`.
   - **Manual QA:** one browser profile per persona, with a header-injection extension limited to `http://127.0.0.1:8787/*`. Mode A is simpler.
   - **API calls:** curl with the headers. POSTs also need `Origin: http://127.0.0.1:8787` (checked by `checkOrigin`) and `Content-Type: application/json`. A POST that `checkOrigin` or the runner's bearer check refuses no longer leaves its body unread, so the next request on the same connection works ([#209]).
4. Seed the personas with `npm run seed:demo -- --trusted-headers http://127.0.0.1:8787`. This server has no `/signin-with-chatgpt` route (it answers 401), so the seed prints each persona's `oai-authenticated-user-id` and `oai-authenticated-user-email` headers, a curl example and the deep link to the seeded engagement instead of sign-in links ([#220]). Without `SELF_SIGNUP` the seed's first request answers 403, and the seed stops and says to start the Worker with `--var SELF_SIGNUP:open` (or `@personas.test`) ([#226]). Or bootstrap the personas by hand:
   1. Load `/` as `persona-qa-lead`. This creates qa-lead's own practice, with qa-lead as Lead Auditor and practice admin.
   2. Create a client "Acme" and a structured engagement for it (flow 2).
   3. In **Members & access**, either use **Invite by email** (the invitee joins on their first request), or **Add member** and enter the persona's user id as the "Signed-in account ID". `grantMember` does not require the user to exist. For internal personas, tick the Acme engagement in the Audit access step; for client personas, choose client Acme.

**C. API-level regression (no server needed).** `node scripts/engagement-lifecycle-check.mjs` and the other harnesses in `site-app/scripts/*-check.mjs` (among them `workspace-access`, `criteria-pins`, `work-inbox-api`, `practice-management`, `access-lifecycle`, `access-followups` and `refused-body`), run after a build, drive owner, reviewer, viewer and outsider personas through Miniflare in `trusted-headers` mode. `npm run check:harnesses` runs them all.

| Persona | User id | Role (client) | Used for |
|---|---|---|---|
| `qa-lead` | `persona-qa-lead` | Lead Auditor and practice admin (self-provisioned by the seed) | Setup, stage moves, paper sign-off, report creation and release, dossiers, runner enrolment, client request grants |
| `qa-auditor` | `persona-qa-auditor` | Auditor | Brief and program preparation, procedures, classification, evidence, findings, receipt acknowledgment |
| `qa-reviewer` | `persona-qa-reviewer` | Reviewer | Independent approvals: brief, program, procedure review, classification, retest and closure, report package, follow-up closure |
| `qa-lead2` | `persona-qa-lead2` | Lead Auditor; also leads a practice of their own | A second signer or releaser when qa-lead prepared the content; practice switching |
| `qa-eqr` | `persona-qa-eqr` | Engagement Quality Reviewer; holds an engagement grant like other staff ([#225]) | Quality review checklist and package sign-off; never edits audit work |
| `qa-contrib` | `persona-qa-contrib` | Client Contributor (Acme) | Client portal submissions |
| `qa-viewer` | `persona-qa-viewer` | Client Viewer (Acme) | Released reports; isolation checks |
| `qa-outsider` | `persona-qa-outsider` | Never granted | Cross-tenant isolation checks |

### Flows

Each flow lists the steps, the expected results and the negative checks. **F-xx** ids refer to the review's findings table (see the note at the top); a finding marked "fixed in #N" names the issue and PR that fixed it. API op names are given in parentheses. The roles each op admits are in `lib/permissions.ts`, which the dispatcher tests compare with the server. Since [#35] ([PR #177], F-45), a button whose op the user's role cannot run is hidden, and one the user may not run for another reason (independence, a missing precondition) is disabled with the server's reason beside it. The 403s below are what the API answers when called directly.

1. **First sign-in and provisioning** (local_seedy, or qa-lead before the seed)
   1. Open `/` and sign in.
   2. Expect the sidebar to show "<name> practice" (for example "Seedy practice"), the engagement switcher on "Example client / New AI assurance engagement", and the account menu with the name and "Lead Auditor". Overview shows the legacy engagement (no audit program yet) with a paper sign-off counter of 0 / 33 and "Set up audit program".
   3. `GET /api/workspace` returns `identity.role:"Lead Auditor"`, `identity.practiceAdmin:true` and `engagement.id:"ENG-default"`.
   4. Reload. The `tenantId` is unchanged.
   - **Negative:** on the built Worker without an identity mode or without identity headers, the request returns 401. With self-signup off (mode B without `SELF_SIGNUP`), a new identity without a membership or invitation gets 403 "You have no practice membership or pending invitation…", and the browser shows the minimal no-access shell described in flow 3.

2. **Practice setup** (qa-lead)
   1. Clients → New client → Create client.
   2. On the client page: New engagement → Create engagement. A structured engagement opens on Overview at stage Planning.
   3. Gear icon "Engagement settings" → Save engagement (`renameEngagement`).
   4. The new engagement appears in the engagement switcher and in the Engagements directory.
   5. A link with only `?practice=<id>` and no `view` opens that practice at Overview, or at the Engagements directory when no engagement opens (`readWorkspaceLink` and `practiceLanding` in `lib/workspace-links.ts`, [#225]).
   - **API:** `POST /api/management {tenantId, expectedVersion: managementVersion, op: createClient|createEngagement, data}`.
   - **Negative:** repeating a call with the old `managementVersion` returns 409 "Client or access settings changed. Reload before saving.".

3. **Staff onboarding and revocation** (qa-lead, qa-auditor)
   1. Members & access → Add member. Identity step: display name, Signed-in account ID `persona-qa-auditor`, tick "Site access has been arranged". Role step: Auditor. Audit access step: tick engagement E. Then Review → Confirm access. Alternatively, Invite by email.
   2. As qa-auditor, only E is listed. `GET /api/workspace?tenantId=T&engagementId=<another>` returns 404, and a link to it shows "This engagement does not exist in this practice or you no longer have access." with an **Open the Engagements directory** button (internal roles; client roles keep their own wording, [#225]). When the link names another practice the account belongs to (`?practice=<id>&engagement=<unknown>`), that practice opens with no engagement selected, and the message, its banner and the directory button belong to it, not to the account's default practice (`loadMissingEngagement` in `app/workspace/use-workspace-data.ts`, [#234]). Opening any practice view (Engagements, Clients, My work and so on) clears the banner, and Retry then reloads the practice instead of the engagement (`leaveFailedEngagement`, [#234]); an audit view without an engagement keeps the banner.
   3. As qa-lead: Revoke → Revoke access (`revokeMember`). Revocation also withdraws the member's engagement grants and cancels their pending invitations. qa-auditor's next request for the practice returns 403 "You do not have access to this practice"; a fresh load without a practice returns 403 "Your practice access has been revoked. Contact a practice administrator."
   4. A refused workspace load (403 with no workspace: never a member, revoked staff or a revoked client member) renders a minimal shell (`app/workspace/no-access-shell.tsx`) with no sidebar, breadcrumb or search: the signed-in name, "No practice access", the server's reason, Try again and the account menu. The 403 body carries `account: { name }`, the caller's own display name and nothing else ([#225], F-72).
   5. Edit access (Members & access) lists the engagements for every staff role, the Engagement Quality Reviewer included. Without a role change it only adds: engagements the member already holds stay ticked and disabled, a note points to Team & runtime for withdrawing one, and the form sends only the newly ticked ones; changing the role withdraws them all ([#225]).
   - **F-24 (fixed in [#12], [PR #84]):** Restore access no longer gives back earlier grants. A restore without listed engagements is refused with 400 "List the engagements to grant again; earlier grants are not restored", and an empty list restores none.
   - **Names:** a membership that names the member only by email (created by a sign-in without a full name, or an invitation accepted without a display name) takes the member's full name from their next request that carries one, so "Recorded by" and the other person labels show the name; a name an administrator gave is kept, and the email remains only while no name is known (`recordName` in `lib/tenancy.ts`, [#241]).
   - **Negative:** after an invitation expires, inviting the same email again supersedes it instead of returning 409 ([#209]); the Access log then reads, for example, "Invitation sent (replaced 1 expired invitation)" ([#221]).
   - **Negative:** Add member with the account ID of someone who already holds active access is refused with 409 "QA Auditor is already an active member. Change their role or engagements in Members & access instead.", as Invite by email refuses the same person, and nothing changes: their name and grants stay. The wizard shows the refusal in its form, not as a toast. Restoring a revoked member is still a grant (`saveMember` in `lib/commands/management/members.ts`, [#244]).

4. **Engagement access** (qa-lead, qa-reviewer)
   1. Assurance workbench → Team & runtime → Manage access. Deactivate qa-reviewer with a reason (`setAccess active:false`).
   2. qa-reviewer gets 404 for that engagement, and an `access_event` record titled "Access decision" appears in the workbench ([#227]). Opened, its sheet carries the badge "Access decision" and the subtitle "Engagement access granted or revoked, and why" (`recordSubtitle` in `app/assurance-record-details.tsx`), and shows "Team member" with the member's display name and "Access" as Granted or Revoked ([#234]). A revocation names the member too: the workbench reads names from every member of the practice (`memberNames` of `GET /api/assurance`), not only from those who still hold access ([#244]).
   3. Reactivate qa-reviewer.
   4. Manage access lists every active staff member, the Engagement Quality Reviewer included: `setAccess` admits every staff role (`assignableRoles.engagementAccess` in `lib/permissions.ts`), so qa-lead can grant or withdraw qa-eqr's engagement access here. The EQR's actions stay limited to the quality review ([#225]).
   - **Negative:** `setAccess` for someone who is not an active staff member returns 400 "Select an active staff member".

5. **Scope: brief and program** (qa-auditor prepares, qa-reviewer approves)
   1. Audit program → Engagement brief → Complete brief → Save scope draft → Submit for review (`saveBrief`, `submitBrief`).
   2. qa-auditor sees no Approve scope button: `approveBrief` admits Reviewers and Lead Auditors only, and the API answers qa-auditor with 403. A Lead Auditor who contributed to the brief sees the button disabled with the reason "A preparer or contributor cannot approve their own work" beside it, linked to it with `aria-describedby`; the same holds for Approve program. The buttons and the 403 of `approveBrief` and `approveProgram` share one precondition, `ownWorkRefusal` in `lib/preconditions.ts`, which also backs the independence check of `reviewProcedure` and `closeMonitoringCase` ([#234]).
   3. qa-reviewer: Request changes (`returnBrief`). qa-auditor resubmits. qa-reviewer: Approve scope (`approveBrief`).
   4. Program tab → Assess candidates → Save scope decisions (`scopeProgramCandidates`). To keep later flows short, mark 2–3 procedures applicable and the rest not applicable with a rationale. WP-RP-02 is a release-time record and never gates capture (F-30, fixed in [#14]).
   5. Select the rows → Assign & schedule: preparer qa-auditor, reviewer qa-reviewer, due date (`bulkPlanProcedures`) → Submit program → qa-reviewer: Approve program (`approveProgram`).
   6. Audit program → Acceptance: a writer records acceptance and continuance with the engagement team (Record acceptance, `saveAcceptance`), each Auditor, Lead Auditor and Reviewer on the team declares independence (`saveDeclaration`), and qa-lead approves (Approve acceptance, `approveAcceptance`; Lead Auditor only). A structured engagement leaves Planning only with an approved acceptance record (`acceptanceGates` in `lib/workflow/acceptance.ts`).
   - **Expect:** execution is refused until both brief and program are approved.
   - **Disqualifying relationships (decision D-28, [#221]):** the Approve acceptance button and `approveAcceptance` share one precondition, `approvalRefusal` in `lib/workflow/acceptance.ts`. While a team member has declared a disqualifying relationship or an unresolved threat, the button is disabled with the server's reason, which names the person ("QA Reviewer declared a disqualifying relationship with the engagement; remove them from the team before accepting it"), and the API answers 409 with the same message. The Revise acceptance team checklist marks that person ("Cannot be assigned: declared a disqualifying relationship"), and `saveAcceptance` answers 400 naming them. Once the brief is approved, the program's empty state names the next real step ([#202]).
   - **F-04 (fixed in [#13], [PR #54]):** work is bound to its procedure's plan hash, so a later due-date edit no longer invalidates every execution.
   - **F-29 (fixed in [#13], [PR #54]):** program history keeps only submissions, so draft saves no longer use up the revision cap.

6. **Classification** (qa-auditor, qa-reviewer)
   1. Regulatory mapping → Assess classification → answer the facts in each section (yes, no or "needs information") → Save classification (`classify`). Status shows "provisional".
   2. While a fact that decides the risk class (route, Art 5, Art 50 triggers and exclusions) is unknown, the label reads "Needs information". Facts required for approval that cannot change the class (GPAI roles, SME status, and Art 50 facts on a high-risk route) leave the label at, for example, "High risk" (decision D-47, [#201]). Either way "Approve independently" stays disabled and lists what the approval waits for ([#19]).
   3. qa-auditor sees no "Approve independently" button (`approveClassification` admits Reviewers and Lead Auditors; F-45, fixed in [#35]).
   4. qa-reviewer approves through the attestation dialog (`approveClassification`). Status becomes "approved".
   - **Negative:** approving an approved classification again returns 409 "This classification is already approved", before the independence check; no second approval is attested and the recorded approver and time stay ([#226]).
   - **F-31 (fixed in [#19]):** an "Unassessed" route reads "Unassessed" and blocks approval; contradictory route and fact combinations are rejected.

7. **Evidence custody** (qa-auditor)
   1. Evidence vault → Files → Upload evidence, using `public/example-predictions.csv`, category Dataset, and a handling basis → Upload for acceptance. The row shows "Awaiting acceptance" and the response contains the SHA-256.
   2. Open the record → Accept evidence, then give a rationale in the attestation dialog (`acceptEvidence`).
   3. Preview file (UTF-8 text up to 256 KB) and Download file. The `X-Evidence-SHA256` header must equal the upload hash.
   - **Negative:** a stale `expectedVersion` returns 409; a file over 50 MB is rejected with 400; accepting evidence that is already accepted returns 409 "This evidence is already accepted" ([#201]). In the Assurance workbench, importing an accepted file that is not JSON as an assurance packet or briefing (`importPacket`, `importBriefing`) returns 400 "This assurance packet file is not valid JSON" or "This briefing file is not valid JSON" (`parseJsonFile` in `lib/http.ts`, [#220]); valid JSON that is not a packet returns 400 "This file is not a supported assurance packet (expected packet version 1.0)", followed by the first missing field when one is missing (`packetRefusal` in `lib/assurance-packet.ts`, [#226]).

8. **Procedure execution, review and sign-off** (qa-auditor, qa-reviewer, qa-lead)
   1. Open the procedure sheet. Execute: Record work performed (`recordProcedureExecution`).
   2. Evaluate: Evaluate evidence (`evaluateProcedure`) → Compile paper & send for review (`submitProcedure`).
   3. qa-reviewer returns it with a question (`returnProcedure`). qa-auditor responds and resubmits. qa-reviewer: Approve reviewed work (`reviewProcedure`).
   4. qa-lead: Sign working paper and attest in the dialog (`signPaper`).
   - **Negative:** the preparer reviewing gets 403; qa-reviewer signing gets 403; editing a signed paper gets 409; signing an already signed paper gets 409 "This paper is already signed" ([#201]).
   - **Legacy variant (ENG-default):** editPaper → submitPaper → the author's own review gets 403 → the reviewer comments, the author uses `respondComment`, the reviewer uses `resolveComment` → `reviewPaper` → a different Lead runs `signPaper` → `reopenPaper` clears the approvals.
   - **F-05 (fixed in [#14], [PR #85]):** recompiling after sign-off supersedes the old signed paper, so it no longer stays required and published.

9. **Testing lab diagnostics** (qa-auditor)
   1. Testing lab → Download sample CSV. Upload it as Dataset and accept it.
   2. Register version: "Saved predictions (CSV)", "Binary classification" (`createModel`).
   3. Evaluate → wizard:
      - protocol: create new;
      - columns and favourable label; the declared dataset role options read Test, Validation, Training and Unknown, not codes ([#234]);
      - procedures: performance, demographic parity, disparate impact, equalized odds;
      - thresholds, protected-group column, handling basis; the "Minimum rows per group" help names the general floor of 30 and the special-category floor of 50 ([#202]);
      - the sample's `group` column is synthetic: untick "holds special-category data", or record a client basis under Datasets and choose the hosted route ([#60]).

      Then Save protocol & run (`createEvaluationProfile`, `queueRun`, `executeRun`).
   4. Evaluations → Results show per-test outcomes, the overall outcome, group tables and auto-drafted Article 10/15 papers. The statistics plan lines name each criterion and its role by their labels, for example "Equalized odds: … [Confirmatory]" ([#234]).
   5. Datasets: each registered dataset card has **Export dataset card**, which downloads the stored card with only the fields of `schemas/dataset-card.schema.json` (`datasetCardExport` in `lib/dataset-card.ts`, [#234]). The card's role badge and the registry's role options use labels too.
   - **Negative:** a dataset over the hosted limits (for example 10,001 rows) cannot be inspected. The wizard's alert gives the server's reason; after Continue, the Data step shows "Dataset inspection is unavailable:" followed by that reason, and leaving the Data step is refused with it (`inspectError` in `app/testing-lab/use-lab-setup.ts`, `stepError` in `app/testing-lab/step-error.ts`, [#234]).
   - **F-07 (fixed in [#15], [PR #56]):** a later evaluation after Workbench → Review & run evaluation no longer returns 409. Confirmed in code: the lab picks the dataset card per run with `datasetCardFor` (`lib/dataset-card.ts`, called from `app/testing-lab/use-lab-setup.ts`), which uses the handed-over card only when its artifact id and SHA-256 match the evaluated bytes, and `lib/dataset-card.test.ts` pins that a hand-off card never leaks into another dataset's evaluation. [#67] ([PR #114]) keeps the card pin on retries and planned evaluations.
   - **F-33 (fixed in [#15], [PR #56], and [#67], [PR #114]):** the lab hand-off is a one-shot intent, so the wizard no longer reopens and queues duplicates, and a second queued run bound to the same procedure returns 409. On a procedure sheet, "Queue planned evaluation" (`queueRun`) opens the Testing lab with the queued run's dialog; since [#226] the shell's navigation guard reads whether a command is in flight from a ref (`isBusy` in `app/workspace/use-workspace-data.ts` and `navigation-guards.ts`), so the stale `busy` of the last committed render no longer drops the hand-off. While the run is queued or running, the button is disabled and "Open queued evaluation" (or "Open running evaluation") shows it.
   - **F-06 (fixed in [#15], [PR #56], for hosted runs and [#65], [PR #98], for external runs):** a constant predictor fails or is inconclusive against the majority baseline. Since [#233], when no member decides, the result's explanation (`explainResult` in `lib/hosted-statistics.ts`) names the first member not shown inside its band: for a constant predictor that is balanced accuracy, not accuracy, whose interval can already lie inside its band.

10. **Evidence requests and client contributor portal** (qa-auditor, qa-lead, qa-contrib)
    1. qa-auditor: Requests → Request evidence → Create request (`createEvidenceRequest`).
    2. qa-lead: Client request access → Assign request to qa-contrib with an expiry (`grantClientRequest`). The grant list shows the stored expiry date in UTC ([#202]).
    3. qa-contrib: Overview → Your evidence requests → Submit evidence package (1–10 files, at most 10 MB in total; `POST /api/client-submission`). The package shows "Awaiting receipt acknowledgment". Ask a question → Send reply. Focus moves into each portal form and back to its button on cancel ([#203]).
    4. qa-auditor: Acknowledge receipt (`acknowledgeClientSubmission`) → Assess evidence (`assessEvidenceRequest`). Acknowledge receipt is offered to every role that holds the op (Auditors and Lead Auditors), outside the Lead-only access panel ([#210]). The Auditor's "Client submissions" panel also shows each active grant's thread with Send clarification (`publishClientClarification`); both panels offer it only for an active grant, since the server refuses expired, revoked and lapsed grants ([#216]). Both panels name each contributor by display name, adding "(access revoked)" when the membership is no longer active; "Inactive contributor" appears only when no membership exists (`grantHolderLabel` in `app/client-portal.tsx`, fed by the writers-only `clientGrantHolders` of the workspace read model, [#225]).
    5. qa-lead: Revoke (`revokeClientRequest`), offered only on an active grant ([#221]); the server refuses an already revoked or expired grant with 409 "This grant is no longer active" and keeps who revoked it and when ([#240]). A clarification on a revoked grant reads "This grant was revoked"; on an expired one, "The client assignment has expired" ([#240]). What the contributor gets next depends on whether they still hold another active grant on the engagement (active, unexpired and issued since their current membership began: `activeGrant` in `lib/workflow-state.ts`, which `loadEngagement` in `lib/engagement-repo.ts` checks):
       - **Another active grant on the engagement:** the engagement still opens (200), and a submission or reply under the revoked grant returns 403 "Request access expired or was revoked".
       - **No other active grant:** the engagement returns 404 "Engagement not found" and the client directory no longer lists it. A submission or reply under the revoked grant also returns 404 "Engagement not found", since the engagement is refused before the grant is looked at.
    6. qa-lead: Record limitation (`closeEvidenceRequest`; this creates a limitation memo) → Reopen request (`reopenEvidenceRequest`).
    - **Negative:** the contributor's projection carries no staff user id or email, including the receipt's actor ([#201]).
    - **F-62 (fixed in [#14], [PR #85]):** reopening a closed request retires its limitation memo, so it is no longer required, and closing it again revises that memo instead of creating a second one.
    - **F-72 (fixed in [#36], [PR #180]):** clients get a dedicated portal shell without practice navigation; since [#225] ([PR #230]) an account with no active role, including a revoked client member, gets the minimal no-access shell instead (flow 3).

11. **Findings and remediation** (qa-auditor, qa-reviewer, qa-lead)
    1. New finding, with the calculated risk preview → Record finding (`createFinding`).
    2. Update remediation → set the remediation status "Ready for retest" → Save remediation (`updateFinding`).
    3. qa-reviewer: Support & retest → Record independent retest (`recordFindingRetest`) → Close verified finding (`closeFinding`). The retest's evidence is required: the form says "Select the evidence the retest relied on" and moves focus to the evidence without sending, and the server's 400 says the same ([#241]).
    4. qa-lead: Reopen finding (`reopenFinding`).
    - **Negative:** the creator or remediator closing the finding gets 403. Once an effective retest is on record, the disabled Close verified finding and the 403 both say "The finding's creator or remediator cannot close it"; before it, "Independent retest confirmation is required" (`closeFindingRefusal` in `lib/permissions.ts`, [#241]).

12. **Stages, final report, approval, release, withdrawal** (qa-lead, qa-reviewer, qa-eqr, qa-viewer)
    - **Preconditions:**
      - The engagement is structured. For a legacy engagement, run Adopt workflow first: `releaseReport` needs a workflow snapshot.
      - Brief, program and classification are approved.
      - Every selected applicable procedure is reviewed and signed.
      - No run is queued or running, and no LL144 per-group run is incomplete. The completion checklist and "Outstanding at capture" list exactly the server's capture blockers (`captureGates`, decision D-48, [#202]).
    1. Overview → Move to Fieldwork → … → Sign-off (`setStage`; Lead Auditor only). Skipping a stage or moving backwards is blocked.
    2. Reports & sign-off → Prepare final snapshot (`createReport kind:"final"`). Once captured, the sign-off banner reads, for example, "Captured (Qualified), awaiting approval" (the conclusion type's label, without a trailing "(not assurance)") and gives each viewer their next step: an approver who did not capture it reviews and approves, the capturer is told someone else approves, an EQR is told to sign off in Quality review, and other roles are told who approves. "Final capture blocked" applies only while a new package is needed (`awaitingApproval` in `lib/report-presentation.ts`, R1-19, [#221]).
    3. Integrity & downloads → Verify captured content. `GET /api/report-package` returns `proof.valid:true`. Also use Preview exact client package.
    4. qa-lead, who captured the package, sees Approve package disabled with the reason "The report creator cannot approve its package" below it; the button and `approveReportPackage`'s 403 share `packageApprovalRefusal` in `lib/preconditions.ts` ([#226]). qa-reviewer answers the completion checklist and approves (`approveReportPackage` with both hashes).
    5. If an Engagement Quality Reviewer is appointed (`appointQualityReviewer`), qa-eqr, who reaches the engagement through an engagement grant (the seed grants one; otherwise Team & runtime or Edit access, [#225]), completes the quality review and signs off (`saveQualityReview`, `signOffQualityReview`) before release. Until then the package guidance names the outstanding sign-off in the server's words, and Release to client stays disabled with that reason; the UI and `releaseReport` share one precondition, `releaseRefusal` in `lib/preconditions.ts` ([#210]). The precondition includes release's re-checks of the reviewer ([#244]): if the reviewer who signed off is later revoked, moved to another role or put on the team by recorded work, the guidance and the disabled Release name the server's reason, for example "…no longer an active member with the Engagement Quality Reviewer role; appoint an eligible reviewer and obtain their sign-off before release", and the handoff badge turns amber. The workspace reads the reviewer's standing from `qualityReview.standing` of `GET /api/workspace` (`reviewerStanding` in `lib/quality-review-records.ts`, worded by `reviewerStandingProblem` in `lib/domain/quality-review.ts`).
    - **Appointing ([#244]):** the Quality review tab's picker lists every active member with the reviewer role and access to the engagement. Those the server would refuse (on the engagement team, or on the team of another of the client's engagements within the cooling-off period) are listed as disabled with the refusal, from `qualityReview.candidates` (`appointmentRefusal` in `lib/quality-review-records.ts`). The cooling-off refusal names the earlier engagement by its title, with its id in parentheses only where another of the client's engagements has the same title (`coolingOffMessage` in `lib/domain/quality-review.ts`, [#246]); the picker, the inline refusal and the server's 409 read the same text. A refused appointment keeps the typed reason and shows the refusal in the form, not as a toast.
    6. qa-reviewer has no Release to client button (`releaseReport` is Lead Auditor only; the API answers 403). qa-lead: Release to client (`releaseReport`).
    7. qa-viewer sees the package, labelled with its release time ("Released", [#210]), and can Print (`/report?tenantId&engagementId&reportId`). `/api/report-package?download=1` returns `proof.valid:true`.
    8. qa-lead: Withdraw (`withdrawReport`). The client loses access. The staff print view (`/report`) of a withdrawn report says so in its header ("CONTROLLED FINAL REPORT · WITHDRAWN" and a "Withdrawn." note with the time and reason), and a successor that was also withdrawn reads "Superseded by REPORT-…, since withdrawn" (`successorLabel` in `lib/workflow-state.ts`, [#241]); the in-app report sheet reads the same line from the engagement's reports ([#246]). Its meta line reads "Released" with the release time, as before the withdrawal ([#244]).
    - **Expect:** a second release supersedes the first automatically and records a client notification (F-32, fixed in [#14]); WP-RP-02 and MEM-SO-01 never gate capture (F-30). A superseded report that the client can still read can also be withdrawn (decision D-45, [#201], [#202]). When a release's successor is withdrawn, the client reads the predecessor again; its sheet says "Its successor REPORT-… was withdrawn. The client still reads this report." and the Reports & sign-off banner names it the same way (`withdrawnSuccessorOf` in `lib/workflow-state.ts`, [#226]). A later release does not end this: `releaseReport` supersedes only reports in state "released", so the predecessor stays client-visible, and named in the banner, until a Lead Auditor withdraws it.
    - **Supersession wording ([#234]):** the client projection, the client's release notices and the staff guidance on a released report all read one answer, `clientSupersededBy` in `lib/workflow-state.ts`, worded by `supersessionText` in `lib/report-presentation.ts`. The latest released report's staff guidance reads "Released to the client as its current report. A Lead Auditor can withdraw it." In the client's release notices, a report superseded by a later release adds "It has since been superseded by REPORT-…", and a report whose successor was withdrawn adds "Its successor was withdrawn, so it is the current report again" only while it is the client's current report (the newest client-visible report with no successor, else the newest whose successor was withdrawn); once a later report is released, it adds "Its successor was withdrawn; the current report is REPORT-…" instead. In the client projection such a report's successor still reads "a later report, since withdrawn".
    - **Results by criterion ([#241]):** the client report counts only the findings it lists (F-57), while an internal-only High or Critical finding still decides the result and may open a criterion row of its own (D-36). Such a row never shows a 0 that contradicts "Exceptions noted": in the `/report` print view its Open findings cell reads "Withheld" (or "N and withheld" beside listed findings) with a short note; in the in-app report sheet (`FrozenReportDetails` in `app/report-details.tsx`, which renders the client's own report sheet and the staff Client package preview), which has no Open findings column, the Result cell adds "Open findings withheld." with the same note. In both views a criterion no procedure evaluated reads "None evaluated" under Exceptions. The roll-up counts `withheldHighFindings` (`criterionRollup` in `lib/domain/report-gates.ts`), and both renderers word the cells through `criterionExceptionsCell`, `criterionOpenFindingsCell`, `criterionWithheld` and `withheldFindingNote` in `lib/report-presentation.ts`.
    - **Negative:** the print views `/report` and `/ll144-summary` answer like their APIs (`/api/report-package`, `/api/ll144-summary`) through one mapping, `answerPrintFailure` in `app/print-failure.ts` ([#209], [#216], [#220]): 403 when access is denied, with the refusal's own message on the 403 page (for example "You do not have access to this practice"); 404 for a missing, withdrawn or unreleased report or an unpublished summary; 409 for an integrity mismatch or an unreadable record; 503 for a missing or unavailable blob; and 500 for a render failure anywhere in the print tree, the markup's child components (the assurance report, the criteria pack line, an LL144 table) included, because `resolvePrintTree` in `app/print-failure.ts` renders them inside the page's try block ([#234]). The last three show the "could not be loaded" fallback and are logged ("The /report print view could not be rendered: …"); the page sets the status through `lib/response-status.ts`, applied by `build/sites-worker.ts`.

13. **Client and tenant isolation** (qa-viewer, qa-outsider)
    1. qa-viewer sees only Acme engagements in the client portal shell; client-visible accepted evidence only; no Requests tab.
    2. A deep link to an internal paper shows "This page is outside your current access". An internal `artifactId` returns 404. `GET /api/assurance` and `/api/work-inbox` return 403. Another client's engagement returns 404; a link to it shows "This engagement is not available to you" with an Open button for each of the client's own engagements, and "No engagement is assigned" only when the client has none ([#240]).
    3. qa-outsider: `GET /api/workspace?tenantId=<qa-lead tenant>` returns 403 "You do not have access to this practice".

14. **Dossier sealing and verification** (qa-lead, qa-viewer)
    1. On the captured report: Seal internal dossier (`POST /api/dossier {tenantId, engagementId, reportId, op:"seal", audience:"internal"}`). After release, also seal the client audience. A scoped internal export is sealed separately ("Seal scoped internal export").
    2. Download with `GET /api/dossier?tenantId&engagementId&reportId&audience=…`, then run `python -m engine.assurance verify --dossier dossier.json`. Add `--trusted-keys trust.json --require-trusted-signature` to check against a pinned key. Flip one byte and confirm verification rejects it.
    3. Before the client dossier is sealed, the client sees no download link (`?sealed=1` answers whether it is sealed). A direct download returns 409 "Ask the audit lead to seal this audience’s dossier first", and 404 while the report is not client-visible.
    - **Negative:** a `POST /api/dossier` without an audience, or with one other than `internal` or `client`, returns 400 "Choose who the dossier is for (internal or client)" before anything is read or sealed; it no longer falls back to internal ([#226]).
    - **F-71 (fixed in [#35], [PR #177]):** the client dossier link is hidden until the dossier is sealed, and fetch errors go through one status-mapping helper.
    - **F-17 (fixed in [#62], [PR #146]):** `cryptography` is declared wherever signatures are verified (`engine/requirements-image.txt`, `engine/requirements-dev.txt`), and the signature tests cannot skip in CI.

15. **External runner** (qa-lead, qa-auditor, operator)
    1. Team & runtime → Enroll runner (`enrollWorker`), with the image digest as `sha256:` and 64 lowercase hex characters. The token is shown once. The capability list comes from `lib/runner-capabilities.ts`, the list the server validates against: Provided predictions, ONNX, XGBoost, LightGBM, PMML, GenAI evidence ingest (`genai_ingest`) and Client-local worker (`client_local`) ([#211]).
    2. qa-auditor: Execution → Review external execution plan → Freeze execution request (`queueExternal`). The prediction lineage is labelled by name, version and date, not by record id ([#202]).
    3. Operator, with Python 3.12: set `ASSURANCE_SITE_ORIGIN` (HTTPS only), `ASSURANCE_WORKER_TOKEN`, `ASSURANCE_WORKER_ID` and `ASSURANCE_WORKER_IMAGE_DIGEST=sha256:<64 hex>`, then run `python -m engine.worker --workspace jobs --once`. Expect `{"state":"completed"}`. A client's own worker adds `--client-data-dir` for client-local jobs.
    4. qa-auditor: Compile draft paper (`importJob`). The compiled paper opens ([#202]). Expect run contract 1.5 (worker 1.2.0 attaches the statistics decision to every result; results without decisions compile to the frozen 1.2 projection) and a supplementary draft paper, titled "External execution — <job id>" and not required. Since [#233] it is filed under the procedure the job is bound to, with that procedure's template criteria and objective; only a procedure whose template the pinned pack does not hold falls back to the pack's external-execution template (`externalExecutionPaper` in `lib/commands/assurance/execution.ts`). The execution row counts the job's leased attempts ("1 attempt", or "not yet attempted"), not the lease fence, which a cancel also moves ([#233]).
    5. With a `genai_ingest` runner enrolled, the GenAI tab offers Queue ingest. A finished ingest reads "The ingest of <plan label> finished." with Compile result (`compileGenaiResult`), never its job id; on the workbench's execution row the same job offers Compile GenAI result, which runs the same op (`compileAction` in `app/assurance-workbench/types.ts`), never Compile draft paper, and the row offers nothing once the result is an artifact of the engagement (`compiled` in `lib/read-models/assurance-view.ts`, [#240]). The criteria table, member statuses and run checklist show labels (`valueLabel`, `genaiFieldLabel` in `lib/presentation.ts`), and a judge blocker names the rules the judge failed in words, for example "position-swap consistency is below the 0.80 floor", with "judge J1" as its detail (`judgeNotValidatedMessage` in `lib/genai/readiness.ts`, [#240]). The missing-metadata blocker names the fields by the checklist's labels ("System snapshot, Judge model family"), and the result card names a blocker's run by its plan label ("run of WP-GA-01 … · 1 criterion", "run 2 of …" for one of several runs; `resultPlanLabel` and `runOfPlan`), keeping the run key only where no plan label exists ([#246]). Queue ingest's plans and bundles carry readable labels ([#211]): the time to the minute, in the viewer's local time, with a short id suffix only where two labels would read the same ([#221], [#227]). The execution request rows and the Cancel execution options name an ingest job by the same plan label (`jobNames`), its mode reads "GenAI ingest", and a job without a system reads "External execution", never null or a bare id. Since [#233] marking criteria (`genai_marking`) pass the readiness gate like other criteria (`lib/genai/readiness.ts`): their runs are the marking blocks, so an imported envelope stays at L1 with `genai_level_below_l2`; a `marking_presence` criterion that requires a trusted signer is blocked by `genai_marking_requirement_unmet` ("N metadata marks without a trusted signer") when marks in its sample lack one; and the claim scope states that marking criteria say nothing about the quality, accuracy or safety of the outputs ([docs/design/genai-evidence.md](../design/genai-evidence.md), section 12.3). For a pairwise judge the results show the position-consistency lower bound and the number of swapped pairs, or "position consistency: no swapped (AB/BA) pairs" (`judgeValidationText` in `lib/genai/labels.ts`, [#233]).
    - **Client-local runs with blank group cells ([#233]):** in a client-local run on a client-held dataset, a row whose mapped group cell is empty no longer fails the job with `missing_value`. The engine treats it like any row with no group value (D-33): such rows are left out when there are fewer of them than the minimum group size, they are counted as withheld for a missing group value, and every result's limitations say so (`MISSING_GROUP_NOTE` in `engine/criteria.py`). Every other empty mapped cell, and an empty group cell on the platform-held path, still fails the job ([engine/WORKER.md](../../engine/WORKER.md)).
    - **Locally:** the worker refuses `http://`. Use `ASSURANCE_TEST_PYTHON=<python> node scripts/assurance-integration-check.mjs`, which runs its own loopback proxy, or put a TLS proxy in front of `npm start`.
    - **Negative:** `cancelJob` while the job runs makes the worker's later complete return 409. `cancelJob` for an unknown job, or for another engagement's job, returns 404 "Job not found"; a finished or cancelled job of this engagement returns 409 "Job already completed or cancelled" ([#220]). Revoking an unknown runner returns 404 ([#201]); a runner revoked before it ever connected reads "Revoked before its first connection" ([#227]).
    - **F-34 and F-36 (fixed in [#10], [PR #47]):** bad jobs and clock skew no longer crash the worker, and transfers use an idle timeout plus a size-scaled budget instead of one fixed 15 s deadline.

16. **My work, search, navigation, drafts** (qa-auditor, qa-lead)
    1. My work: views, filters, snooze with Undo, and the Lead-only "Team workload" scope. After a snooze (or resume) removes a row, focus moves to the next row's link, else the previous row's, else the list heading (`lib/focus-order.ts`, [#227]). Undo on the "Reminder snoozed" toast, by mouse or keyboard, returns focus to the restored row's link once the saved preferences show it ([#241]). `GET /api/work-inbox?tenantId&page=0` lists only granted engagements, and the last page has `nextPage:null`.
    2. Ctrl/Cmd+K search; Back/Forward restores the view and filters. The audit program writes its open tab to `section=` when no procedure is open (`app/audit-program/program-sections.ts`): the first write after it mounts replaces the history entry and later tab changes push one, so Back and Forward step between tabs, and reload and Copy page link keep the tab ([#227]). Closing a record sheet or dialog returns focus to the element that opened it ([#203]); for a dialog opened from a menu item, such as a record sheet's More actions, that is the menu's trigger, with the mouse as well as the keyboard (`menuTriggerOf` in `hooks/use-return-focus.ts`, [#241]).
    3. **Focus after a refusal** (`hooks/use-refusal-focus.ts`, wired into every dialog and sheet, [#227]): a form submit, or a click on a submit button outside a form (the paper sheet's Save revision), arms the rule; when a refusal then appears, focus moves to the first field marked `aria-invalid="true"`, else to the first `role="alert"`. Focus moves only when it was lost (on `<body>` or the modal) or is still on the submitter, never away from where the person moved it. Controls with an explicit `type="button"` (tabs, toggles, Add row) never arm it.
    4. Recovery draft: edit a paper, reload, then Restore draft. After another user saves a new revision, the draft reports `current:false`.
    5. Two tabs edit the same paper: the second save gets 409. The editor shows the conflict with a Reload button in place, and the toast's Reload also works above the open sheet (mouse, or Alt+T for the keyboard); Reload leads to "This paper has a newer revision" ([#210]). If focus was on the page body before Alt+T, Escape returns it to the open sheet; with no modal open, Escape collapses an expanded toast stack and focus returns to where it was ([#216]). With a modal open, Tab from the last toast control and Shift+Tab from the first (or from the list Alt+T focuses) return into the open sheet or dialog: to the element focused before Alt+T if it is in the modal, otherwise to the modal's first (Tab) or last (Shift+Tab) tabbable element (`useToasterFocus` in `components/ui/sonner.tsx`, [#227]).

17. **Monitoring and follow-up** (qa-auditor, qa-reviewer, qa-lead)
    1. Audit program → Follow-up → New case (`createMonitoringCase`).
    2. Record assessment (`assessMonitoringCase`): a decision, the assessment, the next due date and linked accepted evidence.
    3. For a case that requires reassessment, qa-lead: Open reassessment → Create linked engagement (`openFollowup`; Lead Auditor only). The case links to the successor engagement.
    4. qa-reviewer (not the owner or a contributor): Review closure → Close case (`closeMonitoringCase`). Review closure is disabled with the server's reason while the case cannot close: not yet assessed, a reassessment case without its successor engagement, or another case without linked accepted evidence (`monitoringClosureRefusal` in `lib/preconditions.ts`, [#210]). The button shows on every case that is not closed, so a reviewer also sees it, disabled with "Assess the case before independent closure", on an open case not yet assessed ([#241]). `closeMonitoringCase` refuses with the same function ([#216]), after the already-closed check.
    5. For a recurring case (not one-off), a writer: Plan next cycle → Create next cycle (`createMonitoringCase` with the previous case).
    - **Negative:** closing a closed case returns 409 "This case is already closed. Create a new case for subsequent work" ([#209]).
    - **F-66 (fixed in [#14], [PR #85]):** a reassessment case closes without evidence once its successor engagement exists; other decisions need linked accepted evidence, so a case can no longer be stuck unclosable.

[#1]: https://github.com/ahed-jneed/ai-assurance/issues/1
[#10]: https://github.com/ahed-jneed/ai-assurance/issues/10
[#12]: https://github.com/ahed-jneed/ai-assurance/issues/12
[#13]: https://github.com/ahed-jneed/ai-assurance/issues/13
[#14]: https://github.com/ahed-jneed/ai-assurance/issues/14
[#15]: https://github.com/ahed-jneed/ai-assurance/issues/15
[#19]: https://github.com/ahed-jneed/ai-assurance/issues/19
[#34]: https://github.com/ahed-jneed/ai-assurance/issues/34
[#35]: https://github.com/ahed-jneed/ai-assurance/issues/35
[#36]: https://github.com/ahed-jneed/ai-assurance/issues/36
[#60]: https://github.com/ahed-jneed/ai-assurance/issues/60
[#62]: https://github.com/ahed-jneed/ai-assurance/issues/62
[#65]: https://github.com/ahed-jneed/ai-assurance/issues/65
[#67]: https://github.com/ahed-jneed/ai-assurance/issues/67
[#201]: https://github.com/ahed-jneed/ai-assurance/issues/201
[#202]: https://github.com/ahed-jneed/ai-assurance/issues/202
[#203]: https://github.com/ahed-jneed/ai-assurance/issues/203
[#204]: https://github.com/ahed-jneed/ai-assurance/issues/204
[#209]: https://github.com/ahed-jneed/ai-assurance/issues/209
[#210]: https://github.com/ahed-jneed/ai-assurance/issues/210
[#211]: https://github.com/ahed-jneed/ai-assurance/issues/211
[#212]: https://github.com/ahed-jneed/ai-assurance/issues/212
[#216]: https://github.com/ahed-jneed/ai-assurance/issues/216
[#219]: https://github.com/ahed-jneed/ai-assurance/issues/219
[#220]: https://github.com/ahed-jneed/ai-assurance/issues/220
[#221]: https://github.com/ahed-jneed/ai-assurance/issues/221
[#225]: https://github.com/ahed-jneed/ai-assurance/issues/225
[#226]: https://github.com/ahed-jneed/ai-assurance/issues/226
[#227]: https://github.com/ahed-jneed/ai-assurance/issues/227
[#228]: https://github.com/ahed-jneed/ai-assurance/issues/228
[#233]: https://github.com/ahed-jneed/ai-assurance/issues/233
[#234]: https://github.com/ahed-jneed/ai-assurance/issues/234
[#235]: https://github.com/ahed-jneed/ai-assurance/issues/235
[#240]: https://github.com/ahed-jneed/ai-assurance/issues/240
[#241]: https://github.com/ahed-jneed/ai-assurance/issues/241
[#244]: https://github.com/ahed-jneed/ai-assurance/issues/244
[#246]: https://github.com/ahed-jneed/ai-assurance/issues/246
[PR #2]: https://github.com/ahed-jneed/ai-assurance/pull/2
[PR #47]: https://github.com/ahed-jneed/ai-assurance/pull/47
[PR #54]: https://github.com/ahed-jneed/ai-assurance/pull/54
[PR #56]: https://github.com/ahed-jneed/ai-assurance/pull/56
[PR #84]: https://github.com/ahed-jneed/ai-assurance/pull/84
[PR #85]: https://github.com/ahed-jneed/ai-assurance/pull/85
[PR #98]: https://github.com/ahed-jneed/ai-assurance/pull/98
[PR #114]: https://github.com/ahed-jneed/ai-assurance/pull/114
[PR #146]: https://github.com/ahed-jneed/ai-assurance/pull/146
[PR #177]: https://github.com/ahed-jneed/ai-assurance/pull/177
[PR #180]: https://github.com/ahed-jneed/ai-assurance/pull/180
[PR #196]: https://github.com/ahed-jneed/ai-assurance/pull/196
[PR #198]: https://github.com/ahed-jneed/ai-assurance/pull/198
[PR #200]: https://github.com/ahed-jneed/ai-assurance/pull/200
[PR #205]: https://github.com/ahed-jneed/ai-assurance/pull/205
[PR #206]: https://github.com/ahed-jneed/ai-assurance/pull/206
[PR #207]: https://github.com/ahed-jneed/ai-assurance/pull/207
[PR #208]: https://github.com/ahed-jneed/ai-assurance/pull/208
[PR #213]: https://github.com/ahed-jneed/ai-assurance/pull/213
[PR #214]: https://github.com/ahed-jneed/ai-assurance/pull/214
[PR #215]: https://github.com/ahed-jneed/ai-assurance/pull/215
[PR #217]: https://github.com/ahed-jneed/ai-assurance/pull/217
[PR #218]: https://github.com/ahed-jneed/ai-assurance/pull/218
[PR #222]: https://github.com/ahed-jneed/ai-assurance/pull/222
[PR #223]: https://github.com/ahed-jneed/ai-assurance/pull/223
[PR #224]: https://github.com/ahed-jneed/ai-assurance/pull/224
[PR #229]: https://github.com/ahed-jneed/ai-assurance/pull/229
[PR #230]: https://github.com/ahed-jneed/ai-assurance/pull/230
[PR #231]: https://github.com/ahed-jneed/ai-assurance/pull/231
[PR #232]: https://github.com/ahed-jneed/ai-assurance/pull/232
[PR #236]: https://github.com/ahed-jneed/ai-assurance/pull/236
[PR #237]: https://github.com/ahed-jneed/ai-assurance/pull/237

## 3. File-ownership map

### 3.1 Areas

Paths are relative to `site-app/` unless they start with a root folder name.

| Area | Owns |
|---|---|
| **A0 Platform, build and CI** | Root `.gitignore`, `.gitattributes`, `.github/**`, README run/verify sections. `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `next.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`, `.prettierrc`, `.npmrc`, `components.json`, `postcss.config.mjs`. `build/connector-preview-*.mjs`, `scripts/{run-framework,execution-profile,install-ci,npm-install,sites-env,build-verified}.*`, `scripts/connector-preview/**`, `lib/connector-context.ts`, `lib/connector-contract.mts` (the Sites connector runtime, kept by decision D-44; `examples/` and the pnpm installer were removed by [#37](https://github.com/ahed-jneed/ai-assurance/issues/37)). Shared test infrastructure: `tests/integration/_harness.mjs`, `playwright.config.ts`, the e2e persona fixtures |
| **A1 Identity, tenancy and access** | `app/chatgpt-auth.ts`, `build/sites-worker.ts`, `build/sites-vite-plugin.ts`. `lib/identity.ts`, `lib/tenancy.ts`, `lib/http.ts` (split from `lib/store.ts`). `lib/permissions.ts` (new), `app/api/management/route.ts`, `app/management-views.tsx`, `app/member-onboarding.tsx` |
| **A2 Persistence, storage and read models** | `lib/engagement-repo.ts` (from store.ts), `lib/engagement-storage.ts`, `db/**`, `drizzle/**` (serialized), `lib/read-models/**` (GET of `api/workspace`), `app/api/work-inbox/route.ts`, `app/api/workspace-state/route.ts`, `app/api/evidence/route.ts`, `lib/workspace-state.ts` |
| **A3 Audit workflow domain and command API** | `lib/domain/**` (was `lib/domain.ts`), `lib/workflow/**` with `lib/workflow/dispatch.ts` (was `lib/workflow-service.ts`), `lib/workflow-{types,state,seed}.ts`, `lib/evidence-requests.ts`, `lib/{paper,finding,auditor}-workflow.ts`, `lib/work-items.ts`, `lib/work-inbox.ts`, `lib/client-projection.ts`, `lib/report-package.ts`, `lib/commands/**` (POST of `api/workspace`), `app/api/client-submission/route.ts`, `app/api/report-package/route.ts` |
| **A4 Evaluation and diagnostics** | `lib/diagnostics.ts`, `lib/evaluation.ts`, `lib/evaluation-service.ts`, `lib/dataset-card.ts`, `lib/testing-readiness.ts`, `lib/presentation.ts`, `app/testing-lab/**` (split from `app/testing-lab.tsx`, now its entry), `app/dataset-registry.tsx`, `app/testing-readiness.tsx`, `app/procedure-context.tsx`, `app/api/evaluation/dataset/route.ts`, `public/example-predictions.csv` |
| **A5 Assurance workbench, runner and signing** | `app/api/assurance/route.ts`, `app/api/runner/route.ts`, `app/api/dossier/route.ts`, `lib/assurance-{core,packet,store,store-client}.ts`, `lib/dossier.ts`, `lib/workbench-presentation.ts`, `app/assurance-workbench/**` (split from `app/assurance-workbench.tsx`, now its entry), `app/assurance-record-details.tsx`, `app/assurance-register.tsx`, `app/dossier-controls.tsx`, `app/package-integrity.tsx` |
| **A6 Workspace shell, navigation and design system** | `app/workspace/**` (was `app/workspace.tsx`), `app/page.tsx`, `app/layout.tsx`, `app/workspace-navigation.tsx`, `app/workspace-search.tsx`, `app/workspace-types.ts` (→ `lib/api-types.ts`, co-owned with A3), `app/engagement-switcher.tsx`, `app/business-workspace.tsx`, `app/work-inbox.tsx`, `app/next-steps.tsx`, `app/database-toolbar.tsx`, `app/register-controls.tsx`, `app/recoverable-draft.tsx`, all `app/*.css`, `components/**`, `hooks/**`, `vendor/**`, `lib/{navigation-preferences,workspace-links,workspace-preferences,workspace-search,register-views,utils}.ts`, `public/*.svg` |
| **A7 Engagement feature screens** (can be split into 7a program/papers and 7b evidence/findings/reports/client) | `app/audit-program/**` (split from `app/audit-program.tsx`, now its entry), `app/audit-gates.tsx`, `app/audit-registers.tsx`, `app/engagement-overview.tsx`, `app/paper-{editor,register,evidence}.tsx`, `app/revision-comparison.tsx`, `app/evidence-{workspace,details,request-form,requests}.tsx`, `app/finding-{actions,forms}.tsx`, `app/record-details.tsx`, `app/report-{workspace,details}.tsx`, `app/report/page.tsx`, `app/client-portal.tsx`, `lib/{paper,evidence,report}-presentation.ts`, `lib/revision-comparison.ts` |
| **A8 Python engine and worker** | `engine/**`, including the Dockerfile, requirements files, tests and examples |
| **A9 Contracts, methodology and docs** | `schemas/**`, `templates/**`, `docs/**`, root `README.md` (except the run/verify sections), `db/postgres.sql`, `deliverables/**`. `site-app/lib/{catalog,annex-iv-map,obligation-subitems}.json` (generated copies), `site-app/public/tools/**` (generated), `site-app/reference/**` (to be deleted) |

### 3.2 Hot shared files, and the rule for each

| Hot file | Why it conflicts | Rule |
|---|---|---|
| `app/workspace.tsx` | 85 KB: every view, modal, route and handoff | Only A6 edits it until the split in [#5](https://github.com/ahed-jneed/ai-assurance/issues/5). Other areas ask for hook-sized changes. Done: split into `app/workspace/` ([PR #48](https://github.com/ahed-jneed/ai-assurance/pull/48)). |
| `app/api/workspace/route.ts` | About 60 ops plus the GET aggregate | Split into the command registry in [#4](https://github.com/ahed-jneed/ai-assurance/issues/4). After that, A3 owns POST and A2 owns GET. Done: ops in `lib/commands/`, GET in `lib/read-models/workspace-view.ts` ([PR #41](https://github.com/ahed-jneed/ai-assurance/pull/41)). |
| `lib/store.ts` | Identity, persistence, projection and HTTP helpers in one file | Split in [#4](https://github.com/ahed-jneed/ai-assurance/issues/4), led by A1; A2 and A3 take their modules. Done: split by #4, and the barrel deleted by [#70](https://github.com/ahed-jneed/ai-assurance/issues/70) ([PR #169](https://github.com/ahed-jneed/ai-assurance/pull/169)); see section 0. |
| `lib/domain.ts`, `lib/workflow-types.ts` | Types and gates imported by every area | Additive changes only. A3 reviews every change. Gates move to their own file ([#6](https://github.com/ahed-jneed/ai-assurance/issues/6) splits `lib/domain.ts`). Done: `lib/domain/` modules ([PR #44](https://github.com/ahed-jneed/ai-assurance/pull/44)); the `lib/domain.ts` barrel is deleted by [#37](https://github.com/ahed-jneed/ai-assurance/issues/37) ([PR #196](https://github.com/ahed-jneed/ai-assurance/pull/196)). |
| `lib/workflow-service.ts` | 32 ops in one file | Split per aggregate in [#6](https://github.com/ahed-jneed/ai-assurance/issues/6) (A3). Done: `lib/workflow/` modules ([PR #44](https://github.com/ahed-jneed/ai-assurance/pull/44)); the dispatch table moved to `lib/workflow/dispatch.ts` in [PR #196](https://github.com/ahed-jneed/ai-assurance/pull/196). |
| `app/api/assurance/route.ts`, `app/audit-program.tsx`, `app/assurance-workbench.tsx`, `app/testing-lab.tsx` | 35–50 KB each | Split by [#50](https://github.com/ahed-jneed/ai-assurance/issues/50) (the route, with `app/api/management/route.ts`) and [#64](https://github.com/ahed-jneed/ai-assurance/issues/64) (the three screens, last in M3); the review assigned them to A5, A7, A5 and A4 respectively. Done: [PR #53](https://github.com/ahed-jneed/ai-assurance/pull/53) for the routes; [#186](https://github.com/ahed-jneed/ai-assurance/issues/186), [#187](https://github.com/ahed-jneed/ai-assurance/issues/187), [#188](https://github.com/ahed-jneed/ai-assurance/issues/188) and [#193](https://github.com/ahed-jneed/ai-assurance/issues/193) for the screens. |
| `app/globals.css`, the sibling stylesheets, the import order in `app/layout.tsx` | Order-dependent cascade | A6 owns tokens and base styles. Feature styles live in per-area files |
| `app/workspace-types.ts` | Hand-written API contract | Replace with `lib/api-types.ts`; changes go with the op that needs them |
| `package.json`, `package-lock.json` | Every dependency change | A0 batches dependency changes. On rebase, regenerate the lock with `npm install --package-lock-only` rather than merging it by hand |
| `scripts/engagement-lifecycle-check.mjs` | The one API scenario whose parts build on each other | Split by area by [#52](https://github.com/ahed-jneed/ai-assurance/issues/52): access, criteria, inbox and practice management are their own harnesses; add a new area as its own harness on `scripts/harness/worker.mjs` |
| `db/schema.ts`, `drizzle/meta/*` | Migration numbers and snapshots | One migration PR at a time (A2) |
| `tsconfig.tsbuildinfo` | Rewritten by every `tsc` run | Untracked by [#1](https://github.com/ahed-jneed/ai-assurance/issues/1) ([PR #2](https://github.com/ahed-jneed/ai-assurance/pull/2)) |
| `lib/catalog.json` and its root copies | Methodology changes | A9 only; the copies are generated |
| `schemas/test-run.schema.json` and fixtures | Generated, 129 KB | A9 only; regenerate rather than merge |
| `engine/worker_contract.py` ↔ `app/api/runner/route.ts` ↔ `app/api/assurance/route.ts:76` | A contract split across two languages | Change both sides in one PR (A5 and A8 pair on it), or change the schema first and the code after |
| `README.md`, `docs/validation-results.md` | Every PR wants to update status | PRs add `changes/<issue>.md` fragments; A9 consolidates them |

### 3.3 Findings by area

| Area | Findings |
|---|---|
| A0 | F-01, F-11, F-12, F-13, F-14 (repository part), F-15, F-16, F-18, F-60, F-76 |
| A1 | F-02, F-09 (provisioning and quota part), F-19 (persona switcher), F-24, F-43, F-44, F-56 |
| A2 | F-08, F-26, F-27, F-28, F-41, F-42, F-53, F-54 |
| A3 | F-04, F-05, F-20, F-29, F-30, F-31, F-32, F-57, F-61, F-62, F-64, F-65, F-66 |
| A4 | F-06, F-07, F-33, F-58, F-63 |
| A5 | F-03, F-23, F-55 |
| A6 | F-25, F-46, F-47, F-48, F-49, F-70, F-71, F-72, F-74 |
| A7 | F-45, F-69, F-73 |
| A8 | F-10, F-17, F-21, F-34, F-35, F-36, F-37, F-38, F-39, F-40, F-59, F-67, F-68 |
| A9 | F-14 (runtime zip part), F-22, F-50, F-51, F-52, F-77, F-78 |
| Every area | F-75: each area deletes its own dead code |
