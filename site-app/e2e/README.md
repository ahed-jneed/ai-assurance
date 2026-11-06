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
`IDENTITY_MODE=trusted-headers` and `IDENTITY_TRUSTED_HEADERS=loopback-tests`
(`docs/security/identity.md`). It never touches `.wrangler/state`, which
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
CI always starts a fresh server.

## Flows

One spec per flow, so new flows add files instead of editing shared ones:

| Spec | Persona flow and negative checks |
|---|---|
| `lead-creates-engagement.spec.ts` | Lead Auditor creates an engagement for Acme; an Auditor's `createEngagement` is refused |
| `auditor-prepares-paper.spec.ts` | Auditor creates a paper, records results and conclusion, links accepted evidence, saves and submits it |
| `reviewer-reviews-paper.spec.ts` | Reviewer approves the review, the Lead Auditor signs the revision; the author's own review and an Auditor's review are refused |
| `client-contributor.spec.ts` | Client Contributor answers the seeded evidence request in the portal and the audit team sees it; internal commands are refused |
| `client-viewer.spec.ts` | Client Viewer sees accepted, client-shared evidence only; pending and internal evidence is neither listed nor downloadable |
| `isolation.spec.ts` | An outsider is refused the demo practice in the UI and API; no cross-practice reads; practice switching for `qa-lead2`; a stale engagement version is refused |

Setup steps that are not the subject of a spec (an evidence upload before a
paper is written, for example) go through the persona's API client
(`api("qa-auditor")` in `fixtures.ts`), which makes the same calls as the UI.
The specs share one practice, so they run in one worker, in file order.

## Accessibility

`expectAccessible(page, label)` (`a11y.ts`) runs axe with the WCAG 2.x A and AA
rules and fails on serious or critical violations. Known violations are listed
in `TRACKED_EXCEPTIONS` with the issue that fixes them; they appear as
`a11y-exception` annotations in the report instead of failing. Never skip a
check: add an exception with its issue, or fix the violation. To review every
violation, including tracked ones, run with `E2E_A11Y_SURVEY=1`: the survey
prints them instead of failing. #36 fixes the tracked violations and empties
the list.

## In CI

The `e2e` job in `.github/workflows/ci.yml` builds the Worker, restores
Chromium from the cache (keyed by the Playwright version) or downloads it, and
runs the suite. On failure it uploads `playwright-report/` and `test-results/`
(traces and screenshots) as the `playwright-report` artifact.
