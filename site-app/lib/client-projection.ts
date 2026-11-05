import type { Finding } from "./domain";
/** A client finding must not inherit new internal fields when the audit model grows. */
export function clientFinding(f: Finding): Finding {
  return {
    id: f.id,
    title: f.title,
    article: f.article,
    condition: f.condition,
    criteria: f.criteria,
    cause: f.cause,
    effect: f.effect,
    likelihood: f.likelihood,
    impact: f.impact,
    riskScore: f.riskScore,
    severity: f.severity,
    status: f.status,
    owner: f.owner,
    dueDate: f.dueDate,
    response: f.response,
    remediation: f.remediation,
    retestEvidenceIds: [],
    createdBy: "",
    visibility: "client",
  };
}
