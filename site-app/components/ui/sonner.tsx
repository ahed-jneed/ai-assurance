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
import { inToaster, toasterSelector } from "@/components/ui/toaster-layer"

const preventAutoFocus = (event: Event) => event.preventDefault()

/**
 * Local change (#210): toasts stay usable while a modal sheet or dialog is
 * open. Toast buttons take pointer events through the modal's pointer lock
 * (app/globals.css; the modal contents ignore clicks inside the toaster, see
 * toaster-layer.ts), and Alt+T
 * reaches it from the keyboard: while the toaster holds focus an empty,
 * untrapped focus scope is mounted, which pauses the open modal's focus trap
 * (Radix pauses the scope below the newest one). Escape, or moving focus out,
 * returns focus to where it was and resumes the trap.
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
        if (!inToaster(active))
          previous.current = active instanceof HTMLElement ? active : null
        // Before sonner's own hotkey listener focuses the list.
        flushSync(() => setYielding(true))
      } else if (event.key === "Escape" && inToaster(active)) {
        // Escape leaves the toaster; it does not close the modal beneath.
        event.stopPropagation()
        event.preventDefault()
        previous.current?.focus()
        setYielding(false)
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
