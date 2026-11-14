"use client";
// Keeps keyboard focus in a dialog or sheet after a refused submit (#227).
// A form disables its fieldset or its submit button while the request runs,
// and the browser then drops focus to <body>; when the server refuses, the
// error appears but the next Tab restarts behind the modal. The one rule,
// applied by the components in components/ui to every dialog and sheet:
// after a submit is refused, focus moves to the first field in error or,
// failing that, to the alert that states the refusal.
import { useCallback, useEffect, useRef, useState } from "react";

/** A field the form marked as in error. */
const invalidSelector = '[aria-invalid="true"]';
/** The message that states a refusal. */
const alertSelector = '[role="alert"]';

/**
 * Where focus goes after a refused submit: the first field in error that can
 * take focus, else the first alert, else nowhere. While focus is still where
 * the submit started (it was never lost), only a refusal that appeared or
 * changed since the submit counts, so a standing warning does not take it.
 */
export function refusalTarget<T>(
  invalid: readonly T[],
  alerts: readonly T[],
  {
    focusable,
    fresh,
    lost,
  }: {
    focusable: (el: T) => boolean;
    fresh: (el: T) => boolean;
    lost: boolean;
  },
): T | null {
  const counts = (el: T) => lost || fresh(el);
  return (
    invalid.find((el) => counts(el) && focusable(el)) ??
    alerts.find(counts) ??
    null
  );
}

/**
 * Where focus is relative to the submit: "lost" on <body>, nowhere, or on the
 * modal itself (where Radix parks it when the focused element is removed);
 * "origin" still where the submit started; "moved" when the person moved it
 * elsewhere meanwhile, which the rule leaves alone.
 */
export function focusState<T>(
  active: T | null,
  { body, modal, origin }: { body: T; modal: T; origin: T | null },
): "lost" | "origin" | "moved" {
  if (!active || active === body || active === modal) return "lost";
  return active === origin ? "origin" : "moved";
}

function isFocusable(el: HTMLElement) {
  return (
    !el.closest("fieldset:disabled") &&
    !(el as HTMLButtonElement).disabled &&
    el.getClientRects().length > 0
  );
}

/**
 * Handlers and a ref for a dialog's or sheet's Radix Content: a submit (or a
 * click on a button, for actions without a form) arms the rule, and the
 * first refusal that appears while armed takes focus.
 */
export function useRefusalFocus<E extends HTMLElement>() {
  const [node, setNode] = useState<E | null>(null);
  const armed = useRef<{
    origin: Element | null;
    /** The refusals already shown when the submit started, with their text. */
    before: Map<Element, string>;
  } | null>(null);
  const ref = useCallback((el: E | null) => setNode(el), []);
  useEffect(() => {
    if (!node) return;
    const refusals = () => [
      ...node.querySelectorAll<HTMLElement>(
        invalidSelector + "," + alertSelector,
      ),
    ];
    const arm = (origin: Element | null) => {
      armed.current = {
        origin,
        before: new Map(refusals().map((el) => [el, el.textContent ?? ""])),
      };
    };
    const onSubmit = (event: Event) =>
      arm(
        (event as SubmitEvent).submitter ??
          (node.ownerDocument.activeElement as Element | null),
      );
    // An action without a form (Save revision in the paper sheet) is a
    // submit button outside a form. components/ui/button.tsx sets no default
    // type, so any untyped <Button> in the modal arms the rule too; only
    // explicit type="button" controls (tabs, toggles, Add row) never do.
    // That is harmless: a refusal already standing takes focus only once
    // focus is lost (on <body> or the modal), never from where it was.
    const onClick = (event: Event) => {
      const button = (event.target as Element | null)?.closest?.("button");
      if (
        button &&
        node.contains(button) &&
        !button.form &&
        button.type === "submit"
      )
        arm(button);
    };
    const check = () => {
      const pending = armed.current;
      if (!pending) return;
      const doc = node.ownerDocument;
      const state = focusState<Element>(doc.activeElement, {
        body: doc.body,
        modal: node,
        origin: pending.origin,
      });
      if (state === "moved") {
        armed.current = null;
        return;
      }
      // While the request runs (its submit button disabled), only a refusal
      // that appeared or changed counts: a standing one from an earlier
      // attempt waits until the request settles.
      const origin = pending.origin,
        inFlight =
          origin instanceof HTMLElement &&
          origin.isConnected &&
          !isFocusable(origin);
      const visible = (el: HTMLElement) => el.getClientRects().length > 0;
      const target = refusalTarget(
        [...node.querySelectorAll<HTMLElement>(invalidSelector)].filter(
          visible,
        ),
        [...node.querySelectorAll<HTMLElement>(alertSelector)].filter(visible),
        {
          focusable: isFocusable,
          fresh: (el) => pending.before.get(el) !== (el.textContent ?? ""),
          lost: state === "lost" && !inFlight,
        },
      );
      if (!target) return;
      if (target.matches(alertSelector) && !target.hasAttribute("tabindex"))
        target.tabIndex = -1;
      target.focus({ preventScroll: true });
      // A field still inside the disabled fieldset takes focus once the
      // request settles; the rule stays armed until then.
      if (doc.activeElement === target) {
        armed.current = null;
        target.scrollIntoView?.({ block: "nearest" });
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-invalid", "role", "disabled"],
    });
    node.addEventListener("submit", onSubmit, true);
    node.addEventListener("click", onClick, true);
    return () => {
      observer.disconnect();
      node.removeEventListener("submit", onSubmit, true);
      node.removeEventListener("click", onClick, true);
    };
  }, [node]);
  return ref;
}
