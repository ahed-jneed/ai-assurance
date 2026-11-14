# Auditor workflow product plan — 7 October 2026

> **Superseded for status (14 Nov 2026).** This is a dated record of an earlier increment, kept as written. For what the platform does now, see the [capability matrix](capabilities.md) and [ROADMAP.md](../ROADMAP.md); file paths, counts and limits below are as they were when this was written ([historical paths](capabilities.md#older-documents-and-historical-paths)).

Implementation update: the seven connected workflows below are now implemented. See [the implementation record](audit-workflow-implementation.md) for shipped behavior, technical controls, validation and remaining operating boundaries. The sections below preserve the original product reasoning; they are not a claim that every future enterprise service is deployed.

The product should let an auditor answer five questions from every work item: What am I doing? Why is it required? What information or evidence is needed? What decision is mine? What happens next?

## The working journey

Keep the existing Planning, Fieldwork, Evidence evaluation, Reporting and Sign-off lifecycle. Within those stages, guide the user through the business decisions below. Permit legitimate parallel work and draft preparation; stage gates govern approval and issuance rather than forcing every activity through a single rigid wizard.

| Step | Main screen and primary action | Information available in context | Saved output / handoff |
| --- | --- | --- | --- |
| Agree the engagement | Engagement brief → Send for scope approval | Client, audited system/use, period, operator responsibilities, intended audience, deliverables, basis of work, access constraints, team and independence | Exact approved mandate and system boundary; material changes require impact review and approval |
| Establish the audit program | Audit program → Review applicability / approve program | Obligation/criterion, source version, applicability rationale, planned manual/automated procedure, expected evidence, preparer/reviewer and due date | Approved criteria/procedure set with explicit exclusions and unresolved facts |
| Perform fieldwork | Procedure workspace → Request evidence / record execution / run evaluation | Planned steps, population/sample, received material, approved protocol and input versions, available test capabilities | Actual procedure record, linked evidence/run outputs, limitations and human evaluation |
| Evaluate and resolve exceptions | Exceptions view → Evaluate exception / prepare finding | Contradictory evidence, unsupported assertions, request limitations, material findings, management response and unresolved review points | Attributed judgments, findings/limitations, opinion implications and supporting memos |
| Complete independent review | Review inbox → Review submitted revision | Exact revision, scope/criteria, execution, evidence, results, changes since prior review and comment responses | Independent decision and revision-bound approvals; changes return for review |
| Approve and issue | Report workspace → Submit package for approval / authorize release | Exact internal package and client preview, scope, criteria, findings, limitations, approvals and permitted recipient/access scope | Immutable approved/released package, distribution record and correction/supersession history |
| Follow up | Follow-up workspace → Retest remediation / assess change | Outstanding actions, accountable owner, due date, fresh evidence, monitoring cadence and material system changes | Independent closure/reopening or new/reopened engagement; earlier reports stay fixed |

## Implement first: engagement brief and connected audit program

Current new engagements instantiate the complete working-paper catalog. The current “Audit program” action opens the paper register. Replace that experience with a reviewed set of duties and procedures appropriate to the mandate, while retaining the template library for additional work.

The brief captures common information once. Papers, requests, classification and reports reference its approved revision and may suggest relevant values. A user sees the source of each suggestion. Preserve model-specific intended use, dataset periods and procedure-specific populations; do not overwrite them from a general engagement field. Reuse must never make applicability decisions automatically.

The proposed program uses rows with: criterion/procedure, scope/applicability, preparer, independent reviewer, due date, work state, evidence/review issues and next action. Use concise primary columns; full rationale, source, guidance and history open in a detail panel. A procedure opens its paper, request or test with the relevant engagement/model/version retained, and provides a direct return to the program.

Recommended views: My work, Waiting on evidence, Ready for review, Changes requested, Decisions needed and All planned work. “Waiting on evidence” describes a recorded dependency; it does not imply the client has a portal account or notification. Default to relevant current-stage work and preserve the user's filters when returning.

Acceptance: an auditor can set up an engagement, approve its scope/program, start the first procedure, request its evidence and return to the program without re-entering context or guessing which module contains the next step. Existing engagements require a reviewed adoption process; never silently delete papers or rewrite signed records.

## Procedure workspace: detailed without clutter

The current working-paper editor seeds template procedure instructions under “Procedures performed.” Separate those concepts explicitly:

- **Plan:** selected criteria, planned steps, expected evidence, population, sampling and approved thresholds.
- **Execution:** what was actually done, by whom, when, on which population/sample and exact file/run versions; deviations and reasons.
- **Evaluation:** relevance/reliability/coverage, conflicting evidence, limitations, judgment and resulting findings.
- **Review:** exact submitted revision, reviewer questions, attributed responses and approvals.

Template instructions remain draft guidance. Imported diagnostic results identify their source and limitations. Neither creates a performed procedure or human conclusion automatically. Treat procedure states and evidence assessments separately from paper review states; do not reduce all of them to a green “Complete.”

Launch automated evaluations from a planned procedure. Preflight identifies input mismatches, unavailable capabilities, missing mappings, data/holdout limitations and protocol approval. Show actual run state and meaningful completion/failure guidance; do not invent progress percentages or time estimates. Permit other work while computation runs. Results return to the same procedure with a draft evidence packet and an explicit human evaluation step.

Acceptance: a reviewer can follow one criterion through its planned/executed steps and exact evidence to the human judgment, finding and report. A prefilled instruction cannot count as execution.

## Review ownership and useful guidance

Add engagement-authorized assignments and a review inbox showing submitter, eligible independent reviewer, due date, exact revision, prior changes and unresolved points. Assignment is distinct from access provisioning. Show why a person is ineligible and allow selection only from authorized eligible users; enforce independence on the server.

Each work item has one prominent state-appropriate action, such as Request evidence, Record execution, Evaluate evidence, Send for review or Respond to review. Explain disabled actions next to the action with a direct link to the missing item. Retain primary-record context and unsaved drafts through safe transitions; show a visible saved state and recoverable conflict handling. Do not introduce silent last-write-wins autosave for reviewed audit content.

Provide compact contextual guidance: purpose; expected evidence; example of an adequate response; common pitfalls; criteria/source; completion requirements. Keep longer explanations and provenance under “Guidance” or “Why this is required.” Examples must be clearly illustrative and never prefill conclusions. Use these details where the user needs them rather than adding general explanatory banners throughout the platform. Design basis: [NN/G workflow expectations](https://www.nngroup.com/articles/workflow-expectations/), [contextual help](https://www.nngroup.com/articles/onboarding-tutorials/) and [complex-application design](https://www.nngroup.com/articles/complex-application-design/).

Acceptance: preparers can respond to specific review questions with linked changes; reviewers can confirm resolution against the correct revision. Users can resume after an interruption without reconstructing their last task.

## Evidence, findings and reporting connections

Extend the current request register with grouped request packages and tracking of partial deliveries. Map each item to planned procedures, expected period/version and collection instructions. A later restricted client-contributor role can submit material only to explicitly authorized requests; keep Client Viewer read-only. Never make client submission rights a side effect of assigning a responsible-party name.

Create findings from a procedure/evidence exception, carrying references forward for confirmation. Capture condition, criteria, cause, effect, risk rationale, attributed management response, action owner/due date and planned retest. Closing requires fresh retest evidence, execution/result and independent closure rationale. Preserve disagreements and recurrence history.

Report preparation should assemble reviewed scope, criteria, procedure conclusions, material findings and limitations into a draft with navigable sources. Draft generation does not approve its opinion. Add a client preview that shows exactly what will be released, followed by separate approval/release authorization. Creating a final snapshot currently makes its client projection available; correcting that business boundary is a release priority before broader client onboarding.

Acceptance: a reviewer can trace a report statement back to its supporting judgment and evidence. Unreleased finals remain internal. Corrections are new immutable packages with explicit predecessor/supersession or withdrawal records.

## Consistent information hierarchy

Use precise states appropriate to the record: received versus sufficient evidence; executed versus evaluated procedure; submitted versus approved paper; approved versus released report. Dates, owner and dependency reasons accompany waiting/blocking states. Keep historical legal/record versions visible on demand.

Report progress as understandable work counts: approved planned procedures, procedures executed/evaluated, reviews pending and material unresolved issues. Paper signature coverage can remain a preparation metric. Do not label a signature percentage as legal compliance or conceal material limitations behind a high progress percentage.

Store the business relationships centrally: approved mandate/system revisions → obligation assessments → planned procedures/executions → evidence assessments → findings → approved report/release. Every record preserves tenant/engagement scope, actor/time, version and explicit links. Screens display that same information rather than maintaining duplicate narratives that diverge.

## Delivery order and validation

1. **Scope and audit program:** approved brief/system boundary, reviewed applicability/program and contextual links to current records.
2. **Execution and review:** structured procedures, actual-execution records, evidence judgments, authorized assignments and attributed review responses.
3. **Reporting control:** traceable report assembly, exact client preview, approval/release, correction/withdrawal and stronger finding/retest records. Prioritize separate release approval before client expansion.
4. **External collaboration and follow-up:** explicitly scoped submission roles, partial delivery handling, monitoring/change/incident workflows and reassessment.

Test the complete journey with representative auditors and reviewers: supported conclusion, material evidence limitation, changed scope and failed evaluation. Observe completion, wrong decisions, unnecessary navigation, repeated data entry and successful resumption. Include accessibility/keyboard and mobile checks. Establish a baseline before setting numeric targets; do not claim time savings from design inspection alone. Preserve existing authorization, concurrent-command protection, review independence and captured-report integrity throughout migration.
