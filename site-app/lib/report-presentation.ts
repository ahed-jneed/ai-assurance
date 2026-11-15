import type { Engagement, Report, Role } from "./domain/types";
import { can, isClientRole } from "./permissions";
import { releaseRefusal } from "./preconditions";
import {
  clientSupersededBy,
  isClientVisible,
  withdrawnSuccessor,
  withdrawnSuccessorOf,
} from "./workflow-state";
import { conclusionTypes, snapshotTerms } from "./domain/report-model";

/**
 * The date a captured report states: its report date element, else the
 * snapshot's capture time. Never the release time, which the client
 * projection shows as the record's createdAt.
 */
export function reportDate(snapshot: Record<string, unknown>) {
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [],
    element = elements.find(
      (el): el is { id: string; value: string } =>
        !!el && typeof el === "object" && el.id === "date",
    );
  return (
    element?.value ||
    (typeof snapshot.createdAt === "string" ? snapshot.createdAt : "")
  );
}

/**
 * A time as the printed report states it: en-GB in Europe/Vienna, the zone
 * the report names beside it (#241).
 */
export function viennaTime(at: string) {
  return new Date(at).toLocaleString("en-GB", { timeZone: "Europe/Vienna" });
}

/** The counts of a captured results-by-criterion row, as either renderer reads them. */
type CriterionCounts = {
  procedures?: unknown;
  exceptions?: unknown;
  openFindings?: unknown;
  openHighFindings?: unknown;
  withheldHighFindings?: unknown;
};
const count = (v: unknown) => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** The note beside a criterion whose result an internal-only High or Critical finding decides (#241, D-36). */
export const withheldFindingNote =
  "A High or Critical finding for internal use decides this result; its details are not part of this report.";

/**
 * The Exceptions cell of a results-by-criterion row (#241): a criterion no
 * procedure evaluated has no procedure exceptions to count, so it reads
 * "None evaluated" rather than 0. Shared by the /report print view and the
 * in-app report sheet (FrozenReportDetails).
 */
export function criterionExceptionsCell(row: CriterionCounts) {
  return count(row.procedures)
    ? String(count(row.exceptions))
    : "None evaluated";
}

/**
 * How many open High or Critical findings decide the row's result but are
 * left out of its counts (F-57 keeps the client counts to the findings the
 * report lists; D-36 opens the row for the result). 0 for snapshots captured
 * before the field existed.
 */
export function criterionWithheld(row: CriterionCounts) {
  return count(row.withheldHighFindings);
}

/**
 * The Open findings cell of a results-by-criterion row (#241): "Withheld"
 * when only internal-only findings are open, "N and withheld" beside listed
 * findings, else the plain counts.
 */
export function criterionOpenFindingsCell(row: CriterionCounts) {
  const open = count(row.openFindings),
    high = count(row.openHighFindings),
    withheld = criterionWithheld(row);
  if (withheld && !open) return "Withheld";
  return (
    open +
    (high ? " (" + high + " High or Critical)" : "") +
    (withheld ? " and withheld" : "")
  );
}

/**
 * The time a report row shows and its label (#210): the client projection
 * carries the release time, which the client sees as "Released"; a staff
 * record shows its capture time.
 */
export function reportTime(report: {
  createdAt?: string;
  releasedAt?: string;
}) {
  return report.releasedAt
    ? { label: "Released", at: report.releasedAt }
    : { label: "Captured", at: report.createdAt ?? "" };
}

export function packageStatus(report: Report, clientView = false) {
  if (clientView) return report.supersededBy ? "superseded" : "released";
  return report.kind === "draft"
    ? "draft"
    : (report.release?.state ?? "internal");
}

export function packageStatusLabel(report: Report, clientView = false) {
  const labels: Record<string, string> = {
    draft: "Draft snapshot",
    internal: "Awaiting approval",
    approved: "Approved for release",
    released: "Released to client",
    superseded: "Superseded",
    withdrawn: "Withdrawn",
  };
  const state = packageStatus(report, clientView);
  // The client projection names the successor on the report itself.
  const successor = report.supersededBy ?? report.release?.supersededBy;
  if (state === "superseded" && successor) return "Superseded by " + successor;
  return labels[state] ?? "Internal package";
}

/**
 * The report the client reads as its current one, from what the client
 * projection names on each report it shows: the newest report with no
 * successor, else the newest whose successor was withdrawn after release
 * (#234 review). `entries` are the client-visible reports with the
 * successor the client projection names (clientSupersededBy) and their
 * release time.
 */
function clientCurrent(
  entries: readonly { id: string; supersededBy?: string; at: string }[],
) {
  const newest = (xs: typeof entries) =>
    [...xs].sort((a, b) => b.at.localeCompare(a.at))[0]?.id;
  return (
    newest(entries.filter((x) => !x.supersededBy)) ??
    newest(entries.filter((x) => x.supersededBy === withdrawnSuccessor))
  );
}

/** The client's current report, from the stored report records. */
const storedClientCurrent = (reports: readonly Report[]) =>
  clientCurrent(
    reports.filter(isClientVisible).map((r) => ({
      id: r.id,
      supersededBy: clientSupersededBy(reports, r),
      at: r.release!.releasedAt!,
    })),
  );

/** The client's current report, from the client projection's reports. */
const projectedClientCurrent = (reports: readonly Report[]) =>
  clientCurrent(
    reports.map((r) => ({
      id: r.id,
      supersededBy: r.supersededBy,
      at: r.releasedAt ?? r.createdAt,
    })),
  );

/**
 * What a released report's supersession says (#234 item 4), from the
 * successor the client projection names on it (clientSupersededBy): nothing
 * while it is the latest released report, its successor once superseded.
 * Once that successor was withdrawn, it says the report is current again
 * only while it is the client's current report (`current`); when a later
 * release has become current since, it names that report instead (#234
 * review). The client's release notices and the staff guidance both use it,
 * so neither calls the latest released report superseded, nor an older
 * report current.
 */
export function supersessionText(
  supersededBy: string | undefined,
  reportId?: string,
  current?: string,
) {
  if (!supersededBy) return "";
  if (supersededBy !== withdrawnSuccessor)
    return "It has since been superseded by " + supersededBy;
  return current && current !== reportId
    ? "Its successor was withdrawn; the current report is " + current
    : "Its successor was withdrawn, so it is the current report again";
}

/** What the client sees of a superseded report whose successor was withdrawn. */
const withdrawnSuccessorNotice = (successor: string) =>
  "Its successor " +
  successor +
  " was withdrawn. The client still reads this report.";

/**
 * The report the client still reads because its successor was withdrawn
 * after release (#226 item 6), for the Reports & sign-off banner: the
 * newest such report and what the client sees, or undefined. It uses the
 * client projection's own answer (withdrawnSuccessorOf).
 */
export function clientStillReads(reports: readonly Report[]) {
  const report = reports
    .filter((r) => withdrawnSuccessorOf(reports, r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return report
    ? {
        report,
        notice:
          report.id +
          ": " +
          withdrawnSuccessorNotice(withdrawnSuccessorOf(reports, report)!),
      }
    : undefined;
}

/**
 * What comes next for a captured package, by its state (#202): the
 * pre-release guidance only while a final package awaits approval. With the
 * engagement, an approved package that the server would still refuse to
 * release (an Engagement Quality Reviewer's sign-off outstanding, open
 * completion work) names what it awaits, in the server's words (#210).
 */
export function packageGuidance(report: Report, engagement?: Engagement) {
  switch (packageStatus(report)) {
    case "draft":
      return "Drafts are internal review snapshots.";
    case "approved": {
      const refusal = engagement && releaseRefusal(engagement, report);
      return refusal
        ? "Both package versions are approved. " + refusal.message + "."
        : "Both package versions are approved. A Lead Auditor other than the approver authorizes the client release.";
    }
    case "released": {
      // What the client reads of it, from the client projection's answer.
      const reports = engagement?.reports ?? [report];
      const supersession = supersessionText(
        clientSupersededBy(reports, report),
        report.id,
        storedClientCurrent(reports),
      );
      return supersession
        ? "Released to the client. " + supersession + "."
        : "Released to the client as its current report. A Lead Auditor can withdraw it.";
    }
    case "superseded": {
      const withdrawn =
        engagement && withdrawnSuccessorOf(engagement.reports, report);
      return withdrawn
        ? withdrawnSuccessorNotice(withdrawn)
        : "Superseded by a newer released report. It stays readable as it was issued.";
    }
    case "withdrawn":
      return "Withdrawn. Capture a new final package to report again.";
    default:
      return "Approve both package versions before client release.";
  }
}

/**
 * "Captured (Qualified)": a final package with the conclusion it was
 * captured with (a legacy package: its recorded opinion).
 */
export function capturedLabel(report: Report) {
  const t = snapshotTerms(report.snapshot),
    opinion = t
      ? // "Readiness assessment (not assurance)" reads without the aside.
        conclusionTypes[t.conclusion].label.replace(/ \(not assurance\)$/, "")
      : typeof report.snapshot.opinion === "string"
        ? report.snapshot.opinion
        : "";
  return opinion ? "Captured (" + opinion + ")" : "Captured";
}

/**
 * The Reports & sign-off banner for a captured final package awaiting
 * approval (R1-19): it describes that package, not the capture gates of the
 * terms selected for a new capture, and the next step for the viewer.
 */
export function awaitingApproval(report: Report, role: Role, userId: string) {
  const label = capturedLabel(report);
  const guidance = !can(role, "approveReportPackage")
    ? can(role, "saveQualityReview")
      ? "Sign off both exact package versions in Quality review. A Reviewer or Lead Auditor approves them before client release."
      : "A Reviewer or Lead Auditor who did not capture it approves both package versions before client release."
    : report.actor === userId
      ? "A Reviewer or Lead Auditor other than you approves both package versions before client release."
      : "Review both package versions and approve them for client release.";
  return { badge: label, title: label + ", awaiting approval", guidance };
}

export function packageOpenLabel(report: Report, role: Role, userId: string) {
  if (isClientRole(role)) return "View report";
  const state = packageStatus(report);
  if (
    state === "internal" &&
    can(role, "approveReportPackage") &&
    report.actor !== userId &&
    report.snapshot.workflow
  )
    return "Review approval";
  if (
    state === "approved" &&
    can(role, "releaseReport") &&
    report.release?.approval?.userId !== userId
  )
    return "Review release";
  return state === "released" ? "View released report" : "Review package";
}

/**
 * The release notifications a client sees on its overview (#94), newest
 * first: one per released report whose release notified the client. Each
 * names the reports it replaces, so a client sees why an earlier report is
 * now superseded.
 */
export function clientNotices(reports: Report[]) {
  const current = projectedClientCurrent(reports);
  return reports
    .flatMap((r) => (r.notification ? [{ r, n: r.notification }] : []))
    .map(({ r, n }) => ({
      reportId: r.id,
      at: n.at,
      text:
        "Report " +
        r.id +
        " was released to " +
        (n.recipients || "your organisation") +
        (r.replaces?.length ? "; it replaces " + r.replaces.join(", ") : "") +
        (r.supersededBy
          ? ". " + supersessionText(r.supersededBy, r.id, current)
          : "") +
        ".",
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
