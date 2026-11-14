import { describe, expect, it } from "vitest";
import { focusAfterRemoval } from "./focus-order";

describe("focusAfterRemoval (#227)", () => {
  it("offers the next row first, then the previous rows nearest first", () => {
    expect(focusAfterRemoval(["a", "b", "c", "d"], "b")).toEqual([
      "c",
      "d",
      "a",
    ]);
    expect(focusAfterRemoval(["a", "b", "c"], "c")).toEqual(["b", "a"]);
  });

  it("offers nothing when the removed row was the only one", () => {
    expect(focusAfterRemoval(["a"], "a")).toEqual([]);
  });
});
