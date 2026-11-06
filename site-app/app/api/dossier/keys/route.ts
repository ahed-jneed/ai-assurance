import { context, responseError } from "@/lib/store";
import { verificationKeys } from "@/lib/signing-keys";
export const dynamic = "force-dynamic";
/**
 * The practice's verification keys, active and retired, for any member: each
 * dossier and briefing packet names its key ID (in a dossier's signed
 * manifest as signingKeyId). `trust` is in the --trusted-keys format of
 * `python -m engine.assurance verify`; confirm it through a channel
 * independent of this server before relying on it.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context(
      new URL(request.url).searchParams.get("tenantId") ?? "",
    );
    const keys = await verificationKeys(ctx);
    return Response.json(
      {
        tenantId: ctx.tenantId,
        keys,
        trust: Object.fromEntries(keys.map((k) => [k.keyId, k.publicKeySPKI])),
        note: "Retired keys stay listed so signatures made before a rotation still verify. Confirm these keys through a channel independent of this server before trusting them.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return responseError(e);
  }
}
