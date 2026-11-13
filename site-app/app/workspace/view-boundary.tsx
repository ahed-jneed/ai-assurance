"use client";
// Error boundaries (F-70): a render exception in one view, sheet or dialog
// shows a "Reload view" notice in its place instead of blanking the
// workspace, so the sidebar, the other panes and their unsaved entries stay.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  /** What failed, in the notice: "view", "record" or "dialog". */
  label?: string;
  /** Runs before the boundary renders its children again, e.g. a data reload. */
  onReload?: () => unknown;
  children: ReactNode;
};
type State = { error: Error | null };

export class ViewBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "Workspace view failed to render",
      error,
      info.componentStack,
    );
  }
  reload = async () => {
    try {
      await this.props.onReload?.();
    } finally {
      this.setState({ error: null });
    }
  };
  render() {
    if (this.state.error)
      return (
        <ViewFailure
          label={this.props.label ?? "view"}
          message={this.state.error.message}
          onReload={() => void this.reload()}
        />
      );
    return this.props.children;
  }
}

/** The notice a failed view shows. */
export function ViewFailure({
  label,
  message,
  onReload,
}: {
  label: string;
  message: string;
  onReload: () => void;
}) {
  return (
    <div className="view-failure" role="alert">
      <AlertTriangle size={24} />
      <h3>This {label} could not be shown</h3>
      <p>
        Something went wrong while displaying it. Your other open work is kept.
        Reload the {label} to try again; if it keeps failing, report the message
        below.
      </p>
      {message && <code className="view-failure-message">{message}</code>}
      <Button type="button" onClick={onReload}>
        <RefreshCw size={14} /> Reload {label}
      </Button>
    </div>
  );
}
