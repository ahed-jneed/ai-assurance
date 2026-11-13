// The pin form reads the pin tool's file (#134), never the dataset.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pinFileFields } from "./special-category";

describe("pinFileFields", () => {
  const pinFile = readFileSync(
    new URL(
      "../../engine/tests/fixtures/client-pin/attested-pin.json",
      import.meta.url,
    ),
    "utf8",
  );

  it("fills the pin form from the pin tool's file, attestation included", () => {
    const fields = pinFileFields(pinFile)!;
    expect(fields).toMatchObject({
      name: "client-data.csv",
      size: "89",
      columns: "label\nprediction\nethnicity",
      confirmedOn: "2026-11-05",
    });
    expect(fields.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fields.attestation).toMatchObject({ algorithm: "Ed25519" });
  });

  it("refuses anything but a pin file, such as the dataset itself", () => {
    const dataset = readFileSync(
      new URL(
        "../../engine/tests/fixtures/client-pin/client-data.csv",
        import.meta.url,
      ),
      "utf8",
    );
    expect(pinFileFields(dataset)).toBeNull();
    expect(pinFileFields("[]")).toBeNull();
    expect(pinFileFields('{"sha256":"a","size":1,"columns":[1]}')).toBeNull();
  });
});
