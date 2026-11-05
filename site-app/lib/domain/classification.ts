// Regulatory classification of the assessed system under the EU AI Act,
// and the high-risk requirement articles the workspace tracks.
export type Classification = {
  prohibited: boolean;
  highRisk: boolean;
  transparency: boolean;
  profiling: boolean;
  annexRoute: string;
  operatorRole: string;
  intendedPurpose: string;
  rationale: string;
  status: "provisional" | "approved";
  approvedBy?: string;
  version: string;
  asOf: string;
};
export const articleNames: Record<string, string> = {
  "9": "Risk management",
  "10": "Data & data governance",
  "11": "Technical documentation",
  "12": "Record-keeping",
  "13": "Deployer transparency",
  "14": "Human oversight",
  "15": "Accuracy, robustness & security",
};
export function classify(c: Classification) {
  return c.annexRoute === "Unassessed" && !c.intendedPurpose
    ? "Unassessed"
    : c.prohibited
      ? "Prohibited"
      : c.highRisk
        ? "High risk"
        : c.transparency
          ? "Specific transparency"
          : "Minimal risk";
}
