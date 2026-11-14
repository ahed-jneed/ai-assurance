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

  it("keeps the Testing lab's setup open when its dataset card form closes", () => {
    // Both editors live in the Testing lab; each reports under its own key.
    let open = reportEditing([], "testing-lab", true);
    open = reportEditing(open, "dataset-registry", true);
    open = reportEditing(open, "dataset-registry", false);
    expect(open).toEqual(["testing-lab"]);
  });

  it("keeps an open special-category basis form apart from the lab's other editors", () => {
    // The basis form and the dataset card form share the Datasets tab; the
    // card form closing must not release the unsaved basis (#103).
    let open = reportEditing([], "special-category-basis", true);
    open = reportEditing(open, "dataset-registry", true);
    open = reportEditing(open, "dataset-registry", false);
    expect(open).toEqual(["special-category-basis"]);
    expect(
      navigationGuard({
        busy: false,
        loading: false,
        bootstrapping: false,
        modal: "",
        isModalSubmitting: () => false,
        editorOpen: open.length > 0,
        view: "Testing lab",
        isDirty: () => false,
        confirmDiscard: () => {},
      })(() => {
        throw Error("must not navigate");
      }),
    ).toBe("editor_open");
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

  it("reads the editors as last reported, ahead of the render (#202)", () => {
    // A workbench action that has finished reports the workbench idle and
    // opens the compiled paper in the same effect: the guard built by the
    // earlier render still holds editorOpen, the report does not.
    const next = vi.fn();
    expect(
      navigationGuard({
        ...clear,
        editorOpen: true,
        view: "Assurance workbench",
        isEditorOpen: () => false,
      })(next),
    ).toBe("opened");
    expect(next).toHaveBeenCalledOnce();
    expect(info).not.toHaveBeenCalled();
    expect(
      navigationGuard({ ...clear, isEditorOpen: () => true })(vi.fn()),
    ).toBe("editor_open");
  });

  it("reads whether a command is in flight as it is now, ahead of the render (#226)", () => {
    // "Queue planned evaluation" opens the queued run when queueRun
    // resolves: the stable handler calls the guard of the render committed
    // last, which still holds busy, while the command itself has finished.
    const next = vi.fn();
    expect(
      navigationGuard({ ...clear, busy: true, isBusy: () => false })(next),
    ).toBe("opened");
    expect(next).toHaveBeenCalledOnce();
    expect(navigationGuard({ ...clear, isBusy: () => true })(vi.fn())).toBe(
      "busy",
    );
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
