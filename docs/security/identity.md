# Identity: trust boundary runbook

The workspace never decides on its own whom to trust. The Worker entry (`site-app/build/sites-worker.ts`) runs the identity adapter (`site-app/lib/identity.ts`) before the app sees a request. The Worker variable `IDENTITY_MODE` selects the one credential that is trusted. **With no mode configured, nothing is trusted:** every request is anonymous and the API answers 401. An unknown or incomplete mode behaves the same way and logs the problem once per isolate (`Identity: ...`). The one exception is the Sites build, which uses `sites` while `IDENTITY_MODE` is unset (see below).

## Modes

| `IDENTITY_MODE` | Trusted credential | Where to use it | Also requires |
|---|---|---|---|
| *(unset)* | nothing (401) | the safe default of every build except the Sites build | — |
| `sites` | `oai-authenticated-user-*` headers | OpenAI Sites only: dispatch strips inbound copies and sets them | set by the Sites build, as a Worker variable and as its compiled-in default |
| `cloudflare-access` | `Cf-Access-Jwt-Assertion`, an RS256 JWT from Cloudflare Access | Cloudflare Workers and custom domains behind an Access application | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` |
| `trusted-headers` | `oai-authenticated-user-*` headers sent by a test client | the Miniflare harnesses and local end-to-end tests | `IDENTITY_TRUSTED_HEADERS=loopback-tests`; loopback requests only |
| `dev` | headers set by the dev server's persona sign-in | `npm run dev` only | the development server (compiled out of builds); loopback requests only |

**Why headers are stripped.** Any client can send `oai-authenticated-user-id`. Only Sites dispatch removes forged copies before the Worker sees the request, so outside `sites` mode those headers are an authentication bypass (F-02). Outside `sites` mode, the Worker entry removes every inbound `oai-*` header before the app runs. App code reads the caller through `currentUser()` (`lib/identity.ts`), never from headers. `/api/runner` keeps its own bearer-token authentication and does not use the user identity.

**Loopback** means that the request URL's host is `127.0.0.1`, `localhost` or `::1` and that `CF-Connecting-IP`, if present, is a loopback address. On Cloudflare, the edge routes only the Worker's own hostnames and sets `CF-Connecting-IP` to the real client, so a deployed Worker never passes this check. In a local runtime (`wrangler dev`, `npm start`, Miniflare) the check cannot tell which machine connected: the Worker sees the `Host` the client sent and a `CF-Connecting-IP` that is loopback, missing or also sent by the client. There, **the listener's bind address is what keeps other machines out** (`npm start` binds `127.0.0.1`). Never combine `trusted-headers` with `--ip 0.0.0.0`, a LAN listener or a tunnel, and never enable it on a host that is not your own machine. The `dev` mode does not rely on this check: the dev server checks the socket address itself and removes inbound identity headers.

## Which mode is configured where

`site-app/vite.config.ts` writes the mode into the Worker variables:

- **`npm run dev`** (portable profile): `IDENTITY_MODE=dev`, with the loopback persona mock. The managed-linux profile has no mock and no mode, so it answers 401.
- **The Sites build:** `npm run build` in a checkout with `.openai/hosting.json` (a Sites project) writes `IDENTITY_MODE=sites` into `dist/server/wrangler.json`. It also compiles `sites` in as the default while `IDENTITY_MODE` is unset (a `define` in `vite.config.ts`), so the Site does not depend on the Sites publisher applying those variables. An explicit `IDENTITY_MODE`, such as `--var IDENTITY_MODE:cloudflare-access`, still wins.
- **Any other build** (clean clones, CI) configures no mode and has no default, so the build answers 401 until its deployment sets one. Never deploy a Sites build anywhere except Sites: it trusts dispatch headers even when no variable is set.

Local overrides go in `site-app/.dev.vars` for the dev server, or are passed as `--var` to Wrangler for the built Worker, for example `npm start -- --var IDENTITY_MODE:trusted-headers --var IDENTITY_TRUSTED_HEADERS:loopback-tests`.

**The sign-in label follows the build.** The signed-out screen says "Sign in with ChatGPT" only in the Sites build and on the development server, where Sites dispatch or its local mock signs the user in. Every other build, such as a Cloudflare Access deployment, says "Sign in". The label is compiled in from the same `define` as the Sites default (`signInLabel()` in `site-app/lib/auth-paths.ts`). It is text only: the browser reads nothing new to choose it, and it changes nothing about whom the Worker trusts.

## Configure Cloudflare Access

1. In Cloudflare Zero Trust, create a **self-hosted Access application** that covers the Worker's hostname, with the identity providers and policies of your practice. Copy the application's **Audience (AUD) tag**. Your **team domain** is `<team>.cloudflareaccess.com`.
2. Add a **Bypass** (or service-token) policy for `/api/runner*`. Runners authenticate with their own bearer tokens and carry no Access session.
3. Build in a clean clone, not a Sites checkout, so that a missing variable means 401 rather than `sites`. Deploy with the identity variables:

   ```sh
   npm run build
   npx wrangler deploy --config dist/server/wrangler.json \
     --var IDENTITY_MODE:cloudflare-access \
     --var CF_ACCESS_TEAM_DOMAIN:<team>.cloudflareaccess.com \
     --var CF_ACCESS_AUD:<aud-tag>
   ```

   `CF_ACCESS_AUD` may list several comma-separated tags. Neither value is a secret.
4. Check the deployment: a request without the Access cookie must be stopped by Access. A request with a forged `oai-authenticated-user-id` header must still get 401 from `/api/workspace`. Because the Worker verifies the token itself, a hostname that bypasses Access (such as `*.workers.dev`) stays anonymous, and its `/signin-with-chatgpt` answers 401; disable it anyway.

The Worker verifies each token's RS256 signature against the team keys at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. It checks the issuer, the audience and the validity window (with 30 seconds of clock skew allowed for `nbf`/`iat`), then maps `sub` to the user ID, plus `email` and the optional `name`. Tokens with any other algorithm (including `none` and `HS256`), an unknown key ID, a bad signature, or no user (service tokens) are refused. The key set is cached for an hour. An unknown key ID triggers at most one refetch a minute, and a failed fetch is retried after 5 seconds. Until a fetch succeeds, requests are refused (fail closed).

Access signs the user in before a request reaches the Worker, so `/signin-with-chatgpt` only returns to the return path, and only when the request carries a verified token. Without one (a hostname Access does not cover, a wrong `CF_ACCESS_AUD` or team domain, or no signing keys) it answers 401 (`Cloudflare Access did not authenticate this request.`), because a redirect would send the visitor back to the page that asked for sign-in, in a loop. The Worker then logs `Identity: sign-in on <host> has no verified Cloudflare Access token` once per isolate. `/signout-with-chatgpt` redirects to `/cdn-cgi/access/logout`.

## Development personas and the demo practice

Persona sign-in exists only in the dev server (`build/sites-vite-plugin.ts`) and only for loopback requests. Builds contain neither the mechanism nor the persona fixture; `scripts/identity-check.mjs` checks the build output for this.

- `/signin-with-chatgpt?return_to=/` signs in as the default local identity (`local_seedy`).
- `/signin-with-chatgpt?as=<persona>&return_to=/` signs in as `qa-lead`, `qa-auditor`, `qa-reviewer`, `qa-lead2`, `qa-contrib`, `qa-viewer` or `qa-outsider` (`site-app/fixtures/dev-personas.json`). The account menu offers the same switch, and the signed-out screen lists the personas.
- The sign-in cookie is named for the dev server's port: `__sites_local_auth_<port>`, for example `__sites_local_auth_5173`. Cookies ignore the port, so with a single name, dev servers on different ports of `127.0.0.1` would share one sign-in and sign each other in and out. Each server reads and clears only its own cookie and keeps every local sign-in cookie away from the app. A server restarted on the same port keeps its sign-in. On another port, you sign in again. The cookie is otherwise unchanged: `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, and the value `1` for the default identity or a persona id.
- With `npm run dev` running, `npm run seed:demo` (from `site-app/`) provisions qa-lead's practice through the app's own API. The practice has the client "Acme", a structured engagement, every persona's membership and engagement grant, and an evidence request assigned to `qa-contrib`. `qa-lead2` also leads a practice of their own, so practice switching is reachable. `qa-outsider` stays outside the practice. Run the seed before signing in as a persona: a persona's first sign-in without a membership provisions a practice of its own. The seed prints a sign-in link for each persona. Running it again changes nothing. Pass a URL for another port, and `--trusted-headers` to seed a built Worker in `trusted-headers` mode (start it with `--var SELF_SIGNUP:open` as well, see below).

## Who gets a practice: invitations and self-signup

Identity says who the caller is; membership says what they may do. A signed-in user without an active membership first accepts their pending invitations (below). A user with neither a membership nor an invitation may provision a practice of their own, which they lead and administer, only where self-signup is allowed. Otherwise the API answers 403 and asks them to request an invitation, and nothing is written. A practice provisioned this way is named after its founder (for example "Lea Lead practice"), so members of several practices can tell them apart; an administrator can rename it.

The Worker variable `SELF_SIGNUP` controls self-signup (`site-app/lib/access-policy.ts`):

| `SELF_SIGNUP` | Who may provision a practice without an invitation |
|---|---|
| *(unset)* | nobody, except on the development server (`IDENTITY_MODE=dev`), where it is open so the personas keep working |
| `off` | nobody, including on the development server |
| `open` | every signed-in user |
| a comma-separated list, such as `owner@firm.example,@firm.example` | users whose email is listed, or whose email ends in a listed `@domain` |

**Self-signup is off by default outside the development server**, including the Sites build, Cloudflare Access deployments and `trusted-headers` mode. To bootstrap a new deployment, list the first administrator, for example `--var SELF_SIGNUP:owner@firm.example`, let them sign in once, then remove the variable and invite everyone else. The Miniflare harnesses set `SELF_SIGNUP=open`, or an allowlist, explicitly.

**Invitations.** A practice administrator invites an email address with a role, a client (for client roles) and engagements (which only a Lead Auditor may assign) from Members & access. The invitee joins the inviting practice the next time they sign in with that email, whether or not self-signup is allowed: the first request without a practice, or for a practice they are not yet an active member of, accepts every pending, unexpired invitation for their email (`site-app/lib/invitations.ts`). Acceptance is a management event (`acceptInvitation`) and bumps the practice's management version. An invitation for someone who is already an active member keeps their role and only adds its engagements. **An invitation never outlives a later access change**: if the membership was revoked, re-granted or given a new role after the invitation was issued (`memberships.access_since` is at or after the invitation's `created_at`), the invitation is closed as `superseded` (management event `supersedeInvitation`) and changes nothing, so a revoked member cannot regain access through an invitation sent before the revocation. Emails are compared trimmed and lower-case. Invitations expire after 30 days and can be cancelled while pending. The platform sends no email. **An invitation trusts the identity provider's email claim**: Sites dispatch, Cloudflare Access and the development personas all supply a verified address. Do not use a mode in which the caller chooses their own email.

**Revocation and re-grant.** Revoking a member, or changing their role or client, withdraws in the same management batch every engagement grant they hold, the runner workers they sponsored and (on revocation) their practice administration. Their client request grants lapse, because each membership records when its current grant began (`memberships.access_since`). A re-grant or role change to an internal role must list the engagements it grants, and restores nothing else; withdrawn runner workers must be enrolled again. A practice always keeps at least one active administrator; administrators can grant, revoke and transfer administration to active internal members.

**Engagement quality reviewers.** The Engagement Quality Reviewer role reads the engagements it is granted and records only the quality review; every other engagement write refuses it (`docs/audit-workflow-implementation.md`, #24). The practice's quality review policy sets how many days must pass after someone's latest recorded work on a client's engagement, or the end of an engagement grant they held there under another role, before they may be appointed quality reviewer of another engagement for that client (default 730; 0 checks only the engagement's own team; at most 3650). Only a Lead Auditor who administers the practice changes it (`setQualityReviewPolicy`, with a reason); the management event records the old and new period. It replaced the `EQR_COOLING_OFF_DAYS` Worker variable (#127), which is no longer read: a deployment that set the variable must enter the same period for each practice under Members & access → Quality review policy, and until then the default of 730 days applies. Each appointment records the period it applied. Every change of an engagement grant is kept in `engagement_access_history` with the holder's role at that moment, so a grant held under another role keeps counting as team membership after the member is re-granted as a reviewer. Migration 0010 rebuilt the grants made before the history existed from the management events (member grants, role changes, revocations, accepted invitations, engagement creation) and the engagement audit events (`setEngagementAccess`), and then copied the current grants. A grant made before then that left no such event (for example at provisioning or by the legacy access adoption of migration 0005) is known only from its current row; when that row was overwritten by a later grant, the earlier tenure is lost, and recorded work and the engagement record are then the only evidence of team membership.

**Quotas.** Each practice may hold at most `TENANT_MAX_ENGAGEMENTS` engagements (default 200) and store at most `TENANT_MAX_SAVES_PER_HOUR` engagement versions an hour (default 1000; each save keeps a full snapshot). Beyond either, the request is refused with 429 and an explanation, and nothing is written.

## Verification

- `site-app/lib/identity.test.ts` and `lib/cloudflare-access.test.ts` (Vitest) cover mode selection, forged headers in every mode, header removal and token verification, using a locally generated key pair and a stub key set.
- `site-app/build/sites-vite-plugin.test.ts` (Vitest) drives the dev server's persona middleware with fake requests. Inbound identity headers are stripped. An unknown persona gets 400, a cookie value outside the fixture stays anonymous, and a non-loopback socket gets 403 and no identity. Each port reads and clears only its own cookie.
- `site-app/scripts/identity-check.mjs` runs the same matrix against the built Worker in Miniflare, including Access tokens served by a stub `outboundService`, and checks that an anonymous `/report` in `cloudflare-access` mode ends at a 401 from sign-in instead of looping. It also checks that the build configures `sites` mode, and defaults to it, only for Sites checkouts, that the define is compiled into the Worker and the browser bundle, and that the build contains no personas.
- The integration harnesses opt in to `trusted-headers` explicitly.
- `site-app/scripts/access-lifecycle-check.mjs` checks the access lifecycle against the built Worker: self-signup under each `SELF_SIGNUP` setting, invitations end to end (including one issued before a revocation, which is superseded), revocation and role changes withdrawing grants and sponsored runner tokens without implicit restore, administration grant, revoke and transfer, rename, both quotas, a Client Viewer refused every write, and the one-time withdrawal in `drizzle/0007_access_lifecycle.sql`. `lib/tenancy.test.ts`, `lib/engagement-repo.test.ts` and `lib/commands/management/dispatcher.test.ts` (Vitest) cover the same rules statement by statement.
