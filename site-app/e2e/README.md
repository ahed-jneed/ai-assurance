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
practices the specs expect. It never touches `.wrangler/state`, which
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
| `isolation.spec.ts` | An outsider is refused the demo practice in the UI and API; no cross-practice reads; practice switching for `qa-lead2`; a stale engagement version is refused |

Setup steps that are not the subject of a spec (an evidence upload before a
paper is written, for example) go through the persona's API client
(`api("qa-auditor")` in `fixtures.ts`), which makes the same calls as the UI.
The specs share one practice, so they run in one worker, in file order.

## Waiting for results

A spec that checks the effect of a UI command through the API waits for the
Worker's answer to that command first: `runCommand(page, op, () => click())`
(`fixtures.ts`) clicks and waits for the `POST /api/workspace` response of
that `op`, and fails on any status but 200. Only then does it read through the
API, once, without `expect.poll`. An API read sent while the UI's save is still
in flight races that save: in #119 such a read was never answered, the poll
timed out after 10 s, and the Worker logged `Network connection lost` when the
test tore the hung request down. Never wait on a timer.

The suite runs with `retries: 0`, locally and in CI, so a flaky spec fails the
run instead of passing on a second attempt. The API clients time out a request
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
check: add an exception with its issue, or fix the violation. To review every
violation, including tracked ones, run with `E2E_A11Y_SURVEY=1`: the survey
prints them instead of failing. #36 fixes the tracked violations and empties
the list.

## In CI

The `e2e` job in `.github/workflows/ci.yml` builds the Worker, restores
Chromium's headless shell from the cache (keyed by the Playwright version) or
downloads it with `npx playwright install --only-shell chromium`, and runs the
suite. It skips `--with-deps`: the runner image has Chromium's libraries, and
the optional font packages it would add took ten minutes from the apt mirror. On failure it uploads `playwright-report/` and `test-results/`
(traces and screenshots) as the `playwright-report` artifact.
