// Who may assign engagements with a membership, and what a refusal says
// (#201 item 6).
import { describe, expect, it } from "vitest";
import { caller } from "../test-fixtures";
import { checkAssignable } from "./engagement-grants";

describe("checkAssignable", () => {
  it("tells a Lead Auditor that client members get access through their client", async () => {
    for (const role of ["Client Viewer", "Client Contributor"])
      await expect(
        checkAssignable(caller("Lead Auditor"), role, ["ENG-1"]),
        role,
      ).rejects.toMatchObject({
        status: 400,
        message:
          "Client members get access through their client, not engagement grants. Remove the engagements and save again",
      });
  });

  it("keeps the role refusal for a caller who is not a Lead Auditor", async () => {
    for (const role of ["Auditor", "Client Viewer"])
      await expect(
        checkAssignable(caller("Auditor"), role, ["ENG-1"]),
        role,
      ).rejects.toMatchObject({
        status: 403,
        message: "Only a Lead Auditor may assign internal engagement access",
      });
  });

  it("checks nothing when no engagement is listed", async () => {
    await expect(
      checkAssignable(caller("Auditor"), "Client Viewer", []),
    ).resolves.toBeUndefined();
  });
});
