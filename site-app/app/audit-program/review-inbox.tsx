"use client";
import { ArrowUpRight } from "lucide-react";
import type { Paper } from "@/lib/domain/types";
import type { ProgramScope } from "./program-scope";
/** The review inbox tab: current revisions awaiting independent review. */
export function ReviewInbox({
  scope,
  onTab: setTab,
  onOpen,
  onPaper,
}: {
  scope: ProgramScope;
  onTab: (tab: string) => void;
  /** Opens a procedure at a section. */
  onOpen: (id: string, section: string) => void;
  onPaper: (p: Paper) => void;
}) {
  const { e, w, name } = scope,
    b = w.brief;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Review inbox</h2>
        <span className="subtle">Current revisions only</span>
      </div>
      {b?.status === "submitted" && (
        <button className="attention-row" onClick={() => setTab("brief")}>
          <span>
            <b>Engagement brief · revision {b.revision}</b>
            <small className="block subtle">Independent scope approval</small>
          </span>
          <ArrowUpRight size={15} />
        </button>
      )}
      {w.program.status === "submitted" && (
        <button className="attention-row" onClick={() => setTab("program")}>
          <span>
            <b>Audit program · revision {w.program.revision}</b>
            <small className="block subtle">
              Selection, applicability and execution plan
            </small>
          </span>
          <ArrowUpRight size={15} />
        </button>
      )}
      {w.procedures
        .filter(
          (p) =>
            p.state === "submitted" ||
            (p.state === "reviewed" &&
              e.papers.find((q) => q.id === p.paperId)?.status !== "signed"),
        )
        .map((p) => (
          <button
            key={p.id}
            className="attention-row"
            onClick={() => {
              onOpen(p.id, "review");
            }}
          >
            <span>
              <b>
                {p.templateId} · {p.title}
              </b>
              <small className="block subtle">
                {p.state === "reviewed"
                  ? "Lead sign-off needed"
                  : "Assigned to " + name(p.reviewerId)}{" "}
                · paper revision {p.paperRevision}
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      {e.papers
        .filter(
          (q) =>
            q.status === "in_review" &&
            !w.procedures.some((p) => p.paperId === q.id),
        )
        .map((q) => (
          <button
            key={q.id}
            className="attention-row"
            onClick={() => onPaper(q)}
          >
            <span>
              <b>{q.title}</b>
              <small className="block subtle">
                Supplementary paper · revision {q.revision}
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      {!w.procedures.some(
        (p) =>
          p.state === "submitted" ||
          (p.state === "reviewed" &&
            e.papers.find((q) => q.id === p.paperId)?.status !== "signed"),
      ) &&
        b?.status !== "submitted" &&
        w.program.status !== "submitted" &&
        !e.papers.some((p) => p.status === "in_review") && (
          <p className="empty-result">No work is awaiting review.</p>
        )}
    </section>
  );
}
