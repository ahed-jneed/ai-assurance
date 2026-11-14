"use client";
// The minimal shell for a signed-in account with no active role (#225): a
// person who was never given practice access, revoked staff and revoked
// client members. It shows no practice navigation, breadcrumb or search,
// only who is signed in, why the workspace is closed to them, and the
// account menu (Sign out, and Switch persona on the development server).
// It reuses the client portal's header styles (app/client-portal.css).
import type { ReactNode } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NoAccessShell({
  name,
  error,
  account,
  onRetry,
}: {
  /** The signed-in name or email the refusal named, if any. */
  name: string;
  /** Why the workspace refused the account, as the server said. */
  error: string;
  /** The account menu (app/account-menu.tsx). */
  account: ReactNode;
  onRetry: () => void;
}) {
  return (
    <div className="relative flex min-h-svh w-full flex-col bg-background client-portal-inset">
      <a href="#audit-main-content" className="audit-skip-link">
        Skip to main content
      </a>
      <header className="client-portal-header">
        <div className="client-portal-bar">
          <div className="client-portal-brand">
            <span className="client-portal-symbol" aria-hidden="true">
              <ShieldCheck size={18} />
            </span>
            <span className="client-portal-brand-copy">
              <b>AI Assurance</b>
            </span>
          </div>
          <div className="client-portal-account">
            <span className="client-portal-identity">
              <b>{name || "Signed in"}</b> <small>No practice access</small>
            </span>
            {account}
          </div>
        </div>
      </header>
      <main id="audit-main-content" tabIndex={-1} className="audit-main">
        <div className="empty-state">
          <ShieldCheck size={28} />
          <h1 className="text-lg font-semibold">
            You have no access to a practice
          </h1>
          <p role="alert">
            {error ||
              "Your account has no active practice role. Ask a practice administrator for access."}
          </p>
          <p>
            Sign out from the account menu, or try again once an administrator
            has given you access.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </Button>
        </div>
      </main>
    </div>
  );
}
