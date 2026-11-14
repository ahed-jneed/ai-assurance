// Toasts stay usable above a modal sheet or dialog (#210). The toaster sits
// outside every modal Radix layer, so without this a click on a toast action
// dismissed the sheet (or was swallowed by its pointer-events lock) and focus
// could not leave the sheet's trap to reach it. The modal contents in
// components/ui ignore outside interactions inside the toaster, and the
// Toaster (sonner.tsx) yields the focus trap while it holds focus.

/** The toaster's list, as sonner renders it. */
export const toasterSelector = "[data-sonner-toaster]";

/** Whether a node lies inside the toaster. */
export const inToaster = (node: unknown) =>
  typeof Element !== "undefined" &&
  node instanceof Element &&
  !!node.closest(toasterSelector);

/** An open modal sheet or dialog, as components/ui renders it. */
const modalSelector = [
  "dialog-content",
  "sheet-content",
  "alert-dialog-content",
]
  .map((slot) => `[data-slot="${slot}"][data-state="open"]`)
  .join(",");

/** The topmost open modal sheet or dialog, if one is open. */
export function openModal(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const open = document.querySelectorAll<HTMLElement>(modalSelector);
  return open[open.length - 1] ?? null;
}

/**
 * Wraps a modal content's onPointerDownOutside / onFocusOutside /
 * onInteractOutside handler: an interaction inside the toaster never
 * dismisses the modal.
 */
export function keepOpenForToasts<
  E extends { target: EventTarget | null; preventDefault(): void },
>(handler?: (event: E) => void) {
  return (event: E) => {
    handler?.(event);
    if (inToaster(event.target)) event.preventDefault();
  };
}

const tabbableSelector =
  "a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])";

/** The elements Tab visits inside `root`, in document order. */
export function tabbables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(tabbableSelector)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      el.getClientRects().length > 0,
  );
}

/**
 * Whether Tab (or Shift+Tab) from `active` leaves the toaster's controls
 * (#227): from the last control forwards, or from the first backwards. The
 * list itself, which Alt+T focuses, comes before its controls. With a modal
 * open, focus then returns into the modal instead of reaching the page
 * behind it.
 */
export function leavesToaster<T>(
  controls: readonly T[],
  active: T,
  backwards: boolean,
) {
  const at = controls.indexOf(active);
  if (at < 0) return backwards || !controls.length;
  return backwards ? at === 0 : at === controls.length - 1;
}
