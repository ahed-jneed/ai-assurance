"use client";
// A permission-aware action (F-45, F-74): hidden from roles the server never
// admits, and shown disabled with the server's reason to someone the record's
// independence rule bars, so nobody clicks into a 403.
import { useId, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/permissions";

export function DecisionButton({
  state,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { state: ActionState }) {
  const id = useId();
  if (state.refusal === "role") return null;
  const reason = state.allowed ? undefined : state.reason;
  return (
    <span className="decision-action">
      <Button
        {...props}
        disabled={disabled || !state.allowed}
        aria-describedby={reason ? id : undefined}
      >
        {children}
      </Button>
      {reason && (
        <small id={id} className="action-reason">
          {reason}
        </small>
      )}
    </span>
  );
}
