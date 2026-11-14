# Workspace redesign — 6 October 2026

> **Superseded for status (14 Nov 2026).** This is a dated record of an earlier increment, kept as written. For what the platform does now, see the [capability matrix](capabilities.md) and [ROADMAP.md](../ROADMAP.md); file paths, counts and limits below are as they were when this was written ([historical paths](capabilities.md#older-documents-and-historical-paths)).

The workspace uses Notion-inspired database and document patterns. The design guidance is Anthropic's official [frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design), installed from the vendor repository. The interaction reference is Notion's [database views documentation](https://www.notion.com/help/views-filters-and-sorts).

## Design decisions

- A light, neutral sidebar shows practice navigation, the selected client/engagement, nested audit pages, and Settings & members. Mobile navigation closes after selection.
- White working pages use consistent typography, compact row separators, restrained status tags and contextual actions. Marketing copy and dashboard card decoration are removed.
- Clients are a searchable database. Opening a client exposes its properties and engagements. New client belongs to the directory; New engagement belongs to the engagement database.
- Working papers, evidence and findings have named views and search. Returning to an audit register preserves its filter and search during the session.
- Engagement home shows pending decisions and an inline paper database. Lifecycle and article coverage are available on demand.
- Papers open as document side peeks and can expand. Properties precede editable narrative sections. Evidence, conclusion status, comments, historical revisions and independent approvals remain available.
- Save revision creates an explicit saved revision. Unsaved edits and unsent comments block approval and trigger close/browser-leave warnings. Expanding preserves the mounted editor. Inputs are locked during saves; refreshes preserve dirty drafts against their prior baseline. Successful save responses update that baseline even when a follow-up refresh fails. A newer remote revision triggers a conflict dialog with local export and reload options.
- Testing separates runs from models/setup. A completed diagnostic opens the runs view. Detailed results use readable tables; Findings use narrative sections. JSON is an explicit export, with technical provenance secondary.
- Member administration includes active/revoked views, role/client scope, revocation/restoration, and copyable account ID. Site sharing and practice membership remain distinct access layers; no email invitation is implied.

## Audit behavior

Existing supplementary papers can be edited with substantive conclusions. Removing a required paper, or recording a not-applicable conclusion for an excluded paper, still requires a Lead Auditor and reasoned applicability evidence. Revision history, independent review, distinct reviewer/signer, immutable report snapshots and tenant/client authorization remain server-enforced.

## Verification

Type checking, the Worker build and the isolated integration harness passed. Regression coverage includes both generated and methodology supplementary drafts while retaining Lead-only exclusions. The existing authentication, tenant isolation, management concurrency, access revocation, custody, diagnostics, review, final-report gates and immutable-history checks passed.

Browser checks covered desktop paper/database presentation, search retention, expansion without losing text, unsaved close/cancel/discard, disabled submission of incomplete/dirty papers, member form, and phone-size member/document layouts and navigation. Temporary UI edits were discarded without saving.

This redesign changes the deployed reference application. The separate enterprise infrastructure and production-hardening roadmap remain as documented.


## Daily workflow enhancements — 6 October 2026

- Workspace search (`Ctrl`/`Cmd` + `K`) groups pages, authorized clients and engagements, current engagement records, and templates. Client Viewers do not receive internal paper/template shortcuts. Selection uses the same unsaved-edit and unsent-comment guard as normal navigation.
- Paper registers combine status, stage, search and sort; evidence combines acceptance/category; findings combine status, severity and risk/due-date ordering. Views retain their settings in the current session. Overview shortcuts clear incompatible filters so their target records remain visible. Template views distinguish papers from memos and filter by stage.
- Evidence peeks provide acceptance, download, direct model relationships and linked papers/runs/retests. Linking proposes an unsaved paper edit; only Save revision persists it. The refreshed artifact is used for JSON exports after acceptance.
- Report lists use readable package labels, opinions and captured record counts. Current readiness gates are collapsed. Report peeks use captured records rather than today's paper/evidence labels; they include read-only captured paper narratives, diagnostics, approval history, and nine Annex IV sections with readable subitem checklists. Candidate counts are not compliance scores. Account IDs and digests stay under integrity details. Client-released packages omit internal diagnostics, Annex compilation and full paper bodies according to the server projection.
- Async workspace loads cancel superseded requests and reject stale responses. Search/navigation are disabled during context changes. Explicit comment resets cover discard-and-reopen of the same paper.

Verification: the targeted search/register checks, TypeScript, Worker build and isolated integration suite passed. Browser checks covered stage filtering, memo views, grouped search, same-paper unsent-comment cancel/discard, synthetic CSV acceptance, evidence linking and saved usage, frozen paper/checklist views, mobile search/register layouts, and absence of browser console errors. Test data stayed in the local development environment. Browser history/bookmarks, bulk operations and full print-package parity remain future work.


## Guided daily work — 6 October 2026

The working experience now starts in the selected engagement rather than the client directory. A device-local preference remembers the last engagement and audit module for the signed-in identity. Only opaque selection IDs and an allowed module are stored; paper content and unsent comments are not. Every restored engagement is authorized again through the server. Inaccessible/missing selections fall back to available work, while transient failures retain the preference and offer retry.

The current-engagement control opens a searchable picker grouped by client. Switching retains the current allowed audit module and validates the selected ID against the authorized list. The overview prioritizes personal paper actions derived from preparation/contributions, eligible independent reviews, eligible sign-offs, and comments to confirm. It does not invent assignments. Papers awaiting others are secondary.

Paper peeks include a compact submission checklist with field shortcuts, visible explanations of the next action, a Back control, and guarded previous/next navigation within the current register. Existing server rules still govern applicability exclusions, review independence, revision-bound approvals and distinct reviewers/signers. Evidence selection has Linked/All accepted views, filename search and a category filter; filters do not remove selected links, and signed/read-only papers always show all linked accepted evidence. Creation buttons and success feedback describe the actual action.

Verification: targeted workflow/search checks, TypeScript, the Worker build and isolated integration suite passed. Browser checks covered engagement search/switching while preserving the audit module, page and engagement restoration after reload, filtered adjacent paper navigation, cancel/discard protection for edits and unsent comments, field shortcuts, evidence search/selection, return to clients, and mobile layout. Temporary paper edits were discarded; the extra switching engagement is local test data only. No hosting sharing or practice access was changed.
