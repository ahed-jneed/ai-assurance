import type { Artifact } from "../domain";
import { ApiError } from "../http";
import { id, now } from "../ids";
import {
  basisInputSchema,
  clientPinInputSchema,
  heldByClient,
  normalizeColumn,
  type SpecialCategoryBasis,
} from "../special-category";
import { defineCommands } from "./command";
/** The UTC calendar date after the instant `at`. */
function tomorrow(at: string) {
  return new Date(Date.parse(at) + 86_400_000).toISOString().slice(0, 10);
}
/**
 * The client's bases for special-category data (#60, D-11): recorded before
 * such data reach the platform, then declared with fairness protocols.
 * Records are append-only; a corrected basis is a new record.
 */
export const specialCategory = defineCommands({
  recordSpecialCategoryBasis: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const v = basisInputSchema.parse(d),
        at = now();
      // One day of slack: a client east of UTC confirms on its own date,
      // which can be a day ahead of the UTC date.
      if (v.confirmedOn > tomorrow(at))
        throw new ApiError(400, "The client cannot confirm a basis in future");
      if (new Set(v.columns.map(normalizeColumn)).size !== v.columns.length)
        throw new ApiError(400, "List each column once");
      const b: SpecialCategoryBasis = {
        ...v,
        id: id("BASIS"),
        recordedBy: ctx.user.userId,
        recordedAt: at,
      };
      (e.specialCategoryBases ??= []).push(b);
      return {
        details: {
          basisId: b.id,
          kind: b.kind,
          provision:
            b.kind === "art4a"
              ? "Art 4a(" + b.paragraph + ")"
              : "GDPR Art 9(2)(" + b.point + ")",
          columns: b.columns,
          confirmedBy: b.confirmedBy,
          confirmedOn: b.confirmedOn,
        },
      };
    },
  },
  /**
   * Pins a dataset the client keeps (#102): the platform records its name,
   * size and SHA-256 as Dataset evidence without bytes. Accepted like other
   * evidence, only a client-local job on the client's own worker can use it.
   */
  pinClientDataset: {
    roles: ["Auditor", "Lead Auditor"],
    handle(e, d, ctx) {
      const v = clientPinInputSchema.parse(d),
        at = now();
      if (v.confirmedOn > tomorrow(at))
        throw new ApiError(400, "The client cannot confirm a pin in future");
      if (e.artifacts.some((a) => heldByClient(a) && a.sha256 === v.sha256))
        throw new ApiError(409, "This client-held dataset is already pinned");
      const artifact: Artifact = {
        id: id("EV"),
        name: v.name,
        category: "Dataset",
        size: v.size,
        sha256: v.sha256,
        key: "",
        createdAt: at,
        uploadedBy: ctx.user.userId,
        visibility: "internal",
        status: "unverified",
        mediaType: "text/csv",
        custody: "client",
        clientPin: {
          confirmedBy: v.confirmedBy,
          confirmedOn: v.confirmedOn,
          custodyNote: v.custodyNote,
        },
      };
      e.artifacts.push(artifact);
      return {
        details: {
          artifactId: artifact.id,
          sha256: v.sha256,
          size: v.size,
          custody: "client",
          confirmedBy: v.confirmedBy,
          confirmedOn: v.confirmedOn,
        },
      };
    },
  },
});
