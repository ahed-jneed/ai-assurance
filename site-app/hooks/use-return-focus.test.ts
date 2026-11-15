import { describe, expect, it } from "vitest";
import { menuTriggerOf, returnFocusCandidates } from "./use-return-focus";

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

describe("menuTriggerOf (#241 item 6)", () => {
  const menuTrigger = { id: "trigger" };
  const element = (labelledBy: string | null) =>
    ({
      closest: (selector: string) =>
        selector.includes('role="menu"') && labelledBy !== null
          ? { getAttribute: () => labelledBy }
          : null,
      ownerDocument: {
        getElementById: (id: string) =>
          id === menuTrigger.id ? menuTrigger : null,
      },
    }) as unknown as Element;

  it("names the trigger that labels the menu an item sits in", () => {
    expect(menuTriggerOf(element("trigger"))).toBe(menuTrigger);
  });

  it("names none outside a menu or for a menu without its trigger", () => {
    expect(menuTriggerOf(element(null))).toBeNull();
    expect(menuTriggerOf(element("gone"))).toBeNull();
  });
});
