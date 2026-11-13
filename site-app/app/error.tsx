"use client";
// The app's last error boundary (F-70): a render exception outside a
// workspace view's own boundary lands here instead of a blank page.
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("The workspace failed to render", error);
  }, [error]);
  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert">
        <AlertTriangle size={40} />
        <p className="eyebrow">AI ASSURANCE</p>
        <h1>The workspace could not be shown</h1>
        <p className="body-copy">
          Something went wrong while displaying this page. Saved audit work is
          not affected. Try again, or reload the page.
        </p>
        {error.digest && <p className="subtle">Reference {error.digest}</p>}
        <div className="row-actions">
          <button type="button" className="signin-button" onClick={reset}>
            <RefreshCw size={14} /> Try again
          </button>
          <button
            type="button"
            className="download-link"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
