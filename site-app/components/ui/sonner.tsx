"use client"

import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { FocusScope } from "radix-ui/internal"
import { Toaster as Sonner, useSonner, type ToasterProps } from "sonner"
import {
  inToaster,
  leavesToaster,
  openModal,
  tabbables,
  toasterSelector,
} from "@/components/ui/toaster-layer"

const preventAutoFocus = (event: Event) => event.preventDefault()

/**
 * Local change (#210): toasts stay usable while a modal sheet or dialog is
 * open. Toast buttons take pointer events through the modal's pointer lock
 * (app/globals.css; the modal contents ignore clicks inside the toaster, see
 * toaster-layer.ts), and Alt+T
 * reaches it from the keyboard: while the toaster holds focus an empty,
 * untrapped focus scope is mounted, which pauses the open modal's focus trap
 * (Radix pauses the scope below the newest one). Escape, or moving focus out,
 * returns focus to where it was and resumes the trap; with a modal open,
 * Escape returns to the modal when focus was on <body> before (#216).
 * Without a modal, Escape is left to sonner, which collapses the stack.
 * Tab from the last toast control, or Shift+Tab from the first, returns into
 * the open modal the same way (#227) instead of reaching the page behind it.
 */
function useToasterFocus(hotkey: string[]) {
  const [yielding, setYielding] = useState(false)
  const previous = useRef<HTMLElement | null>(null)
  const { toasts } = useSonner()
  const empty = toasts.length === 0
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement
      const hot =
        hotkey.length > 0 &&
        hotkey.every(
          (key) => event[key as keyof KeyboardEvent] || event.code === key
        )
      if (hot && document.querySelector(toasterSelector)) {
        // <body> is not a place to return to (focus falls there when the
        // focused button becomes disabled, for example Save).
        if (!inToaster(active))
          previous.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null
        // Before sonner's own hotkey listener focuses the list.
        flushSync(() => setYielding(true))
      } else if (event.key === "Tab" && inToaster(active)) {
        const modal = openModal(),
          toaster = (active as Element).closest(toasterSelector)
        if (
          !modal ||
          !toaster ||
          !leavesToaster(tabbables(toaster), active, event.shiftKey)
        )
          return
        const before = previous.current?.isConnected ? previous.current : null
        const inside = tabbables(modal)
        previous.current = null
        event.preventDefault()
        event.stopPropagation()
        // Resume the modal's trap first, so its scope accepts the focus.
        flushSync(() => setYielding(false))
        ;(
          (before && modal.contains(before) ? before : null) ??
          (event.shiftKey ? inside[inside.length - 1] : inside[0]) ??
          modal
        ).focus()
      } else if (event.key === "Escape" && inToaster(active)) {
        const modal = openModal(),
          before = previous.current?.isConnected ? previous.current : null
        previous.current = null
        setYielding(false)
        if (modal) {
          // Escape leaves the toaster for the open sheet or dialog (#216:
          // the element focused before, else the modal itself); it does not
          // close the modal beneath.
          event.stopPropagation()
          event.preventDefault()
          ;(before && modal.contains(before) ? before : modal).focus()
        } else {
          // Without a modal, sonner's own Escape listener runs first and
          // collapses an expanded stack (#216); focus returns afterwards.
          setTimeout(() => {
            if (inToaster(document.activeElement)) before?.focus()
          })
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [hotkey])
  useEffect(() => {
    if (!yielding) return
    const onFocusIn = (event: FocusEvent) => {
      if (!inToaster(event.target)) setYielding(false)
    }
    document.addEventListener("focusin", onFocusIn)
    return () => document.removeEventListener("focusin", onFocusIn)
  }, [yielding])
  if (yielding && empty) setYielding(false)
  return yielding
}

const defaultHotkey = ["altKey", "KeyT"]

const Toaster = ({ hotkey = defaultHotkey, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const yielding = useToasterFocus(hotkey)

  return (
    <>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        hotkey={hotkey}
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
            // Rich toast text at 4.5:1 or more on its tinted background (#36).
            "--success-text": "#006b24",
            "--error-text": "#b42318",
            "--info-text": "#0a5cad",
            "--warning-text": "#8a5a12",
          } as React.CSSProperties
        }
        {...props}
      />
      {yielding && (
        <FocusScope.FocusScope
          hidden
          onMountAutoFocus={preventAutoFocus}
          onUnmountAutoFocus={preventAutoFocus}
        />
      )}
    </>
  )
}

export { Toaster }
