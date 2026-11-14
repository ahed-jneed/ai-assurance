import { describe, expect, it } from "vitest";
import { focusState, refusalTarget } from "./use-refusal-focus";

// Stand-ins for elements: the unit tests run without a DOM. The real
// dialogs are covered in e2e/round4-ui.spec.ts with real keys.
const body = { name: "body" },
  modal = { name: "modal" },
  submit = { name: "submit" },
  field = { name: "field" },
  disabledField = { name: "disabled field" },
  alert = { name: "alert" },
  standing = { name: "standing alert" };
const focusable = (el: object) => el !== disabledField;

describe("refusalTarget (#227)", () => {
  it("prefers the first field in error that can take focus", () => {
    expect(
      refusalTarget([disabledField, field], [alert], {
        focusable,
        fresh: () => true,
        lost: true,
      }),
    ).toBe(field);
  });

  it("falls back to the alert, then to nothing", () => {
    expect(
      refusalTarget([disabledField], [alert], {
        focusable,
        fresh: () => true,
        lost: true,
      }),
    ).toBe(alert);
    expect(
      refusalTarget([], [], { focusable, fresh: () => true, lost: true }),
    ).toBeNull();
  });

  it("ignores a standing alert unless focus was lost", () => {
    const fresh = (el: object) => el !== standing;
    expect(
      refusalTarget([], [standing, alert], { focusable, fresh, lost: false }),
    ).toBe(alert);
    expect(
      refusalTarget([], [standing], { focusable, fresh, lost: false }),
    ).toBeNull();
    expect(
      refusalTarget([], [standing], { focusable, fresh, lost: true }),
    ).toBe(standing);
  });
});

describe("focusState (#227)", () => {
  const where = { body, modal, origin: submit };
  it("treats <body>, nowhere and the modal itself as lost focus", () => {
    expect(focusState(body, where)).toBe("lost");
    expect(focusState(null, where)).toBe("lost");
    expect(focusState(modal, where)).toBe("lost");
  });

  it("tells focus still on the submit from focus the person moved", () => {
    expect(focusState(submit, where)).toBe("origin");
    expect(focusState(field, where)).toBe("moved");
  });
});
