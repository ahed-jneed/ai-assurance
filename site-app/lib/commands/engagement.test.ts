// The engagement record commands beyond their role check: accepting evidence
// once (#201 item 2).
import { describe, expect, it } from "vitest";
import { ApiError } from "../http";
import { artifact } from "../workflow/test-fixtures";
import { engagement } from "./engagement";
import { caller, stored } from "./test-fixtures";

async function refusal(run: () => unknown) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return [error.status, error.message];
    throw error;
  }
  return [200, ""];
}

describe("acceptEvidence", () => {
  it("accepts unverified evidence and attests its digest", async () => {
    const e = stored();
    e.artifacts = [artifact({ id: "EV-1", status: "unverified" })];
    expect(
      await engagement.run(
        e,
        "acceptEvidence",
        { artifactId: "EV-1" },
        caller(),
      ),
    ).toEqual({ details: { artifactId: "EV-1", sha256: "a".repeat(64) } });
    expect(e.artifacts[0].status).toBe("accepted");
  });

  it("refuses evidence that is already accepted, so no second Accept Evidence event is attested", async () => {
    const e = stored();
    e.artifacts = [artifact({ id: "EV-1", status: "unverified" })];
    await engagement.run(e, "acceptEvidence", { artifactId: "EV-1" }, caller());
    const before = structuredClone(e);
    expect(
      await refusal(() =>
        engagement.run(e, "acceptEvidence", { artifactId: "EV-1" }, caller()),
      ),
    ).toEqual([409, "This evidence is already accepted"]);
    expect(e).toEqual(before);
  });

  it("still refuses unknown evidence and model binaries", async () => {
    const e = stored();
    e.artifacts = [
      artifact({ id: "EV-M", category: "Model", status: "quarantined" }),
    ];
    expect(
      (
        await refusal(() =>
          engagement.run(e, "acceptEvidence", { artifactId: "EV-9" }, caller()),
        )
      )[0],
    ).toBe(404);
    expect(
      (
        await refusal(() =>
          engagement.run(e, "acceptEvidence", { artifactId: "EV-M" }, caller()),
        )
      )[0],
    ).toBe(400);
  });
});
