"use client";
// The signed-in account: who and in which role, the operator console for
// platform operators, Sign out, and on the development server a switch to
// another test persona. Sign-in and sign-out
// are top-level navigations that come back to the current location.
import { LogOut, ServerCog, UserRound, UsersRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import personaFixture from "@/fixtures/dev-personas.json";
import { signInLabel, signInPath, signOutPath } from "@/lib/auth-paths";
import type { WorkspaceData } from "./workspace-types";

/** "sites" in the Sites build, else undefined (`define` in vite.config.ts). */
declare const __SITES_IDENTITY_DEFAULT__: "sites" | undefined;

/**
 * Test personas, on the development server only: in a build the condition is
 * false, so the fixture and the persona controls are left out of the bundle.
 */
const devPersonas = import.meta.env.DEV ? personaFixture.personas : [];

/**
 * The sign-in button's text: "Sign in with ChatGPT" in the Sites build and on
 * the development server, "Sign in" in every other build. Compiled in, so the
 * browser reads nothing to choose it.
 */
export const SIGN_IN_LABEL = signInLabel({
  devServer: import.meta.env.DEV,
  defaultMode: __SITES_IDENTITY_DEFAULT__,
});

/** The current location, to return to after signing in or out. */
function here() {
  return typeof window === "undefined"
    ? "/"
    : window.location.pathname + window.location.search + window.location.hash;
}

/** Sign-in that comes back to the current location. */
export function signInHere(persona?: string) {
  return signInPath(here(), persona);
}

/** The development personas on the signed-out screen (nothing in a build). */
export function DevPersonaSignIn() {
  if (!import.meta.env.DEV || !devPersonas.length) return null;
  return (
    <nav aria-label="Development personas" className="mb-6 text-sm">
      <p className="subtle mb-2">Development personas (npm run seed:demo):</p>
      <ul className="grid gap-1">
        {devPersonas.map((persona) => (
          <li key={persona.id}>
            <a
              className="underline"
              href={signInHere(persona.id)}
              target="_top"
            >
              {persona.name}
            </a>{" "}
            <span className="subtle">
              — {persona.role ?? "no demo practice access"}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The account menu in the sidebar footer. It is there whenever the account is
 * signed in, also when the workspace refused it (revoked or no practice
 * access): then it has no identity to show, but still offers Sign out and,
 * on the development server, another persona.
 */
export function AccountMenu({
  data,
  signedIn = !!data,
  side = "right",
}: {
  data: WorkspaceData | null;
  /** Signed in without workspace data, for example after a revocation. */
  signedIn?: boolean;
  /** Where the menu opens: beside the sidebar, or below the portal header. */
  side?: "right" | "bottom";
}) {
  if (!data && !signedIn) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="nav-preferences-trigger"
          aria-label={"Account" + (data ? ": " + data.identity.name : "")}
          title="Account"
        >
          <UserRound size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="nav-dark-menu"
        align="end"
        side={side}
        sideOffset={8}
      >
        <AccountMenuItems data={data} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Rendered when the menu opens, so the links return to the location at that
 * moment: the workspace rewrites the URL after it renders.
 */
function AccountMenuItems({ data }: { data: WorkspaceData | null }) {
  const practice = data?.memberships.find(
    (m) => m.tenant_id === data.tenantId,
  )?.name;
  const returnTo = here();
  return (
    <>
      <DropdownMenuLabel className="grid gap-0.5">
        {data ? (
          <>
            <span className="text-[13px] font-medium text-[#edf3ff]">
              {data.identity.name}
            </span>
            <span>
              {data.identity.role}
              {practice ? " · " + practice : ""}
            </span>
          </>
        ) : (
          <>
            <span className="text-[13px] font-medium text-[#edf3ff]">
              Signed in
            </span>
            <span>No practice access</span>
          </>
        )}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {import.meta.env.DEV && devPersonas.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <UsersRound size={16} aria-hidden="true" />
            Switch persona
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="nav-dark-menu">
            <DropdownMenuLabel>Development personas</DropdownMenuLabel>
            {devPersonas.map((persona) => (
              <DropdownMenuItem
                key={persona.id}
                asChild
                disabled={persona.userId === data?.identity.id}
              >
                <a href={signInPath(returnTo, persona.id)} target="_top">
                  <span className="grid">
                    <span>{persona.name}</span>
                    <small className="text-[11px] text-[#aebcd1]">
                      {persona.role ?? "No demo practice access"}
                    </small>
                  </span>
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {data?.identity.operator && (
        <DropdownMenuItem asChild>
          <a href="/operator" target="_top">
            <ServerCog size={16} aria-hidden="true" />
            Operator console
          </a>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <a href={signOutPath(returnTo)} target="_top">
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </a>
      </DropdownMenuItem>
    </>
  );
}
