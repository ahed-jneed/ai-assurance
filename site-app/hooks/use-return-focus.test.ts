import { describe, expect, it } from "vitest";
import { returnFocusCandidates } from "./use-return-focus";

// Stand-ins for elements: the unit tests run without a DOM.
const body = { isConnected: true },
  trigger = { isConnected: true },
  opener = { isConnected: true },
  other = { isConnected: true },
  removedItem = { isConnected: false };

describe("returnFocusCandidates", () => {
  it("offers the latest focused element first when focus fell to the body", () => {
    expect(returnFocusCandidates([trigger, opener], body, body)).toEqual([
      opener,
      trigger,
    ]);
    expect(returnFocusCandidates([opener], null, body)).toEqual([opener]);
  });

  it("skips elements no longer in the document and the body", () => {
    // A dialog opened from a menu item: the item is gone, its trigger is not.
    expect(
      returnFocusCandidates([trigger, removedItem, body], body, body),
    ).toEqual([trigger]);
  });

  it("offers each element once", () => {
    expect(
      returnFocusCandidates([opener, trigger, opener], body, body),
    ).toEqual([opener, trigger]);
  });

  it("leaves focus alone when something else holds it", () => {
    expect(returnFocusCandidates([opener], other, body)).toEqual([]);
  });
});
