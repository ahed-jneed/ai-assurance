// Attestation (F-45): the record, revision and digest a person signs off,
// approves, accepts or closes, with the rationale they give. The workspace's
// attestation dialog and POST /api/workspace compute the subject with the
// same functions, so the digest the person saw is the digest the server
// checks before the decision runs and records in the audit event.
import { z } from "zod";
import type { Engagement } from "./domain/types";
import { sha256 } from "./ids";

/** The decisions that need an attestation, with what the person declares. */
export const attestedOps = {
  signPaper: {
    title: "Sign working paper",
    action: "Sign revision",
    statement:
      "I sign this revision as Lead Auditor. I have read its content, the independent review is of this revision, and the evidence it cites supports its conclusion.",
  },
  approveClassification: {
    title: "Approve classification",
    action: "Approve classification",
    statement:
      "I approve this classification as an independent reviewer. I did not record it, and its answers and rationale support the route it states.",
  },
  setStage: {
    title: "Advance engagement stage",
    action: "Advance stage",
    statement:
      "I authorize this stage change as Lead Auditor. The work the current stage requires is complete and its gates are met.",
  },
  acceptEvidence: {
    title: "Accept evidence",
    action: "Accept evidence",
    statement:
      "I accept this file as audit evidence. I checked its source and content, and its SHA-256 is the file I examined.",
  },
  closeFinding: {
    title: "Close verified finding",
    action: "Close finding",
    statement:
      "I close this finding as an independent reviewer. The remediation and the effective retest on accepted evidence support closure.",
  },
} as const;
export type AttestedOp = keyof typeof attestedOps;
export function isAttestedOp(op: string): op is AttestedOp {
  return Object.hasOwn(attestedOps, op);
}

/** What a decision binds: one record at one revision, and its content. */
export type AttestationSubject = {
  /** The record's id, such as a paper id, or the engagement id. */
  record: string;
  /** What the dialog calls the record, e.g. "WP-12 Risk management". */
  label: string;
  /** The record's own revision, or the engagement version for records without one. */
  revision: number;
  /** A short description of what changes, shown next to the record. */
  change: string;
  /** The content the digest covers; absent when `digest` is a stored hash. */
  content?: unknown;
  /** A stored digest, such as an evidence file's SHA-256. */
  digest?: string;
};

/**
 * The subject of `op` on `e` with the command's `data`, or null when the
 * record is not there (the command itself then refuses with its own error).
 */
export function attestationSubject(
  e: Engagement,
  op: AttestedOp,
  data: Record<string, unknown>,
): AttestationSubject | null {
  switch (op) {
    case "signPaper": {
      const p = e.papers.find((p) => p.id === data.paperId);
      if (!p) return null;
      return {
        record: p.id,
        label: p.id + " " + p.title,
        revision: p.revision,
        change: "Status reviewed to signed",
        // The content the signature hash covers (lib/commands/papers.ts).
        content: {
          body: p.body,
          revision: p.revision,
          evidenceIds: p.evidenceIds,
          runIds: p.runIds,
        },
      };
    }
    case "approveClassification": {
      const c = e.classification;
      if (!c) return null;
      return {
        record: e.id + "/classification",
        label: "AI Act classification of " + e.title,
        revision: e.version,
        change: "Status " + c.status + " to approved",
        content: {
          operatorRole: c.operatorRole,
          annexRoute: c.annexRoute,
          intendedPurpose: c.intendedPurpose,
          rationale: c.rationale,
          answers: c.answers ?? null,
          derogation: c.derogation ?? null,
          rulePackVersion: c.rulePackVersion ?? null,
        },
      };
    }
    case "setStage":
      return {
        record: e.id,
        label: e.title,
        revision: e.version,
        change: "Stage " + e.stage + " to " + String(data.stage ?? ""),
        content: { engagementId: e.id, from: e.stage, to: data.stage ?? null },
      };
    case "acceptEvidence": {
      const a = e.artifacts.find((a) => a.id === data.artifactId);
      if (!a) return null;
      return {
        record: a.id,
        label: a.id + " " + a.name,
        revision: e.version,
        change: "Status " + a.status + " to accepted",
        digest: a.sha256,
      };
    }
    case "closeFinding": {
      const f = e.findings.find((f) => f.id === data.findingId);
      if (!f) return null;
      return {
        record: f.id,
        label: f.id + " " + f.title,
        revision: e.version,
        change: "Status " + f.status + " to closed",
        content: {
          findingId: f.id,
          remediation: f.remediation,
          retestEvidenceIds: f.retestEvidenceIds,
          retest: f.retest ?? null,
        },
      };
    }
  }
}

/** The SHA-256 the person attests to: a stored hash, or one of the content. */
export async function attestationDigest(subject: AttestationSubject) {
  return subject.digest ?? sha256(JSON.stringify(subject.content ?? null));
}

/** What a client sends with an attested op in `data.attestation`. */
export const attestationInput = z
  .object({
    rationale: z.string().trim().min(1, "Give a rationale").max(2000),
    /** The revision and digest the person saw; checked when present. */
    revision: z.number().int().nonnegative().optional(),
    digest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

/** What the audit event records for an attested decision. */
export type AttestationRecord = {
  statement: string;
  record: string;
  revision: number;
  digest: string;
  rationale: string;
};
