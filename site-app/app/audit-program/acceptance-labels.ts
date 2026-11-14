// The acceptance panel's labels: our own short titles; no standards text is
// reproduced (D-03).
import type { DeclarationStatus } from "@/lib/workflow/acceptance";
import type {
  AcceptancePrecondition,
  accessLevels,
  CompetenceArea,
  ExclusionKind,
  ThreatKind,
} from "@/lib/workflow-types";

export const preconditionLabels: Record<AcceptancePrecondition, string> = {
  subjectMatter: "Appropriate, identifiable subject matter",
  criteria: "Suitable criteria available to intended users",
  evidence: "Access to the evidence the conclusion needs",
  purpose: "A rational purpose for the engagement",
};
export const accessLabels: Record<(typeof accessLevels)[number], string> = {
  white: "White box: code, weights and training data",
  grey: "Grey box: model outputs plus documentation",
  black: "Black box: inputs and outputs only",
};
export const threatLabels: Record<ThreatKind, string> = {
  self_interest: "Self-interest",
  self_review: "Self-review",
  advocacy: "Advocacy",
  familiarity: "Familiarity",
  intimidation: "Intimidation",
};
export const threatHints: Record<ThreatKind, string> = {
  self_interest: "A financial or other interest in the outcome",
  self_review: "Evaluating your own or your firm's earlier work",
  advocacy: "Promoting the client's position",
  familiarity: "A close or long relationship with the client",
  intimidation: "Pressure, actual or perceived, from the client",
};
export const exclusionLabels: Record<ExclusionKind, string> = {
  system_involvement:
    "I used, developed or distributed this AI system, or help to",
  employment:
    "I am or was employed by the client or the system's vendor during the engagement",
  financial_interest:
    "I hold a direct or material indirect financial interest in the client or vendor",
};
export const areaLabels: Record<CompetenceArea, string> = {
  assurance: "Assurance methodology",
  ai_systems: "AI and ML systems",
  statistics: "Statistics and fairness",
  regulation: "AI regulation",
  management_systems: "AI management systems",
  data_protection: "Data protection",
  security: "AI security",
  domain: "Sector knowledge",
};
export const statusLabels: Record<
  DeclarationStatus,
  { text: string; tone: string }
> = {
  current: { text: "Current", tone: "green" },
  missing: { text: "Declaration needed", tone: "amber" },
  outdated: { text: "Team changed: renew", tone: "amber" },
  unresolved: { text: "Threat to resolve", tone: "red" },
  excluded: { text: "Disqualified", tone: "red" },
};
export const yesNo = [
  { value: "true", label: "Met" },
  { value: "false", label: "Not met" },
];
export const day = (iso: string) => new Date(iso).toLocaleDateString();
