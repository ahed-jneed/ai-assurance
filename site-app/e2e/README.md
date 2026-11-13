# Persona end-to-end suite

Playwright drives the workspace as the development personas of
`fixtures/dev-personas.json`, one browser context per persona, with axe
accessibility checks on the views each flow visits.

## Run it

```sh
npm run build                        # the suite runs the built Worker
npx playwright install chromium      # once per Playwright version
npm run test:e2e
npm run test:e2e -- e2e/client-viewer.spec.ts   # one flow
npx playwright show-report           # the HTML report of the last run
```

`playwright.config.ts` starts `e2e/server.mjs` on `127.0.0.1:8790` (set
`E2E_PORT` for another port). The server deletes `.wrangler/e2e-state`, applies
every migration with `npm run db:migrate:local -- --persist-to
.wrangler/e2e-state`, and starts the built Worker with
`IDENTITY_MODE=trusted-headers`, `IDENTITY_TRUSTED_HEADERS=loopback-tests` and
`SELF_SIGNUP=@personas.test` (`docs/security/identity.md`): self-signup is off
outside the development server, so only the persona domain may provision the
practices the specs expect. It also sets a random `DOSSIER_KEK` for the run,
so the dossier and signing-key specs can seal (`docs/security/signing-keys.md`);
the keys it wraps live only in the run's database. One suite runs per checkout
at a time: a second server would delete the first one's `.wrangler/e2e-state`.
It never touches `.wrangler/state`, which
`npm run dev` and `npm start` use. Each persona's browser context and API client
send that persona's `oai-authenticated-user-*` headers; the Worker trusts them
only for loopback requests in this mode.

The `seed` project runs first: `scripts/seed-demo.mjs --trusted-headers` creates
the demo practice (the client Acme, the engagement "Acme credit scoring model
audit", every persona's membership and grant, and the evidence request assigned
to `qa-contrib`), and a second run checks that seeding is idempotent.

Outside CI, an already running server on the port is reused, so you can keep
`node e2e/server.mjs` running between runs. Its database then keeps the records
of earlier runs; the specs create uniquely named records, so they still pass.
A reused server must be `node e2e/server.mjs`: any other server on the port
(`npm run dev`, `npm start`) is not in trusted-headers mode, ignores the persona
headers, and every spec then fails with confusing sign-in or 403 errors. CI
always starts a fresh server.

## Flows

One spec per flow, so new flows add files instead of editing shared ones:

| Spec | Persona flow and negative checks |
|---|---|
| `lead-creates-engagement.spec.ts` | Lead Auditor creates an engagement for Acme; an Auditor's `createEngagement` is refused |
| `auditor-prepares-paper.spec.ts` | Auditor creates a paper, records results and conclusion, links accepted evidence, saves and submits it |
| `reviewer-reviews-paper.spec.ts` | Reviewer approves the review, the Lead Auditor signs the revision; the author's own review and an Auditor's review are refused |
| `client-contributor.spec.ts` | Client Contributor answers the seeded evidence request in the portal and the audit team sees it; internal commands are refused |
| `client-viewer.spec.ts` | Client Viewer sees accepted, client-shared evidence only; pending and internal evidence is neither listed nor downloadable |
| `self-approval.spec.ts` | The Lead Auditor who classified the system or prepared the engagement brief cannot approve it; the Reviewer's approval of the classification succeeds |
| `quality-reviewer.spec.ts` | The Lead Auditor appoints `qa-eqr` as Engagement Quality Reviewer (an Auditor cannot be appointed); the reviewer records a stand-back checklist item in the Quality review tab; the reviewer's paper edits and the Lead's checklist save are refused |
| `report-settings.spec.ts` | The Lead Auditor, a practice administrator, saves the practice's report settings; the report form shows them for blank fields, and a readiness draft with gaps asks for the gaps and is captured as not assurance with the settings; an Auditor's `setReportSettings` is refused |
| `pack-features.spec.ts` | On an engagement of the NYC Local Law 144 pack the Testing lab shows the LL144 panel (not on the AI Act demo engagement), a finding names a clause of the pack as its primary reference, and a draft captured with open gates states the "draft, gates open" caveat (#144) |
| `assurance-workbench.spec.ts` | Lead Auditor records an assertion whose source is found by a server search in the source picker; the record opens by id and shows the Reviewer's confirmation; the workbench never pages through every record |
| `art50-paper-suggestion.spec.ts` | The Lead Auditor classifies a new engagement's provider chatbot; the Art 50 paper WP-XC-07 shows the suggested applicability and the statistical criteria with their threshold-library entries; "Use in plan" fills in the plan form, and cancelling it records nothing; the marking paper WP-XC-10 is suggested as not applicable in the program list |
| `isolation.spec.ts` | An outsider is refused the demo practice in the UI and API; no cross-practice reads; practice switching for `qa-lead2`; a stale engagement version is refused |
| `scope-and-program.spec.ts` | The Lead Auditor completes and submits the engagement brief, the Reviewer approves it; the Auditor submits the audit program, the Reviewer approves it; the preparers' own approvals are refused |
| `classification.spec.ts` | The Lead Auditor answers the guided classification of an Annex III deployer in Regulatory mapping; their own approval is refused in the UI; the Reviewer approves it. Its axe checks cover the Risk classification panel: the criteria coverage grid below it loads on its own schedule and has untracked violations (follow-up for #36) |
| `testing-lab.spec.ts` | The Auditor registers a saved-predictions model version from an accepted dataset, starts a queued evaluation and reads its results |
| `evidence-requests.spec.ts` | The Auditor requests evidence for a paper, the Lead grants it to `qa-contrib` (the contributor cannot grant it), the contributor submits a complete package in the portal, the Auditor accepts the files and assesses the request as sufficient |
| `report-release.spec.ts` | On an engagement in Sign-off, the Reviewer approves both exact packages of a final report and the Lead releases it; a second release supersedes it, and the client reads both, linked; release before approval, the creator's approval and a stale package digest are refused |
| `dossier.spec.ts` | The Lead seals the internal and client dossiers of a released report and a scoped internal export of its procedure; each download carries the recorded signing key, the scoped one its scope; a Reviewer cannot seal, a client reader receives only the client dossier |
| `practice-administration.spec.ts` | The administrator invites by email and cancels the invitation, makes `qa-lead2` an administrator and removes it, and rotates the signing key; a non-administrator Lead is refused each of these |
| `self-review.spec.ts` | A Lead Auditor who prepared a procedure is offered no review and the API refuses it, while the assigned Reviewer approves it in the Review tab; a Lead who edited an Auditor's paper cannot review it after the Auditor's later revision makes the Auditor its author again (the contributor rule) |
| `stale-versions.spec.ts` | An approval on an engagement that changed since the page loaded is refused with "Reload before saving" and succeeds after a reload; approving a superseded scope revision, saving a plan opened before its assignment changed and a management change at a stale directory version are refused |
| `cross-tenant.spec.ts` | Every read and write route refuses `qa-outsider` on the demo practice without leaking its names; `qa-lead2` cannot use the demo client or engagement ids in their own practice |

Setup steps that are not the subject of a spec (an evidence upload before a
paper is written, for example) go through the persona's API client
(`api("qa-auditor")` in `fixtures.ts`), which makes the same calls as the UI.
The specs share one practice, so they run in one worker, in file order.

A flow that moves an engagement through its lifecycle (scope, program,
classification, acceptance, stages, reports) works on a new engagement of the
demo client, so the shared demo engagement keeps the state the other specs
expect. `engagement.ts` builds such an engagement through the API, step by
step: `newEngagement` and `joinTeam`, `approvedScope`, `approvedProgram` (all
candidate procedures out of scope except one manual procedure, `WP-A09-01`),
`acceptedEngagement`, `engagementInFieldwork` and `engagementInSignOff`, where
a final readiness report can be captured (`finalReport`). The spec then drives
the step it is about through the UI.

## Waiting for results

A spec that checks the effect of a UI command through the API waits for the
Worker's answer to that command first: `runCommand(page, op, () => click())`
(`fixtures.ts`) clicks and waits for the `POST /api/workspace` response of
that `op`, and fails on any status but 200. Only then does it read through the
API, once, without `expect.poll`. In #119 a spec polled through the API while
the UI's save was still in flight; that read was never answered, the poll timed
out after 10 s, and the Worker logged `Network connection lost` when the test
tore the hung request down. Never wait on a timer, and never read while the
UI's command is unanswered.

`runCommand` also takes the status a refusal answers with
(`{ status: 403 }`) and the command route (`{ path: "/api/management" }` for
practice administration).

Every check that the page shows something waits for one specific element
(`toBeVisible()` on a dialog-scoped locator, `toBeEnabled()` on the button the
spec clicks next) before axe runs or the spec acts: a page that is still
loading shows a skeleton, whose markup axe reports, and a locator that matches
both a list entry and the open record sheet can find the hidden one first.

The suite runs with `retries: 0`, locally and in CI, so a flaky spec fails the
run instead of passing on a second attempt. CI runs every spec twice
(`--repeat-each=2`) on one database, so a spec must also pass on a database
that holds the records of its earlier run: create uniquely named records, and
never expect a list to be empty or a form to start blank. The API clients time out a request
after 15 s, so a request the Worker never answers fails with its URL instead of
an anonymous test timeout.

## Accessibility

`expectAccessible(page, label)` (`a11y.ts`) runs axe with the WCAG 2.x A and AA
rules and fails on serious or critical violations. Known violations are listed
in `TRACKED_EXCEPTIONS` with the issue that fixes them; they appear as
`a11y-exception` annotations in the report instead of failing. Each exception is
scoped: `maxNodes` caps the failing elements one check may have, and an optional
`selector` names the elements it covers, so a new violation of the same rule
elsewhere still fails. Never skip a
check: add an exception with its issue, or fix the violation. A check of a
modal dialog passes `{ include: "[role=dialog]" }`: the page behind it is
checked on its own, and counting its elements again would push a tracked
exception past its `maxNodes`. To review every
violation, including tracked ones, run with `E2E_A11Y_SURVEY=1`: the survey
prints them instead of failing. #36 fixes the tracked violations and empties
the list.

## In CI

The `e2e` job in `.github/workflows/ci.yml` builds the Worker, restores
Chromium's headless shell from the cache (keyed by the Playwright version; a
new version restores the latest earlier cache through `restore-keys`) or
downloads it with `npx playwright install --only-shell chromium`, and runs the
suite with every spec twice. Only runs on `main` save the browser cache: a
cache a pull request saves is visible to that pull request only. It skips
`--with-deps`: the runner image has Chromium's libraries, and
the optional font packages it would add took ten minutes from the apt mirror. On failure it uploads `playwright-report/` and `test-results/`
(traces and screenshots) as the `playwright-report` artifact.

## Local migrations

The server applies the migrations with `npm run db:migrate:local`, which
identifies each applied migration by the SHA-256 of its content, not only its
file name (`site-app/README.md`). The suite always starts from an empty
database, so a renamed or edited migration never meets an earlier record here;
on a reused `.wrangler/state`, an edited one stops the run naming the file.
