import { describe, expect, it } from "vitest";
import type { Engagement } from "@/lib/domain";
import { clientOverviewStats } from "./client-overview";

const artifact = (
  id: string,
  status: "accepted" | "unverified",
  visibility: "client" | "internal" = "client",
) => ({ id, status, visibility });

// The client projection's records, reduced to what the counts read.
const engagement = {
  reports: [{ id: "r1" }],
  findings: [
    { id: "f1", status: "open" },
    { id: "f2", status: "closed" },
  ],
  artifacts: [
    artifact("a1", "accepted"),
    // A contributor's own submissions: one pending, one accepted for
    // internal use only.
    artifact("a2", "unverified"),
    artifact("a3", "accepted", "internal"),
  ],
} as unknown as Engagement;

describe("clientOverviewStats (#36, F-72)", () => {
  it("counts only accepted, client-shared evidence as accepted", () => {
    expect(clientOverviewStats(engagement, "Client Viewer")).toEqual([
      ["Released reports", 1],
      ["Shared findings", 1],
      ["Accepted evidence", 1],
    ]);
  });

  it("counts a contributor's unaccepted uploads apart and shows no findings", () => {
    expect(clientOverviewStats(engagement, "Client Contributor")).toEqual([
      ["Released reports", 1],
      ["Accepted evidence", 1],
      ["Your submissions awaiting review", 1],
    ]);
  });
});
