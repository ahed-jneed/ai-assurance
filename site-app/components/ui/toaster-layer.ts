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
