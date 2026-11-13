"use client";
import { useEffect, useState } from "react";

/**
 * The current time for render-time checks such as expiry, refreshed every
 * minute and whenever the window regains focus. Reading Date.now() during
 * render instead would make the output impure and never update on its own.
 */
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);
  return now;
}
