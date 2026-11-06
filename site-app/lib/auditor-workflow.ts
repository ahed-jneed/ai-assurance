import {
  paperCurrent,
  stages,
  type Artifact,
  type Engagement,
  type Paper,
  type Role,
} from "./domain";
import { personalPaperQueue } from "./paper-workflow";

export function auditStageIndex(stage: string) {
  return stages.findIndex(
    (s) => s.toLowerCase() === stage.trim().toLowerCase(),
  );
}
export function stagePaperQueue(e: Engagement, role: Role, userId: string) {
  // Superseded papers and retired memos are history, never work.
  const papers = e.papers.filter(paperCurrent),
    queue = personalPaperQueue(papers, e.artifacts, role, userId),
    current = auditStageIndex(e.stage);
  const stageOrder = (p: Paper) => {
    const i = auditStageIndex(p.stage);
    return i < 0 ? stages.length : i;
  };
  const priority = (p: Paper) =>
    p.comments.some((c) => !c.resolved && c.authorId === userId)
      ? 0
      : p.status === "reviewed"
        ? 1
        : p.status === "in_review"
          ? 2
          : 3;
  const ordered = [...queue.actionable].sort(
    (a, b) =>
      stageOrder(a.paper) - stageOrder(b.paper) ||
      priority(a.paper) - priority(b.paper),
  );
  // Reviews, signatures and comment responses are live handoffs even for a future-labelled paper.
  const dueNow = (p: Paper) =>
    p.status !== "draft" ||
    p.comments.some((c) => !c.resolved) ||
    current < 0 ||
    (auditStageIndex(p.stage) >= 0 && auditStageIndex(p.stage) <= current);
  const active = ordered.filter((item) => dueNow(item.paper)),
    later = ordered.filter((item) => !dueNow(item.paper));
  const unfinished = papers.filter(
    (p) =>
      p.status !== "signed" &&
      (current < 0 ||
        (auditStageIndex(p.stage) >= 0 && auditStageIndex(p.stage) <= current)),
  );
  return {
    active,
    later,
    waiting: queue.waiting,
    teamOutstanding: unfinished.length,
    earlierOutstanding: unfinished.filter(
      (p) => auditStageIndex(p.stage) < current,
    ).length,
  };
}
export function paperEvidenceReferences(paper: Paper, artifacts: Artifact[]) {
  return [...new Set(paper.evidenceIds)].map((id) => ({
    id,
    artifact: artifacts.find((a) => a.id === id) ?? null,
  }));
}
