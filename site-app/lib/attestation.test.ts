import { describe, expect, it } from "vitest";
import {
  attestationDigest,
  attestationSubject,
  attestedOps,
} from "@/lib/attestation";
import { dispatch } from "@/lib/commands";
import { caller, stored } from "@/lib/commands/test-fixtures";
import type { Artifact, Engagement, Finding, Paper } from "@/lib/domain";
import { sha256 } from "@/lib/ids";

const fileHash = "a".repeat(64);
function withEvidence(): Engagement {
  const e = stored();
  e.artifacts.push({
    id: "EV-1",
    name: "policy.pdf",
    category: "Policy",
    size: 10,
    sha256: fileHash,
    key: "k",
    createdAt: "2026-11-05T09:00:00.000Z",
    uploadedBy: "user-auditor",
    visibility: "internal",
    status: "unverified",
    mediaType: "application/pdf",
  } satisfies Artifact);
  return e;
}

describe("attestationSubject", () => {
  it("binds a paper's signature content at its revision", async () => {
    const e = stored();
    const paper = {
      id: "WP-1",
      title: "Risk management",
      revision: 4,
      body: { text: "x" },
      evidenceIds: ["EV-1"],
      runIds: [],
    } as unknown as Paper;
    e.papers.push(paper);
    const subject = attestationSubject(e, "signPaper", { paperId: "WP-1" })!;
    expect(subject).toMatchObject({
      record: "WP-1",
      label: "WP-1 Risk management",
      revision: 4,
    });
    // The digest is the hash the signature records (lib/commands/papers.ts).
    expect(await attestationDigest(subject)).toBe(
      await sha256(
        JSON.stringify({
          body: paper.body,
          revision: 4,
          evidenceIds: ["EV-1"],
          runIds: [],
        }),
      ),
    );
  });

  it("uses an evidence file's own SHA-256", async () => {
    const subject = attestationSubject(withEvidence(), "acceptEvidence", {
      artifactId: "EV-1",
    })!;
    expect(subject.change).toBe("Status unverified to accepted");
    expect(await attestationDigest(subject)).toBe(fileHash);
  });

  it("describes a stage change and a finding closure", () => {
    const e = stored();
    expect(
      attestationSubject(e, "setStage", { stage: "Fieldwork" }),
    ).toMatchObject({
      record: e.id,
      revision: 3,
      change: "Stage Planning to Fieldwork",
    });
    e.findings.push({
      id: "F-1",
      title: "Gap",
      status: "ready_for_retest",
      remediation: "Fixed",
      retestEvidenceIds: ["EV-1"],
    } as unknown as Finding);
    expect(
      attestationSubject(e, "closeFinding", { findingId: "F-1" }),
    ).toMatchObject({
      record: "F-1",
      change: "Status ready_for_retest to closed",
    });
  });

  it("is null for a record the engagement does not hold", () => {
    const e = stored();
    expect(attestationSubject(e, "signPaper", { paperId: "WP-9" })).toBeNull();
    expect(
      attestationSubject(e, "acceptEvidence", { artifactId: "EV-9" }),
    ).toBeNull();
  });

  it("binds the classification's answers and rationale", () => {
    const e = stored();
    expect(attestationSubject(e, "approveClassification", {})).toMatchObject({
      record: e.id + "/classification",
      change: "Status provisional to approved",
      content: { rationale: "", answers: {} },
    });
  });
});

describe("attested commands", () => {
  it("records the attestation in the event details", async () => {
    const e = withEvidence();
    const result = await dispatch(
      e,
      "acceptEvidence",
      {
        artifactId: "EV-1",
        attestation: {
          rationale: "Checked against the client's register",
          revision: 3,
          digest: fileHash,
        },
      },
      caller("Auditor"),
    );
    expect(result).toEqual({
      details: {
        artifactId: "EV-1",
        sha256: fileHash,
        attestation: {
          statement: attestedOps.acceptEvidence.statement,
          record: "EV-1",
          revision: 3,
          digest: fileHash,
          rationale: "Checked against the client's register",
        },
      },
    });
    expect(e.artifacts[0].status).toBe("accepted");
  });

  it("requires a rationale, after the role check", async () => {
    await expect(
      dispatch(
        withEvidence(),
        "acceptEvidence",
        { artifactId: "EV-1" },
        caller("Auditor"),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "Attest this decision: give your rationale for the record you reviewed",
    });
    await expect(
      dispatch(
        withEvidence(),
        "acceptEvidence",
        { artifactId: "EV-1", attestation: { rationale: "  " } },
        caller("Auditor"),
      ),
    ).rejects.toThrow("Give a rationale");
    await expect(
      dispatch(
        withEvidence(),
        "acceptEvidence",
        { artifactId: "EV-1" },
        caller("Reviewer"),
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "Your role cannot perform this action",
    });
  });

  it("refuses an attestation of another revision or content", async () => {
    for (const stale of [{ revision: 2 }, { digest: "b".repeat(64) }]) {
      const e = withEvidence();
      await expect(
        dispatch(
          e,
          "acceptEvidence",
          {
            artifactId: "EV-1",
            attestation: { rationale: "Reviewed", ...stale },
          },
          caller("Auditor"),
        ),
      ).rejects.toMatchObject({
        status: 409,
        message:
          "The record changed after you reviewed it. Reload and attest again.",
      });
      expect(e.artifacts[0].status).toBe("unverified");
    }
  });
});
