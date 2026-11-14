"use client";
import { Download, FileText } from "lucide-react";
import { can } from "@/lib/permissions";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { Artifact, Finding, Role } from "@/lib/domain/types";
import {
  genaiLevelBadge,
  type GenaiArtifactLevel,
} from "@/lib/genai/evidence-levels";
import { findingReference, humanLabel } from "@/lib/presentation";
import { FindingActions } from "./finding-actions";

export const evidenceSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
export const evidenceVisibility = (artifact: Artifact) =>
  artifact.visibility !== "client"
    ? "Internal team"
    : artifact.status === "accepted"
      ? "Shared with client"
      : "Client access after acceptance";
export function findingDue(finding: Finding) {
  if (!finding.dueDate) return { label: "No due date", overdue: false };
  const due = new Date(finding.dueDate + "T00:00:00"),
    today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    label: Number.isNaN(due.getTime())
      ? finding.dueDate
      : due.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
    overdue: finding.status !== "closed" && due.getTime() < today.getTime(),
  };
}
function Status({ value }: { value: string }) {
  const tone = ["accepted", "closed"].includes(value)
    ? "green"
    : ["Critical", "High"].includes(value)
      ? "red"
      : ["unverified", "quarantined", "Medium", "ready_for_retest"].includes(
            value,
          )
        ? "amber"
        : "neutral";
  return (
    <span className={"badge " + tone}>
      {value === "unverified" ? "Awaiting acceptance" : humanLabel(value)}
    </span>
  );
}

function GenaiLevel({ level }: { level?: GenaiArtifactLevel }) {
  if (!level) return null;
  const badge = genaiLevelBadge(level);
  return (
    <span
      className={"badge " + badge.tone + " register-genai-level"}
      title={badge.title}
      data-genai-file-level={level.level}
      data-genai-file-role={level.role}
    >
      {badge.text}
    </span>
  );
}

export function EvidenceRegister({
  artifacts,
  tenantId,
  engagementId,
  role,
  resolve,
  onOpen,
  genaiLevels,
}: {
  artifacts: Artifact[];
  tenantId: string;
  engagementId: string;
  role: Role;
  resolve: (id: string) => string;
  onOpen: (artifact: Artifact) => void;
  /** The GenAI evidence level of each GenAI file, by artifact id (#145). */
  genaiLevels?: ReadonlyMap<string, GenaiArtifactLevel>;
}) {
  return (
    <Table className="audit-register evidence-register">
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Acceptance</TableHead>
          <TableHead>
            <span className="sr-only">File actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="register-title-cell">
              <div className="register-title">
                <FileText size={17} aria-hidden="true" />
                <div>
                  <button className="paper-link" onClick={() => onOpen(a)}>
                    {a.name}
                  </button>
                  <small className="register-meta">
                    {evidenceSize(a.size)}
                    <span aria-hidden="true"> · </span>
                    {new Date(a.createdAt).toLocaleDateString()}
                    {a.uploadedBy && (
                      <>
                        <span aria-hidden="true"> · </span>
                        {resolve(a.uploadedBy)}
                      </>
                    )}
                  </small>
                </div>
              </div>
            </TableCell>
            <TableCell className="register-category">
              {a.category}
              <small className="register-meta">{evidenceVisibility(a)}</small>
              <GenaiLevel level={genaiLevels?.get(a.id)} />
            </TableCell>
            <TableCell className="register-status">
              <Status value={a.status} />
            </TableCell>
            <TableCell className="register-actions">
              <div className="row-actions">
                {can(role, "acceptEvidence") && a.status === "unverified" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpen(a)}
                    aria-label={"Review evidence: " + a.name}
                  >
                    Review
                  </Button>
                )}
                {a.custody === "client" ? (
                  // A client-held pin has no bytes on the platform (#102).
                  <span className="subtle" title="Pinned by SHA-256 only">
                    Held by client
                  </span>
                ) : (
                  <a
                    className="register-download"
                    aria-label={"Download " + a.name}
                    title={"Download " + a.name}
                    href={
                      "/api/evidence?" +
                      new URLSearchParams({
                        tenantId,
                        engagementId,
                        artifactId: a.id,
                      })
                    }
                  >
                    <Download size={16} />
                    <span className="sr-only">Download file</span>
                  </a>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FindingRegister({
  findings,
  artifacts,
  role,
  userId,
  busy,
  onOpen,
  onRemediate,
}: {
  findings: Finding[];
  artifacts: Artifact[];
  role: Role;
  userId: string;
  busy: boolean;
  onOpen: (finding: Finding) => void;
  onRemediate: (id: string) => void;
}) {
  return (
    <Table className="audit-register finding-register">
      <TableHeader>
        <TableRow>
          <TableHead>Finding</TableHead>
          <TableHead>Risk</TableHead>
          <TableHead>Owner & deadline</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Finding actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {findings.map((f) => {
          const due = findingDue(f);
          return (
            <TableRow key={f.id}>
              <TableCell className="register-title-cell">
                <button className="paper-link" onClick={() => onOpen(f)}>
                  {f.title}
                </button>
                <small className="register-meta">
                  {findingReference(f.article)}
                </small>
              </TableCell>
              <TableCell className="register-risk">
                <Status value={f.severity} />
                <small className="register-meta">
                  <span className="sr-only">Risk score </span>
                  {f.riskScore} / 25
                </small>
              </TableCell>
              <TableCell className="register-owner">
                <span>{f.owner || "Unassigned"}</span>
                <small
                  className={
                    due.overdue ? "register-meta overdue" : "register-meta"
                  }
                >
                  {due.overdue && "Overdue · "}
                  {due.label}
                </small>
              </TableCell>
              <TableCell className="register-status">
                <Status value={f.status} />
              </TableCell>
              <TableCell className="register-actions">
                <FindingActions
                  compact
                  finding={f}
                  artifacts={artifacts}
                  role={role}
                  userId={userId}
                  busy={busy}
                  onRemediate={onRemediate}
                  onRetest={() => onOpen(f)}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
