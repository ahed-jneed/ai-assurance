import { isClientRole } from "./permissions";

export const auditViews = [
  "My work",
  "Overview",
  "Audit program",
  "Working papers",
  "Evidence vault",
  "Testing lab",
  "Assurance workbench",
  "Findings",
  "Regulatory mapping",
  "Reports & sign-off",
  "Methodology",
] as const;
export type ResumePreference = {
  tenantId: string;
  engagementId: string;
  view: string;
};
export const resumeKey = (userId: string) => "assurance:resume:v1:" + userId;
export function parseResume(raw: string | null): ResumePreference | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const value = JSON.parse(raw);
    return value &&
      typeof value.tenantId === "string" &&
      value.tenantId.length > 0 &&
      value.tenantId.length < 200 &&
      typeof value.engagementId === "string" &&
      value.engagementId.length > 0 &&
      value.engagementId.length < 200 &&
      auditViews.includes(value.view)
      ? {
          tenantId: value.tenantId,
          engagementId: value.engagementId,
          view: value.view,
        }
      : null;
  } catch {
    return null;
  }
}
export function permittedAuditView(view: string, role: string) {
  return auditViews.includes(view as (typeof auditViews)[number]) &&
    (!isClientRole(role) ||
      ["Overview", "Evidence vault", "Findings", "Reports & sign-off"].includes(
        view,
      ))
    ? view
    : "Overview";
}
