# Auditor workbench UX — 7 October 2026

## Business perspective

The daily user is an auditor completing and defending an engagement. Visual polish matters when it helps that person identify the next procedure, understand the missing evidence, hand over a reviewable revision, and explain what prevents progression or reporting. An attractive collection of modules does not resolve those tasks on its own.

| Auditor expectation | Previous friction | Implemented experience |
| --- | --- | --- |
| Know what to do in the current audit stage | All own drafts competed for attention, including later-stage templates | Earlier unresolved work comes first, then current-stage actions. Later preparation is collapsed and remains accessible. |
| See team obligations separately from personal work | An empty personal queue could imply completion | Current and earlier-stage team paper counts remain visible; the complete audit program is one action away. |
| Know why the engagement cannot advance | Lifecycle movement was hidden and gates appeared after an attempted transition | Visible lifecycle path and next-stage requirements, grouped by business responsibility with links to records. Only the Lead can advance, one stage at a time. |
| Prepare a reviewable packet | Missing requirements were disconnected from the daily queue and review view | Queue shows remaining submission requirements; each revision displays results, conclusion, conclusion status, accepted evidence and open comments with targeted section jumps. |
| Trust that linked evidence is not silently omitted | Only accepted artifacts rendered, hiding unavailable linked references | Every linked reference renders with its actual acceptance state or unavailable-reference marker. A preparer can unlink a blocked reference; signed revisions remain read only. |
| Understand report readiness for the intended opinion | Positive-opinion gate counts were shown without the mandatory Sign-off stage | Live final-report readiness groups classification, preparation, independent review, signatures, runs, findings and lifecycle. Selected opinion is retained when opening a report form. |
| Capture a draft without suggesting final completion | Draft and final requirements were difficult to distinguish | Draft capture remains available with outstanding work; final creation is disabled while its exact requirements remain open. Existing captured reports remain fixed. |

## Policy and interaction decisions

- Stage names are normalized for queue display, including the template spelling `Evidence Evaluation`. Non-lifecycle work, such as remediation and monitoring, remains available in the later/other-work disclosure.
- Live reviews, signatures and open comment responses stay actionable even when their paper has a future or unrecognized stage label. The queue uses author/contributor history, not an invented assignment system.
- Stage and final-report gate records are shared by the user interface and command handler. Required Planning signatures and approved classification gate entry to Fieldwork; active evaluations gate entry to Evidence evaluation. Reporting and Sign-off retain the existing full completion rules, including signed applicability exclusions and future-labelled required papers.
- Open High/Critical findings block a readiness assessment. Other scoped opinions can disclose unresolved findings, but still require approved classification, signed issuance papers, completed evaluations and the Sign-off lifecycle stage.
- Acceptance is a file-handling state. Relevance, sufficiency, limitations and the audit conclusion remain human assessments. Checklist completion is preparation readiness, not legal compliance or assurance certification.
- Independent review, contributor exclusion, revision-bound signatures, comment-author confirmation, signed-paper immutability, permissions and optimistic concurrency remain enforced on the server.
- Queued evaluations may be executed or cancelled by an Auditor or Lead. Running evaluations require completion, or Lead recovery of an interrupted run after the existing two-minute interval.

## Design basis

This applies task-focused disclosure and recognition principles to the existing audit methodology: expose relevant decisions and their context, while leaving future preparation and detailed gate lists available on demand. See [NN/G: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/), [Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/) and [Complex Application Design](https://www.nngroup.com/articles/complex-application-design/). These guide interface structure; the platform's reviewed domain policy supplies eligibility rules.

## Verification and limits

TypeScript, workflow checks, register/search checks, Worker build and isolated integration checks passed. The latter covered authentication, tenant isolation, same-origin mutations, permissions, concurrent saves, evidence custody, model/evaluation lineage, independent reviews, signatures, lifecycle progression, opinion-specific final issuance and frozen client-safe reports.

Local browser checks verified task-to-section navigation, evidence jumps, a disabled final-create action with visible lifecycle and paper blockers, clean-form cancellation, dirty-form protection, opinion selection carried into report setup, and responsive report/dialog widths at 390 pixels. Tests used fictional local data; no production audit records were created. The unavailable-reference cases were covered by workflow fixtures; they were not manufactured in production.

This is an implemented UX increment, not a measured user-task study or full accessibility assessment. Evidence requests were added during the follow-up business review described below. Reviewer assignment, client submissions and production-native ML execution retain separate acceptance work.

## Evidence collection and business completeness follow-up

The Evidence vault now separates Files and Requests. Requests define the deliverable, purpose, responsible party, period/version, handling instructions, due date and supported papers. Auditor-recorded receipt is followed by an explicit sufficiency/follow-up decision. The primary action follows the request state; historical revisions retain the earlier relationships and handling decisions.

A Lead-approved evidence limitation/scope decision creates a required unevaluated memo. It needs accepted support for that decision and independent review; missing material never manufactures a successful conclusion. Reopening requests does not rewrite signed memos or captured reports. Required unresolved requests block Reporting/Sign-off. Unobtainable evidence, qualified/unsupported required signed conclusions and a prohibited-practice classification prevent positive readiness.

Full internal report packages capture request records; Client Viewer workspace/report/print projections omit the register. Collection remains auditor-recorded and the checklist is downloadable for an approved external route. Client uploads, automatic reminders and separate report release authorization are still pending. The [business completeness review](audit-business-completeness.md) identifies the next operational priorities and acceptance criteria.
