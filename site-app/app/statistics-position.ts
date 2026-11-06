// What the results table says about a statistics 1.0.0 entry's point
// estimate against its band. The interval decides; this column only says
// where the estimate lies, and never claims a band edge it did not see.
import { humanLabel } from "@/lib/presentation";

export type PositionInput = {
  role: "headline" | "member" | "descriptive";
  band: unknown;
  status: string;
  direction: string;
  reasons?: string[] | null;
};

const SIDE: Record<string, string> = {
  pass: "Estimate within band",
  fail: "Estimate outside band",
};

export function positionLabel(d: PositionInput): string {
  if (d.status !== "evaluated") return humanLabel(d.status);
  if (d.role === "descriptive") return "Descriptive, no band";
  if (!d.band) return "No band";
  const side = SIDE[d.direction];
  if (side) return side;
  if (d.direction === "none")
    return d.reasons?.includes("estimate_on_band_boundary")
      ? "Estimate on the band edge"
      : "Not decided";
  return humanLabel(d.direction);
}
