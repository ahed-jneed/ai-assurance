// Stable props for the memoised workspace views (#63, F-48): an unchanged
// location or navigation object keeps its identity, so React.memo skips the
// views that do not read what changed.
import { describe, expect, it, vi } from "vitest";
import { stabilize } from "./stable-shape";

const handler = vi.fn((path: readonly string[]) => {
  const stable = () => path.join(".");
  return stable;
});

describe("stabilize", () => {
  it("returns the previous object when only the handlers are new", () => {
    const first = stabilize(
      undefined,
      {
        view: "Findings",
        register: { search: "", query: { search: "", sort: "newest" } },
        setSearch: () => {},
      },
      handler,
    );
    const second = stabilize(
      first,
      {
        view: "Findings",
        register: { search: "", query: { search: "", sort: "newest" } },
        setSearch: () => {},
      },
      handler,
    );
    expect(second).toBe(first);
    expect(first.setSearch()).toBe("setSearch");
  });

  it("keeps the unchanged parts when one value changes", () => {
    const first = stabilize(
      undefined,
      {
        view: "Findings",
        register: { search: "", setSearch: () => {} },
        workbench: { section: "systems", search: "" },
        open: () => {},
      },
      handler,
    );
    const second = stabilize(
      first,
      {
        view: "Findings",
        register: { search: "a", setSearch: () => {} },
        workbench: { section: "systems", search: "" },
        open: () => {},
      },
      handler,
    );
    expect(second).not.toBe(first);
    expect(second.register).not.toBe(first.register);
    expect(second.register.search).toBe("a");
    // A handler keeps its identity inside a changed object.
    expect(second.register.setSearch).toBe(first.register.setSearch);
    expect(second.workbench).toBe(first.workbench);
    expect(second.open).toBe(first.open);
  });

  it("compares below `depth` by identity", () => {
    const engagement = { id: "E-1", papers: [] };
    const first = stabilize(undefined, { data: { engagement } }, handler, 2);
    expect(stabilize(first, { data: { engagement } }, handler, 2)).toBe(first);
    const reloaded = stabilize(
      first,
      { data: { engagement: { id: "E-1", papers: [] } } },
      handler,
      2,
    );
    expect(reloaded.data.engagement).not.toBe(engagement);
  });

  it("notices added and removed keys and handlers that come and go", () => {
    const first = stabilize(
      undefined,
      { a: 1, onNew: undefined as unknown },
      handler,
    );
    const second = stabilize(first, { a: 1, onNew: () => {} }, handler);
    expect(second).not.toBe(first);
    expect(typeof second.onNew).toBe("function");
    expect(stabilize(second, { a: 1, onNew: undefined }, handler).onNew).toBe(
      undefined,
    );
    expect(stabilize(first, { a: 1 }, handler)).not.toBe(first);
  });

  it("compares arrays entry by entry and class instances by identity", () => {
    const first = stabilize(
      undefined,
      { rows: [{ id: 1 }], none: [], when: new Date(0) },
      handler,
    );
    // An empty list or equal rows made anew keep the previous array.
    expect(
      stabilize(
        first,
        { rows: [{ id: 1 }], none: [], when: first.when },
        handler,
      ),
    ).toBe(first);
    expect(
      stabilize(
        first,
        { rows: [{ id: 2 }], none: [], when: first.when },
        handler,
      ).rows,
    ).not.toBe(first.rows);
    expect(
      stabilize(first, { ...first, when: new Date(0) }, handler).when,
    ).not.toBe(first.when);
  });
});
