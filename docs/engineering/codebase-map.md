# Codebase map

> **Snapshot of `main` at commit `74c6463`, 5 November 2026.** These are sections 1, 2 and 7 of the verified codebase review that the [roadmap](../../ROADMAP.md) was planned from, renumbered 1 to 3. The review combined six subsystem reports (API, persistence and authorization; domain and workflow; UI; tooling and tests; Python engine; docs and methodology) with read-only spot checks of `main`. The research behind the roadmap is in [docs/research/2026-11/](../research/2026-11/README.md).
>
> - **Line numbers refer to commit `74c6463`, before the Prettier reformat** (commit `ef0286f`, merged with [PR #2](https://github.com/ahed-jneed/ai-assurance/pull/2) for [#1](https://github.com/ahed-jneed/ai-assurance/issues/1)). At `74c6463` most `site-app` files were dense single-line code. The reformat moved every `site-app` line number, so find code by the quoted identifiers.
> - **Finding ids (F-xx)** come from the review's findings table, which is not reproduced here. Most roadmap issues quote the ids they fix, and [ROADMAP.md](../../ROADMAP.md) names the findings placed in issues on 5 November 2026 and those deferred to Later.
> - **Counts, sizes and limits** (85 KB files, 17 tables, a 1.5 MB engagement body and so on) describe `74c6463` and will drift. The rules in section 3 are the review's recommendations for parallel work; where an issue says otherwise, the issue wins.
> - **Edits to the review's text.** Apart from the renumbering, twelve lines differ from the review. Nine pointed to review sections not reproduced here (3, 5 and 6.5) or to its Wave 0 and Wave 1 plan; they now point to the README, to the note above, or to the issue or PR that does the work. Three gained issue references: the `hosting.json` setup step, and the `lib/domain.ts` and `lib/workflow-service.ts` rows of section 3.2. The `---` rules between the review's sections were dropped.

## 1. Architecture map

### 1.1 Components

| Component | Where | Responsibility |
|---|---|---|
| Web UI | `site-app/app/*.tsx`: 39 client components; root is `app/workspace.tsx` (85 KB) | React 19 single-page app rendered by Vinext (Vite 8, rolldown, RSC). Navigation is state-driven across 14 views and mirrored to the URL. Components fetch `/api/*` themselves. Built on shadcn/Radix (18 of 61 vendored components are used) and 11 global stylesheets |
| API | `site-app/app/api/*/route.ts`: 11 handlers | `workspace`: GET returns the aggregate view; POST is a command bus with about 26 inline ops plus the 32 `workflowCommand` ops and 6 `evidenceRequestCommand` ops it dispatches. Also `management`, `assurance` (22 ops), `evidence`, `client-submission`, `dossier`, `report-package`, `work-inbox`, `workspace-state`, `evaluation/dataset`, and `runner` (bearer token) |
| Tenancy, authorization and persistence core | `lib/store.ts`, `lib/engagement-storage.ts` | `context()` maps identity to tenant, role, client and practice-admin flag, and auto-provisions new users. `getEngagement()` authorizes and hydrates. `save()` runs the compare-and-swap batch. `sanitize()` builds the client projection. Also `readBounded`, `checkOrigin`, `responseError` |
| Audit domain | `lib/domain.ts`, `lib/workflow-{types,state,service,seed}.ts`, `lib/evidence-requests.ts`, `lib/{paper,finding,auditor}-workflow.ts`, `lib/work-items.ts`, `lib/work-inbox.ts`, `lib/client-projection.ts`, `lib/report-package.ts` | The engagement aggregate, lifecycle gates, brief/program/procedure workflow, independence rules, report approval and release, monitoring |
| Evaluation | `lib/diagnostics.ts`, `lib/evaluation.ts`, `lib/evaluation-service.ts`, `lib/dataset-card.ts`, `lib/testing-readiness.ts` | CSV diagnostics computed inside the Worker (binary, multiclass, regression, plus demographic parity, disparate impact and equalized odds); frozen run manifests |
| Assurance and signing | `lib/assurance-{core,packet,store}.ts`, `lib/dossier.ts`, `lib/signing-keys.ts` | Append-only assurance records, an external job queue with fenced leases, and Ed25519-signed dossiers and briefing packets with wrapped practice keys (`docs/security/signing-keys.md`) |
| Worker entry and build | `build/sites-worker.ts`, `build/sites-vite-plugin.ts`, `vite.config.ts`, `scripts/run-framework.mjs` | Worker fetch wrapper; dev-only mock sign-in; copies `hosting.json` and `drizzle/` into `dist/.openai` |
| Python engine | `engine/` | Stdlib-only diagnostics CLI, a pull worker for `/api/runner` (child process or Docker executor), assurance CLIs (sampling, bootstrap, dossier verify/sign), registry import, cited assistant, runtime packager. 120 unittest cases |
| Contracts | `schemas/` | Draft 2020-12 run contract (1.0 legacy, 1.1 hosted, 1.2 external), procedure-execution and working-paper schemas, and Ajv validators |
| Methodology | `templates/`, `docs/obligation-subitems.json` | 33 working papers and 12 memos, the Annex IV map, 68 obligation prompts. Byte-identical copies in `site-app/lib/` seed the app |
| Specification only | `db/postgres.sql`, `docs/system-architecture.md` | Target PostgreSQL/OIDC/KMS design. Not deployed |
| Copies | `site-app/reference/` (88 files, 5 diverged), `site-app/public/tools/` (runtime zip, plus a verifier identical to `engine/assurance.py`) | Duplicates with no sync check |

### 1.2 Diagram

```
Browser: React 19 SPA (app/workspace.tsx + feature components)
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
   lib/store.ts: context() / getEngagement() / save() / sanitize()                 |
   lib/domain.ts  workflow-*.ts  evidence-requests.ts  diagnostics.ts              |
   evaluation-service.ts  assurance-*.ts  dossier.ts  engagement-storage.ts        |
        |                                    |                                     |
        v                                    v                                     |
   D1 (SQLite): 17 tables,              R2: evidence bytes, content-addressed      |
   drizzle/0000-0004, append-only       report/paper/run blobs, sealed dossiers,   |
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
   - `approveReportPackage` approves both hashes; `releaseReport` releases the client projection.
   - `/api/report-package` re-verifies the digests.
   - `/api/dossier` seals an Ed25519-signed dossier per audience, which can be verified offline with `engine/assurance.py verify`; `/api/dossier/keys` lists the practice's active and retired verification keys, and a practice administrator rotates the key with the management op `rotateSigningKey`.

### 1.4 Storage

**D1: 17 tables** (`db/schema.ts`, migrations `drizzle/0000`–`0004`; no drift between schema and migrations):

| Group | Tables |
|---|---|
| Tenancy and access | `tenants` (version, last_command_id), `memberships` (role, client_id, status), `clients`, `practice_admins`, `engagement_access`, `engagement_access_policies` |
| Engagement aggregate | `engagements` (JSON body up to 1.5 MB, version), `engagement_snapshots` (full body on every save), `audit_events` (hash-chained), `management_events` (not chained) |
| Assurance and execution | `assurance_records`, `execution_jobs`, `execution_attempts`, `runner_workers` (stores only the token's SHA-256), `dossier_keys` (private keys wrapped under the `DOSSIER_KEK` secret since `drizzle/0009`; retired keys keep only the public key) |
| Per user | `personal_preferences`, `workspace_drafts` |

**Invariants.** Append-only triggers protect `audit_events`, `engagement_snapshots`, `management_events`, `assurance_records`, and completed jobs and attempts. Unique indexes on `json_extract` expressions stop revision forks. All of these exist only in hand-written SQL (`0001`, `0003`).

**Hard limits that act as cliffs:**
- an engagement body is capped at 1.5 MB;
- 1,000 assurance records per engagement;
- 150 program revisions;
- 30 revisions per procedure.

**R2** holds evidence bytes; report snapshots, client snapshots, paper histories and run results (content-addressed and SHA-256-checked on every read); sealed dossiers; and runner results.

### 1.5 Identity and authorization

**Production.** OpenAI Sites dispatch injects `oai-authenticated-user-id`, `-email` and (optionally) `-full-name`. `app/chatgpt-auth.ts` trusts these headers without any signature, JWT or session check, and the Worker entry passes them through unchanged. `context()` (`lib/store.ts`) then works as follows:
1. Missing headers return 401.
2. Without an active membership it first accepts the pending invitations for the user's email (`lib/invitations.ts`). If the user has no membership at all and self-signup is allowed (`SELF_SIGNUP`, open only on the development server by default; see `docs/security/identity.md`), it creates `tenant-<sha256(userId)[:24]>`, named after the user ("<name> practice"), with the user as Lead Auditor plus an "Example client" and engagement `ENG-default`; otherwise it returns 403. If the user has only revoked memberships, it returns 403 "access revoked" instead.
3. It loads the active membership.
4. It runs a legacy access-adoption write batch on every request.
5. It sets the `practiceAdmin` flag.

**Roles.** There are five: Auditor, Lead Auditor, Reviewer, Client Viewer, Client Contributor, plus the practice-admin flag.
- Internal roles need a per-engagement `engagement_access` row.
- Client roles are scoped by their membership's `client_id`. Contributors also need an unexpired grant inside the engagement JSON.

**Separation of duties**, enforced on the server:
- an author cannot review their own paper;
- the signer must differ from the reviewer;
- the classifier cannot approve the classification;
- whoever created a finding or wrote its remediation cannot close it;
- the report creator cannot approve the package, and the approver cannot release it;
- contributors to the brief or program cannot approve it.

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

### 2.0 Local environment, sign-in and personas

**One-time setup per checkout or worktree** (commands: the README's "Run locally" section, which since [PR #2](https://github.com/ahed-jneed/ai-assurance/pull/2) applies every migration in `site-app/drizzle/`; at `74c6463` it listed only two of the five, F-15):
1. Create `site-app/.openai/hosting.json` if it is missing. Not needed since [#1](https://github.com/ahed-jneed/ai-assurance/issues/1) merged: [PR #2](https://github.com/ahed-jneed/ai-assurance/pull/2) made the file optional.
2. Run `npm ci`.
3. Run `npm run build`.
4. Apply **all five** migrations to `.wrangler/state`.

**A. One persona, with hot reload (`npm run dev`).**
1. Open `http://localhost:5173/` and click "Sign in with ChatGPT", or go straight to `/signin-with-chatgpt?return_to=/`. You are now `local_seedy` (Seedy, seedy@sites.test).
2. To sign out, go to `/signout-with-chatgpt?return_to=/`. The UI has no sign-out control.

A second identity is impossible in this mode: the mock strips inbound `oai-*` headers and injects only `local_seedy`.

**B. Several personas, using the built Worker (works today with no code change).**
1. Stop `npm run dev` (the two modes share `.wrangler/state`, so run only one at a time) and run `npm start`. The app is at `http://127.0.0.1:8787`.
2. There is no sign-in page. Every request must carry:
   - `oai-authenticated-user-id: <persona>` and `oai-authenticated-user-email: <persona>@example.test` (both required);
   - optionally `oai-authenticated-user-full-name: QA%20Reviewer` with `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`, for a readable display name.
3. Send those headers in one of these ways:
   - **Playwright:** one browser context per persona, created with `browser.newContext({ baseURL: 'http://127.0.0.1:8787', extraHTTPHeaders: {...} })`.
   - **Manual QA:** one browser profile per persona, with a header-injection extension limited to `http://127.0.0.1:8787/*`.
   - **API calls:** curl with the headers. POSTs also need `Origin: http://127.0.0.1:8787` (checked by `checkOrigin`) and `Content-Type: application/json`.
4. Bootstrap the personas:
   1. Load `/` as `qa-lead`. This creates qa-lead's own practice, with qa-lead as Lead Auditor and practice admin.
   2. Create a client "Acme" and a structured engagement for it (flow 2).
   3. In **Members & access → Add member**, grant each persona below by entering its id as the "Signed-in account ID". Do this *before* that persona makes its first request: `grantMember` does not require the user to exist, and a user who already has an active membership does not get a sandbox practice (`lib/store.ts:26-30`). For internal personas, tick the Acme engagement in the Audit access step; for client personas, choose client Acme.

   Note that `local_seedy` is an ordinary user id in this mode.

**C. API-level regression (no server needed).** `node scripts/integration-check.mjs`, run after a build, drives owner, reviewer, viewer and outsider personas through Miniflare.

> **Caveat.** Once the identity adapter from F-02 strips untrusted headers, modes B and C need an explicit local/test "trusted-headers" setting. [#11](https://github.com/ahed-jneed/ai-assurance/issues/11) builds that adapter with a loopback-only `trusted-headers` mode for this purpose.

| Persona | Role (client) | Used for |
|---|---|---|
| `qa-lead` | Lead Auditor and practice admin (self-provisioned) | Setup, stage moves, paper sign-off, report creation and release, dossiers, runner enrolment |
| `qa-auditor` | Auditor | Brief and program preparation, procedures, classification, evidence, findings |
| `qa-reviewer` | Reviewer | Independent approvals: brief, program, procedure review, classification, retest and closure, report package |
| `qa-lead2` | Lead Auditor (optional) | A second signer or releaser when qa-lead prepared the content |
| `qa-contrib` | Client Contributor (Acme) | Client portal submissions |
| `qa-viewer` | Client Viewer (Acme) | Released reports; isolation checks |
| `qa-outsider` | Never granted | Cross-tenant isolation checks |

### Flows

Each flow lists the steps, the expected results, negative checks, and the known defects to watch. **F-xx** ids refer to the review's findings table (see the note at the top). API op names are given in parentheses.

1. **First sign-in and provisioning** (local_seedy or qa-lead)
   1. Open `/`.
   2. Expect the sidebar to show "<name> practice" (for example "QA Lead practice"), the engagement "Example client / New AI assurance engagement", and the identity "… · Lead Auditor". Overview shows the legacy engagement with a paper sign-off counter (0 / 32) and "Set up audit program".
   3. `GET /api/workspace` returns `identity.role:"Lead Auditor"`, `identity.practiceAdmin:true` and `engagement.id:"ENG-default"`.
   4. Reload. The `tenantId` is unchanged.
   - **Negative:** without identity headers (`npm start`), the request returns 401.

2. **Practice setup** (qa-lead)
   1. Clients → New client → Create client.
   2. On the client page: New engagement → Create engagement. A structured engagement opens on Overview at stage Planning.
   3. Gear icon "Engagement settings" → Save engagement (`renameEngagement`).
   4. The new engagement appears in the engagement switcher and in the Engagements directory.
   - **API:** `POST /api/management {tenantId, expectedVersion: managementVersion, op: createClient|createEngagement, data}`.
   - **Negative:** repeating a call with the old `managementVersion` returns 409.

3. **Staff onboarding and revocation** (qa-lead, qa-auditor)
   1. Members & access → Add member. Identity step: display name, account ID `qa-auditor`, tick "Site access has been arranged". Role step: Auditor. Audit access step: tick engagement E. Then Review → Confirm access.
   2. As qa-auditor, only E is listed. `GET /api/workspace?tenantId=T&engagementId=<another>` returns 404.
   3. As qa-lead: Revoke → Revoke access. qa-auditor's next request returns 403 "Your practice access has been revoked…".
   - **Watch F-24:** Restore access without ticking any engagement silently gives back E.

4. **Engagement access** (qa-lead, qa-reviewer)
   1. Assurance workbench → Team & runtime → Manage access. Deactivate qa-reviewer with a reason (`setAccess active:false`).
   2. qa-reviewer gets 404 for that engagement, and an `access_event` record appears in the workbench.
   3. Reactivate qa-reviewer.

5. **Scope: brief and program** (qa-auditor prepares, qa-reviewer approves)
   1. Audit program → Engagement brief → Complete brief → Save scope draft → Submit for review (`saveBrief`, `submitBrief`).
   2. qa-auditor's own approval is blocked with 403 (contributors cannot approve).
   3. qa-reviewer: Request changes (`returnBrief`). qa-auditor resubmits. qa-reviewer: Approve scope (`approveBrief`).
   4. Program tab → Assess candidates → Save scope decisions (`scopeProgramCandidates`). To keep later flows short, mark 2–3 procedures applicable and the rest not applicable with a rationale. WP-RP-02 is a release-time record and never gates capture (F-30 fixed in #14).
   5. Select the rows → Assign & schedule: preparer qa-auditor, reviewer qa-reviewer, due date (`bulkPlanProcedures`) → Submit program → qa-reviewer: Approve program (`approveProgram`).
   - **Expect:** execution is refused until both brief and program are approved.
   - **Watch F-04** (a later due-date edit invalidates every execution) and **F-29** (the 150-revision cap).

6. **Classification** (qa-auditor, qa-reviewer)
   1. Regulatory mapping → Assess classification → answer the facts in each section (yes, no or "needs information") → Save classification (`classify`). Status shows "provisional".
   2. While a required fact is unknown the label reads "Needs information" and "Approve independently" stays disabled, listing what the approval waits for (#19).
   3. qa-auditor clicks "Approve independently" and gets a 403 toast (expected; see F-45).
   4. qa-reviewer approves (`approveClassification`). Status becomes "approved".
   - **F-31 (fixed in #19):** an "Unassessed" route reads "Unassessed" and blocks approval; contradictory route and fact combinations are rejected.

7. **Evidence custody** (qa-auditor)
   1. Evidence vault → Files → Upload evidence, using `public/example-predictions.csv`, category Dataset, and a handling basis → Upload for acceptance. The row shows "Awaiting acceptance" and the response contains the SHA-256.
   2. Open the record → Accept evidence (`acceptEvidence`).
   3. Preview file (UTF-8 text up to 256 KB) and Download file. The `X-Evidence-SHA256` header must equal the upload hash.
   - **Negative:** a stale `expectedVersion` returns 409; a file over 50 MB is rejected.

8. **Procedure execution, review and sign-off** (qa-auditor, qa-reviewer, qa-lead)
   1. Open the procedure sheet. Execute: Record work performed (`recordProcedureExecution`).
   2. Evaluate: Evaluate evidence (`evaluateProcedure`) → Compile paper & send for review (`submitProcedure`).
   3. qa-reviewer returns it with a question (`returnProcedure`). qa-auditor responds and resubmits. qa-reviewer: Approve reviewed work (`reviewProcedure`).
   4. qa-lead: Sign working paper (`signPaper`).
   - **Negative:** the preparer reviewing gets 403; qa-reviewer signing gets 403; editing a signed paper gets 409.
   - **Legacy variant (ENG-default):** editPaper → submitPaper → the author's own review gets 403 → the reviewer comments, the author uses `respondComment`, the reviewer uses `resolveComment` → `reviewPaper` → a different Lead runs `signPaper` → `reopenPaper` clears the approvals.
   - **Watch F-05:** recompiling after sign-off leaves the old signed paper required and published.

9. **Testing lab diagnostics** (qa-auditor)
   1. Testing lab → Download sample CSV. Upload it as Dataset and accept it.
   2. Register version: "Saved predictions (CSV)", "Binary classification" (`createModel`).
   3. Evaluate → wizard:
      - protocol: create new;
      - columns and favourable label;
      - procedures: performance, demographic parity, disparate impact, equalized odds;
      - thresholds, protected-group column, handling basis;
      - the sample's `group` column is synthetic: untick "holds special-category data", or record a client basis under Datasets and choose the hosted route (#60).

      Then Save protocol & run (`createEvaluationProfile`, `queueRun`, `executeRun`).
   4. Evaluations → Results show per-test outcomes, the overall outcome, group tables and auto-drafted Article 10/15 papers.
   - **Watch F-07** (after Workbench → Review & run evaluation, a later evaluation returns 409), **F-33** (the wizard reopens and creates duplicate queued runs), **F-06** (a constant predictor passes).

10. **Evidence requests and client contributor portal** (qa-auditor, qa-lead, qa-contrib)
    1. qa-auditor: Requests → Request evidence → Create request (`createEvidenceRequest`).
    2. qa-lead: Client request access → Assign request to qa-contrib with an expiry (`grantClientRequest`).
    3. qa-contrib: Overview → Your evidence requests → Submit evidence package (1–10 files, at most 10 MB in total; `POST /api/client-submission`). The package shows "Awaiting receipt acknowledgment". Ask a question → Send reply.
    4. qa-auditor: Acknowledge receipt (`acknowledgeClientSubmission`) → Assess evidence (`assessEvidenceRequest`).
    5. qa-lead: Revoke (`revokeClientRequest`). The contributor's next submission returns 403 and the engagement returns 404.
    6. qa-lead: Record limitation (`closeEvidenceRequest`; this creates a limitation memo) → Reopen request.
    - **Watch F-62** (the memo stays required) and **F-72** (contributors see practice navigation).

11. **Findings and remediation** (qa-auditor, qa-reviewer, qa-lead)
    1. New finding, with the calculated risk preview → Record finding (`createFinding`).
    2. Update remediation → set "Ready for retest" (`updateFinding`).
    3. qa-reviewer: Support & retest → Record independent retest (`recordFindingRetest`) → Close verified finding (`closeFinding`).
    4. qa-lead: Reopen finding (`reopenFinding`).
    - **Negative:** the creator or remediator closing the finding gets 403.

12. **Stages, final report, approval, release, withdrawal** (qa-lead, qa-reviewer, qa-viewer)
    - **Preconditions:**
      - The engagement is structured. For a legacy engagement, run Adopt workflow first: `releaseReport` needs a workflow snapshot.
      - Brief, program and classification are approved.
      - Every selected applicable procedure is reviewed and signed.
      - No run is queued or running.
    1. Overview → Move to Fieldwork → … → Sign-off (`setStage`). Skipping a stage or moving backwards is blocked.
    2. Reports & sign-off → Prepare final snapshot (`createReport kind:"final"`).
    3. Integrity & downloads → Verify captured content. `GET /api/report-package` returns `proof.valid:true`. Also use Preview exact client package.
    4. qa-lead clicking Approve package gets 403 (creator). qa-reviewer approves (`approveReportPackage` with both hashes).
    5. qa-reviewer trying to release gets 403 (role). qa-lead: Release to client (`releaseReport`).
    6. qa-viewer sees the package and can Print (`/report?tenantId&engagementId&reportId`). `/api/report-package?download=1` returns `proof.valid:true`.
    7. qa-lead: Withdraw (`withdrawReport`). The client loses access.
    - **Expect:** a second release supersedes the first automatically and records a client notification (F-32, fixed in #14); WP-RP-02 and MEM-SO-01 never gate capture (F-30).

13. **Client and tenant isolation** (qa-viewer, qa-outsider)
    1. qa-viewer sees only Acme engagements; client-visible accepted evidence only; no Requests tab.
    2. A deep link to an internal paper shows "This page is outside your current access". An internal `artifactId` returns 404. `GET /api/assurance` and `/api/work-inbox` return 403. Another client's engagement returns 404.
    3. qa-outsider: `GET /api/workspace?tenantId=<qa-lead tenant>` returns 403.

14. **Dossier sealing and verification** (qa-lead, qa-viewer)
    1. Seal internal dossier (`POST /api/dossier {op:"seal", audience:"internal"}`). After release, also seal the client audience.
    2. Download with `GET /api/dossier?…&audience=…`, then run `python -m engine.assurance verify --dossier dossier.json`. Add `--trusted-keys trust.json --require-trusted-signature` to check against a pinned key. Flip one byte and confirm verification rejects it. Verification needs `cryptography` installed (F-17).
    3. A client download before sealing returns a raw 409 JSON page (F-71).

15. **External runner** (qa-lead, qa-auditor, operator)
    1. Team & runtime → Enroll runner (`enrollWorker`). The token is shown once.
    2. qa-auditor: Execution → Review external execution plan → Freeze execution request (`queueExternal`).
    3. Operator, with Python 3.12: set `ASSURANCE_SITE_ORIGIN` (HTTPS only), `ASSURANCE_WORKER_TOKEN`, `ASSURANCE_WORKER_ID` and `ASSURANCE_WORKER_IMAGE_DIGEST=sha256:<64 hex>`, then run `python -m engine.worker --workspace jobs --once`. Expect `{"state":"completed"}`.
    4. qa-auditor: Compile draft paper (`importJob`). Expect a 1.2 run and a supplementary draft paper.
    - **Locally:** the CLI refuses `http://`. Use `ASSURANCE_TEST_PYTHON=python node scripts/assurance-integration-check.mjs`, which runs its own loopback proxy, or put a TLS proxy in front of `npm start`.
    - **Negative:** `cancelJob` while the job runs makes the worker's later complete return 409.
    - **Watch F-34** and **F-36**.

16. **My work, search, navigation, drafts** (qa-auditor, qa-lead)
    1. My work: views, filters, snooze with Undo, and the Lead-only "Team workload" scope. `GET /api/work-inbox?tenantId&page=0` lists only granted engagements, and the last page has `nextPage:null`.
    2. Ctrl/Cmd+K search; Back/Forward restores the view and filters.
    3. Recovery draft: edit a paper, reload, then Restore draft. After another user saves a new revision, the draft reports `current:false`. Editing in two tabs shows "This paper has a newer revision".

17. **Monitoring and follow-up** (qa-auditor, qa-reviewer, qa-lead)
    Follow-up tab → New case (`createMonitoringCase`) → Record assessment (`assessMonitoringCase`) → Open reassessment (`openFollowup`) → an independent user closes it (`closeMonitoringCase`) → Plan next cycle.
    - **Watch F-66:** a case assessed without evidence cannot be closed.

## 3. File-ownership map

### 3.1 Areas

Paths are relative to `site-app/` unless they start with a root folder name.

| Area | Owns |
|---|---|
| **A0 Platform, build and CI** | Root `.gitignore`, `.gitattributes`, `.github/**`, README run/verify sections. `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `next.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`, `.prettierrc`, `.npmrc`, `components.json`, `postcss.config.mjs`. `build/connector-preview-*.mjs`, `scripts/{run-framework,execution-profile,install-ci,npm-install,sites-env,build-verified,install-pnpm,pnpm-install}.*`, `scripts/connector-preview/**`, `lib/connector*.{ts,mts}`, `examples/**`. Shared test infrastructure: `tests/integration/_harness.mjs`, `playwright.config.ts`, the e2e persona fixtures |
| **A1 Identity, tenancy and access** | `app/chatgpt-auth.ts`, `build/sites-worker.ts`, `build/sites-vite-plugin.ts`. `lib/store.ts`, until split into `lib/{identity,tenancy,http}.ts`. `lib/permissions.ts` (new), `app/api/management/route.ts`, `app/management-views.tsx`, `app/member-onboarding.tsx` |
| **A2 Persistence, storage and read models** | `lib/engagement-repo.ts` (from store.ts), `lib/engagement-storage.ts`, `db/**`, `drizzle/**` (serialized), `lib/read-models/**` (GET of `api/workspace`), `app/api/work-inbox/route.ts`, `app/api/workspace-state/route.ts`, `app/api/evidence/route.ts`, `lib/workspace-state.ts` |
| **A3 Audit workflow domain and command API** | `lib/domain.ts` (→ `lib/domain/**`), `lib/workflow-{types,state,service,seed}.ts` (→ `lib/workflow/**`), `lib/evidence-requests.ts`, `lib/{paper,finding,auditor}-workflow.ts`, `lib/work-items.ts`, `lib/work-inbox.ts`, `lib/client-projection.ts`, `lib/report-package.ts`, `lib/commands/**` (POST of `api/workspace`), `app/api/client-submission/route.ts`, `app/api/report-package/route.ts` |
| **A4 Evaluation and diagnostics** | `lib/diagnostics.ts`, `lib/evaluation.ts`, `lib/evaluation-service.ts`, `lib/dataset-card.ts`, `lib/testing-readiness.ts`, `lib/presentation.ts`, `app/testing-lab.tsx`, `app/dataset-registry.tsx`, `app/testing-readiness.tsx`, `app/procedure-context.tsx`, `app/api/evaluation/dataset/route.ts`, `public/example-predictions.csv` |
| **A5 Assurance workbench, runner and signing** | `app/api/assurance/route.ts`, `app/api/runner/route.ts`, `app/api/dossier/route.ts`, `lib/assurance-{core,packet,store,store-client}.ts`, `lib/dossier.ts`, `lib/workbench-presentation.ts`, `app/assurance-workbench.tsx`, `app/assurance-record-details.tsx`, `app/assurance-register.tsx`, `app/dossier-controls.tsx`, `app/package-integrity.tsx` |
| **A6 Workspace shell, navigation and design system** | `app/workspace.tsx` (→ `app/workspace/**`), `app/page.tsx`, `app/layout.tsx`, `app/workspace-navigation.tsx`, `app/workspace-search.tsx`, `app/workspace-types.ts` (→ `lib/api-types.ts`, co-owned with A3), `app/engagement-switcher.tsx`, `app/business-workspace.tsx`, `app/work-inbox.tsx`, `app/next-steps.tsx`, `app/database-toolbar.tsx`, `app/register-controls.tsx`, `app/recoverable-draft.tsx`, all `app/*.css`, `components/**`, `hooks/**`, `vendor/**`, `lib/{navigation-preferences,workspace-links,workspace-preferences,workspace-search,register-views,utils}.ts`, `public/*.svg` |
| **A7 Engagement feature screens** (can be split into 7a program/papers and 7b evidence/findings/reports/client) | `app/audit-program.tsx` (→ `app/audit-program/**`), `app/audit-gates.tsx`, `app/audit-registers.tsx`, `app/engagement-overview.tsx`, `app/paper-{editor,register,evidence}.tsx`, `app/revision-comparison.tsx`, `app/evidence-{workspace,details,request-form,requests}.tsx`, `app/finding-{actions,forms}.tsx`, `app/record-details.tsx`, `app/report-{workspace,details}.tsx`, `app/report/page.tsx`, `app/client-portal.tsx`, `lib/{paper,evidence,report}-presentation.ts`, `lib/revision-comparison.ts` |
| **A8 Python engine and worker** | `engine/**`, including the Dockerfile, requirements files, tests and examples |
| **A9 Contracts, methodology and docs** | `schemas/**`, `templates/**`, `docs/**`, root `README.md` (except the run/verify sections), `db/postgres.sql`, `deliverables/**`. `site-app/lib/{catalog,annex-iv-map,obligation-subitems}.json` (generated copies), `site-app/public/tools/**` (generated), `site-app/reference/**` (to be deleted) |

### 3.2 Hot shared files, and the rule for each

| Hot file | Why it conflicts | Rule |
|---|---|---|
| `app/workspace.tsx` | 85 KB: every view, modal, route and handoff | Only A6 edits it until the split in [#5](https://github.com/ahed-jneed/ai-assurance/issues/5). Other areas ask for hook-sized changes |
| `app/api/workspace/route.ts` | About 60 ops plus the GET aggregate | Split into the command registry in [#4](https://github.com/ahed-jneed/ai-assurance/issues/4). After that, A3 owns POST and A2 owns GET |
| `lib/store.ts` | Identity, persistence, projection and HTTP helpers in one file | Split in [#4](https://github.com/ahed-jneed/ai-assurance/issues/4), led by A1; A2 and A3 take their modules |
| `lib/domain.ts`, `lib/workflow-types.ts` | Types and gates imported by every area | Additive changes only. A3 reviews every change. Gates move to their own file ([#6](https://github.com/ahed-jneed/ai-assurance/issues/6) splits `lib/domain.ts`) |
| `lib/workflow-service.ts` | 32 ops in one file | Split per aggregate in [#6](https://github.com/ahed-jneed/ai-assurance/issues/6) (A3) |
| `app/api/assurance/route.ts`, `app/audit-program.tsx`, `app/assurance-workbench.tsx`, `app/testing-lab.tsx` | 35–50 KB each | Split by [#50](https://github.com/ahed-jneed/ai-assurance/issues/50) (the route, with `app/api/management/route.ts`) and [#64](https://github.com/ahed-jneed/ai-assurance/issues/64) (the three screens, last in M3); the review assigned them to A5, A7, A5 and A4 respectively |
| `app/globals.css`, the sibling stylesheets, the import order in `app/layout.tsx` | Order-dependent cascade | A6 owns tokens and base styles. Feature styles live in per-area files |
| `app/workspace-types.ts` | Hand-written API contract | Replace with `lib/api-types.ts`; changes go with the op that needs them |
| `package.json`, `package-lock.json` | Every dependency change | A0 batches dependency changes. On rebase, regenerate the lock with `npm install --package-lock-only` rather than merging it by hand |
| `scripts/integration-check.mjs` | 53 KB holding every API assertion | Split into per-area specs (A0) by [#52](https://github.com/ahed-jneed/ai-assurance/issues/52) |
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
