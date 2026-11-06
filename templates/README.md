# Reusable audit templates

Use `catalog.json` as the versioned program catalog, [`../schemas/working-paper.schema.json`](../schemas/working-paper.schema.json) (its `paperRevision` definition) as the machine-readable contract and the Markdown files as narrative drafting templates. Instantiate an item inside an engagement; copy its immutable catalog id/version, selected procedures and required evidence into a working-paper revision. Preserve the catalog item when engagement-specific tailoring is approved. Omitted procedures require a reason and reviewer approval.

The standard paper header, evidence reference and review fields are defined in `working-paper.md`. Article-specific fieldwork programs are in `article-fieldwork.md`; planning, evaluation, automation and remediation have separate templates. Memo templates cover acceptance, significant judgments, management response, reporting and sign-off. Catalog-specific procedures populate the appropriate template; templates are starting points and may not contain fabricated evidence or conclusions.

`working-paper.blank.json` is a draft specimen, not a completed or approved paper. The schema permits incomplete narrative fields while the paper is a draft; `node schemas/validate-working-paper-schema.mjs` (run in CI) validates the specimen and the status gates. The workflow service must enforce stage-dependent completeness, role permissions, exact revision/digest approval and report issue gates in addition to JSON validation. JSON Schema alone cannot enforce reviewer independence, tenant access or evidence truthfulness.

Stable id families:

| Prefix | Program |
|---|---|
| WP-PL | Planning and administration |
| WP-A09 ... WP-A15 | Core high-risk requirements |
| WP-XC | Additional operator and lifecycle obligations |
| WP-EV | Evidence evaluation and findings |
| WP-RP | Reporting and completion |
| WP-RM | Remediation and monitoring |
| MEM | Decision and communication memoranda |

Every template inherits the warning: **diagnostic output is evidence for an auditor's assessment; it is not a legal conclusion or a conformity certificate**. Default numerical thresholds are unset until the test plan is approved. The legal snapshot is the consolidated text of 27 July 2026 under rule pack 2026.11.1, researched on 5 November 2026 (`regulatorySnapshot` in `catalog.json`); refresh applicability before each engagement.
