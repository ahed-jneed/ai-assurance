# Usability restructure — 5 October 2026

The platform now separates practice management from the work inside an audit.

## Client and engagement flow

The entry page is a searchable client directory. Open a client to see its profile and engagements; open an engagement to enter its audit workspace. A separate Engagements page supports searching across the practice and filtering by client. Breadcrumbs and the selected engagement in the sidebar provide return paths.

New client appears only in the client directory. New engagement appears on client profiles and the Engagements page. Client name/sector can be edited from the profile; engagement title/due date from its overview. Identifiers and client-to-engagement relationships remain fixed.

## Users and access

Users & access is a sidebar destination. Leads can add users, edit roles and client scope, revoke access, and explicitly restore a revoked membership. Self-role changes and self-revocation are rejected. Historical contributions remain attributable after revocation. Client Viewers are assigned to exactly one existing client; internal roles cover the practice.

There are two access layers. Site sharing must allow the colleague to open the platform. They then sign in, copy the Account ID from Users & access, and provide it to a Lead Auditor who assigns their practice role. The platform does not send email invitations or automatically modify the hosting audience. These instructions and role explanations are collapsed on the access page.

Management mutations use an independent tenant version and append-only management event history. They do not update an unrelated audit engagement. Concurrent management commands, revoked identities and demoted actors cannot bypass the current-role checks. A revoked-only identity cannot bootstrap itself back into a practice.

## Reading audit records

Raw JSON is available as an explicit export, rather than a display view. Diagnostics use metric tables, confusion counts, cohort comparisons and recorded criteria. Papers generated from diagnostics contain narrative results. Existing saved JSON results are presented readably without rewriting history. Approvals show people, revisions and times. Templates show objectives, numbered procedures, evidence requirements and completion gates. Reports use frozen-snapshot tabs and expandable records. Hashes and technical provenance are secondary.

Decorative sidebar copy, global creation buttons, repeated regulatory banners, implementation-scope paragraphs and the general footer were removed. The overview focuses on counts, lifecycle and actionable review items. Client viewers receive a released-record overview rather than misleading zeroed internal coverage statistics.

## Verification

Type checking and the Worker build passed. The isolated integration harness passed existing audit/security checks plus independent client management, tenant-CAS concurrency, name/sector edits, role changes, revocation/restoration, the legacy-command guard, revoked-only bootstrap denial and management-history immutability. Browser checks covered client profile → engagement → audit navigation, the add-user role form and client scope, the template detail view and mobile access layout.
