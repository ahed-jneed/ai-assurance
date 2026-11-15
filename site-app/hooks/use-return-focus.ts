"use client";
// Returns keyboard focus to the element that opened a dialog, sheet or alert
// dialog when it closes (#203). Radix returns focus only to a Trigger, and the
// workspace opens every dialog and sheet from state without one, so without
// this, closing one dropped focus to <body> and the next Tab restarted at the
// skip link. The components in components/ui spread these handlers onto
// their Radix Content.
import { useRef } from "react";

/**
 * The elements focused most recently, latest last. A dialog opened from a
 * menu item opens after the menu has removed that item, so focus has fallen
 * to <body>; the history still names the menu's trigger before it.
 */
const recent: HTMLElement[] = [];
function remember(el: HTMLElement) {
  const at = recent.indexOf(el);
  if (at >= 0) recent.splice(at, 1);
  recent.push(el);
  if (recent.length > 20) recent.shift();
}
/**
 * The trigger of the menu an element sits in. Opened by mouse, a Radix menu
 * never focuses its trigger (it prevents focus on pointerdown), so a dialog
 * opened from one of its items would otherwise return focus to whatever was
 * focused before the menu (#241 item 6). The menu content is labelled by its
 * trigger.
 */
export function menuTriggerOf(el: Element): HTMLElement | null {
  const menu = el.closest('[role="menu"][aria-labelledby]');
  const id = menu?.getAttribute("aria-labelledby");
  const trigger = id ? el.ownerDocument.getElementById(id) : null;
  return trigger && trigger !== el ? (trigger as HTMLElement) : null;
}
if (typeof document !== "undefined")
  document.addEventListener(
    "focusin",
    (event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      const trigger = menuTriggerOf(el);
      if (trigger) remember(trigger);
      remember(el);
    },
    true,
  );

/**
 * The elements a closing dialog may give focus back to, best first: the ones
 * focused before it opened, latest first, that are still in the document.
 * None when focus was claimed elsewhere meanwhile (for example by a dialog
 * that replaced this one): the dialog then leaves focus alone.
 */
export function returnFocusCandidates<T extends { isConnected: boolean }>(
  openers: readonly T[],
  active: unknown,
  body: unknown,
): T[] {
  if (active && active !== body) return [];
  return [...openers]
    .reverse()
    .filter((el) => el !== body && el.isConnected)
    .filter((el, i, all) => all.indexOf(el) === i);
}

export function useReturnFocus<E extends Event>(
  onOpenAutoFocus?: (event: E) => void,
  onCloseAutoFocus?: (event: E) => void,
) {
  const openers = useRef<HTMLElement[]>([]);
  return {
    onOpenAutoFocus(event: E) {
      // Radix fires this before it moves focus into the content.
      const active = document.activeElement;
      openers.current =
        active instanceof HTMLElement ? [...recent, active] : [...recent];
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: E) {
      onCloseAutoFocus?.(event);
      const candidates = returnFocusCandidates(
        openers.current,
        document.activeElement,
        document.body,
      );
      openers.current = [];
      if (event.defaultPrevented) return;
      // A disabled or hidden candidate does not take focus; try the next.
      for (const el of candidates) {
        el.focus({ preventScroll: true });
        if (document.activeElement === el) {
          // Only a successful return stops Radix's own handling.
          event.preventDefault();
          return;
        }
      }
    },
  };
}
