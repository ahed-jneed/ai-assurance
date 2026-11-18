// Sign-in for server-rendered pages. The identity comes from the adapter at
// the Worker entry (lib/identity.ts), whichever mode is configured.
// Server-only: Client Components build links with lib/auth-paths.ts instead.
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/auth-paths";
import { currentUser, type Identity } from "@/lib/identity";

/** The signed-in user, or a redirect to sign-in that returns to `returnTo`. */
export async function requireUser(returnTo: string): Promise<Identity> {
  const user = currentUser();
  if (user) return user;

  redirect(signInPath(returnTo));
}
