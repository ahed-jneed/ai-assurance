import { describe, expect, it } from "vitest";
import { datasetCardFor } from "./dataset-card";

const card = (id: string, artifactId: string, artifactSha256: string) => ({
  id,
  kind: "dataset",
  body: { artifactId, artifactSha256 },
});
// In registration order, as the assurance records API returns them.
const cards = [
  card("CARD-A1", "EV-A", "a".repeat(64)),
  card("CARD-B1", "EV-B", "b".repeat(64)),
  card("CARD-A2", "EV-A", "a".repeat(64)),
  card("CARD-A-OLD", "EV-A", "0".repeat(64)),
  { ...card("SAMPLE", "EV-A", "a".repeat(64)), kind: "sample" },
];
const a = { id: "EV-A", sha256: "a".repeat(64) },
  b = { id: "EV-B", sha256: "b".repeat(64) };

describe("datasetCardFor", () => {
  it("pins the card handed over when it describes the evaluated bytes", () => {
    expect(datasetCardFor(cards, a, "CARD-A1")?.id).toBe("CARD-A1");
  });

  it("picks the latest card of the evaluated bytes otherwise", () => {
    expect(datasetCardFor(cards, a)?.id).toBe("CARD-A2");
    expect(datasetCardFor(cards, b)?.id).toBe("CARD-B1");
  });

  it("never pins a card of other bytes, so a hand-off cannot leak into another evaluation", () => {
    // The Workbench handed over dataset A's card; the next evaluation uses B.
    expect(datasetCardFor(cards, b, "CARD-A1")?.id).toBe("CARD-B1");
    // A card registered for earlier bytes of the same artifact.
    expect(datasetCardFor(cards, a, "CARD-A-OLD")?.id).toBe("CARD-A2");
    expect(
      datasetCardFor(cards, { id: "EV-C", sha256: "c".repeat(64) }, "CARD-A1"),
    ).toBeUndefined();
  });

  it("pins nothing without accepted evaluation bytes", () => {
    expect(datasetCardFor(cards, undefined, "CARD-A1")).toBeUndefined();
  });
});
