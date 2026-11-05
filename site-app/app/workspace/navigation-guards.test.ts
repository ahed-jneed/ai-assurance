import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info } }));

import {
  navigationGuard,
  reportEditing,
  type NavigationGuardState,
} from "./navigation-guards";

describe("reportEditing", () => {
  it("tracks each editor separately", () => {
    let open = reportEditing([], "audit-program", true);
    open = reportEditing(open, "finding-assurance", true);
    // The record sheet's editor closing leaves the program's editor open;
    // a single shared flag would have cleared both.
    open = reportEditing(open, "finding-assurance", false);
    expect(open).toEqual(["audit-program"]);
    expect(reportEditing(open, "audit-program", false)).toEqual([]);
  });

  it("keeps the same list when nothing changes", () => {
    const open = reportEditing([], "testing-lab", true);
    expect(reportEditing(open, "testing-lab", true)).toBe(open);
    expect(reportEditing(open, "report-release", false)).toBe(open);
  });
});

describe("navigationGuard", () => {
  const clear: NavigationGuardState = {
    busy: false,
    loading: false,
    bootstrapping: false,
    modal: "",
    isModalSubmitting: () => false,
    editorOpen: false,
    view: "Overview",
    isDirty: () => false,
    confirmDiscard: () => {},
  };
  beforeEach(() => info.mockClear());

  it("runs the change when nothing blocks it", () => {
    const next = vi.fn();
    expect(navigationGuard(clear)(next)).toBe("opened");
    expect(next).toHaveBeenCalledOnce();
  });

  it("refuses while the workspace is busy, loading or starting", () => {
    for (const state of [
      { busy: true },
      { loading: true },
      { bootstrapping: true },
    ]) {
      const next = vi.fn();
      expect(navigationGuard({ ...clear, ...state })(next)).toBe("busy");
      expect(next).not.toHaveBeenCalled();
    }
    expect(info).not.toHaveBeenCalled();
  });

  it("refuses while a form is open, except for the form's own save", () => {
    const next = vi.fn();
    expect(navigationGuard({ ...clear, modal: "finding" })(next)).toBe(
      "editor_open",
    );
    expect(info).toHaveBeenCalledWith(
      "Finish or cancel this form before changing workspace.",
    );
    expect(next).not.toHaveBeenCalled();
    expect(
      navigationGuard({
        ...clear,
        modal: "paper",
        isModalSubmitting: () => true,
      })(next),
    ).toBe("opened");
    expect(next).toHaveBeenCalledOnce();
  });

  it("refuses while a panel editor is open, naming the workbench", () => {
    const next = vi.fn();
    expect(navigationGuard({ ...clear, editorOpen: true })(next)).toBe(
      "editor_open",
    );
    expect(info).toHaveBeenLastCalledWith(
      "Finish or cancel the model/evaluation setup before changing workspace.",
    );
    navigationGuard({
      ...clear,
      editorOpen: true,
      view: "Assurance workbench",
    })(next);
    expect(info).toHaveBeenLastCalledWith(
      "Finish the pending workbench action or close your unsaved review before changing workspace.",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("asks to discard unsaved paper edits and defers the change", () => {
    const next = vi.fn(),
      confirmDiscard = vi.fn();
    expect(
      navigationGuard({ ...clear, isDirty: () => true, confirmDiscard })(next),
    ).toBe("needs_confirmation");
    expect(confirmDiscard).toHaveBeenCalledWith(next);
    expect(next).not.toHaveBeenCalled();
  });

  it("reads the submitting and dirty flags when the change is attempted", () => {
    let dirty = false;
    const guarded = navigationGuard({ ...clear, isDirty: () => dirty });
    dirty = true;
    expect(guarded(() => {})).toBe("needs_confirmation");
  });
});
