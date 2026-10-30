# Audit workspace UX refinement — 7 October 2026

## Product decision

The daily experience should be an audit work surface: choose the next action, work on the record, and return without losing context. The current increment improves existing workflows rather than adding another dashboard or task-management system.

The review identified five sources of friction: duplicate and empty attention rows; remediation actions separated from finding details; model cards separated from evaluation setup; inconsistent form cancellation/error behavior; and crowded register controls.

## Interaction changes

| Workflow | Result |
| --- | --- |
| Engagement overview | Personal paper actions lead the page. The first action has stronger emphasis. Non-paper checkpoints appear only when pending. Classification, evidence, finding and active-evaluation links open their relevant existing views. |
| Findings | Both register rows and live record details offer remediation and independent retest actions. Saved updates refresh the open detail. Closure prerequisites explain unavailable actions. Frozen report contents remain snapshots. |
| Testing Lab | Each tab has relevant creation controls. Runnable model rows and cards start evaluation with that exact version selected. Protocol cards offer direct reuse. Native/quarantined models retain explicit capability boundaries. |
| Standard forms | Errors appear inside the form. All fields are locked during saves. Cancellation prompts appear only for changed entries; reverting values removes the prompt. Workspace navigation and page departure protect open forms. |
| Registers | The active view contains its result count. Searches name the record type and can be cleared directly. Active filters expose a labeled Clear control. Narrow layouts separate views from search and actions. |

The existing authorization, optimistic concurrency, immutable versioning, independent review and signed-record protections remain authoritative on the server. Finding action guidance additionally excludes finding creators and remediation authors from confirming their own retest, and checks accepted evidence before enabling the action.

## Visual direction

Use a quiet Notion-inspired workspace with compact headings, restrained icons, visible action hierarchy and ample space around the work itself. Preserve the existing system font (Segoe UI / Arial), with 28px page titles, 16px section titles, 14px record text and 12–13px supporting metadata. The palette is white `#FFFFFF`, sidebar `#F7F7F5`, ink `#37352F`, secondary text `#787774`, dividers `#E9E9E7` and completion `#4F7D63`.

The overview uses a wide work column and a smaller checkpoint column on desktop; these stack on smaller screens. Tables keep their own horizontal scroll region. Color communicates state rather than decorating general copy. Page icons sit beside the title, saving the earlier separate row.

On phones, Testing Lab model, protocol and evaluation rows become compact cards so their primary actions remain visible. Other wide tabular evidence retains a bounded scroll region.

## Research basis

- [Notion database views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts): contextual database views, filtering, and opening records while maintaining workspace context.
- [Nielsen Norman Group: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): prioritize frequent work and reveal secondary details when needed.
- [Nielsen Norman Group: Recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/): place understandable actions and contextual cues where users need them.

These principles informed the design; they do not establish measured usability outcomes. Validation records describe the local interaction and regression checks performed for this increment.
