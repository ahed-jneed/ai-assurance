"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { can } from "@/lib/permissions";
import {
  FileText,
  Maximize2,
  Minimize2,
  Download,
  History,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Check,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalTable } from "./record-details";
import { humanLabel } from "@/lib/presentation";
import type {
  Engagement,
  Paper,
  Role,
  EvidenceRequest,
} from "@/lib/domain/types";
import {
  paperChecklist,
  paperHistoryNotice,
  paperNextAction,
  type PaperTarget,
} from "@/lib/paper-workflow";
import { paperRegisterRow } from "@/lib/paper-presentation";
import { PaperEvidence } from "./paper-evidence";
import { PaperComparison } from "./revision-comparison";
import { DraftRecovery, useRecoverableDraft } from "./recoverable-draft";
import type { PaperSuggestion } from "@/lib/domain/art50-papers";
import {
  Art50Suggestion,
  canAddToScope,
  scopeWithRationale,
} from "./audit-program/art50-plan";

const sections = {
  objective: "Objective",
  scope: "Scope & population",
  criteria: "Criteria & requirements",
  procedures: "Procedures performed",
  sampling: "Sampling & materiality",
  results: "Results & exceptions",
  limitations: "Evidence limitations",
  conclusion: "Auditor conclusion",
} as const;
const sectionOptions = [
  ...Object.entries(sections),
  ["conclusionStatus", "Conclusion status"],
  ["evidence", "Linked evidence"],
  ["review", "Comments & history"],
];

function NarrativeField({
  target,
  label,
  value,
  disabled,
  locked,
  onChange,
}: {
  target: string;
  label: string;
  value: string;
  disabled: boolean;
  locked: boolean;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value, disabled]);
  return (
    <section
      className="document-section"
      data-paper-target={target}
      tabIndex={-1}
    >
      <label>
        <h3>{label}</h3>
        {disabled ? (
          <p className="document-text">{value || "Not recorded"}</p>
        ) : (
          <Textarea
            ref={ref}
            name={"paper-" + target}
            autoComplete="off"
            disabled={locked}
            className="document-input"
            value={value}
            placeholder={"Add " + label.toLowerCase() + "…"}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
          />
        )}
      </label>
    </section>
  );
}

type PaperEditorProps = {
  tenantId: string;
  initialTarget?: PaperTarget;
  onTargetChange?: (target: PaperTarget) => void;
  previous?: Paper;
  next?: Paper;
  position?: string;
  onAdjacent: (p: Paper) => void;
  onVault: () => void;
  onEvidence: (id: string) => void;
  onRequest: () => void;
  onRequestRecord: (r: EvidenceRequest) => void;
  commentReset: number;
  draft: Paper | null;
  saved: Paper | undefined;
  setDraft: React.Dispatch<React.SetStateAction<Paper | null>>;
  engagement: Engagement | undefined | null;
  role: Role;
  userId: string;
  busy: boolean;
  dirty: boolean;
  error?: string;
  onCommentDraftChange: (pending: boolean) => void;
  onClose: () => void;
  onAction: (op: string, data: Record<string, unknown>) => void;
  onComment: (text: string) => Promise<unknown>;
  onResponse: (commentId: string, text: string) => Promise<unknown>;
  onProcedure: (id: string) => void;
  onDetail: (title: string, value: unknown) => void;
  onExport: () => void;
  resolve: (id: string) => string;
  /**
   * The Art 50 applicability suggestion for this paper's template (#152),
   * shown when no program procedure holds the paper's plan.
   */
  art50?: PaperSuggestion | null;
};

export function PaperEditor({
  tenantId,
  initialTarget,
  onTargetChange,
  previous,
  next,
  position,
  onAdjacent,
  onVault,
  onEvidence,
  onRequest,
  onRequestRecord,
  commentReset,
  draft,
  saved,
  setDraft,
  engagement,
  role,
  userId,
  busy,
  dirty,
  error,
  onCommentDraftChange,
  onClose,
  onAction,
  onComment,
  onResponse,
  onProcedure,
  onDetail,
  onExport,
  resolve,
  art50,
}: PaperEditorProps) {
  const [reply, setReply] = useState({ id: "", text: "" });
  const [expanded, setExpanded] = useState(false),
    [comment, setComment] = useState(""),
    [tab, setTab] = useState("paper");
  const [sectionTarget, setSectionTarget] = useState<PaperTarget>("objective"),
    [commentError, setCommentError] = useState(""),
    [sending, setSending] = useState<"comment" | "response" | null>(null);
  const documentRef = useRef<HTMLDivElement>(null),
    errorRef = useRef<HTMLDivElement>(null),
    targetChangeRef = useRef(onTargetChange),
    jumpFrame = useRef<number | undefined>(undefined);
  // The latest onTargetChange, so that jump() stays stable.
  useLayoutEffect(() => {
    targetChangeRef.current = onTargetChange;
  });
  const sectionSelectId = useId();
  /** Scrolls to a section on the next frame and focuses its first control. */
  const scrollToTarget = useCallback((target: PaperTarget) => {
    if (jumpFrame.current !== undefined)
      cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = requestAnimationFrame(() => {
      const section = documentRef.current?.querySelector<HTMLElement>(
        '[data-paper-target="' + target + '"]',
      );
      section?.scrollIntoView({ block: "start" });
      const control = section?.querySelector<HTMLElement>(
        "textarea:not(:disabled),button:not(:disabled)",
      );
      (control ?? section)?.focus({ preventScroll: true });
    });
  }, []);
  const jump = useCallback(
    (target: PaperTarget) => {
      setSectionTarget(target);
      setTab(target === "review" ? "review" : "paper");
      targetChangeRef.current?.(target);
      scrollToTarget(target);
    },
    [scrollToTarget],
  );
  useEffect(
    () => () => {
      if (jumpFrame.current !== undefined)
        cancelAnimationFrame(jumpFrame.current);
    },
    [],
  );
  // Another paper, or a sent comment, resets the review panel; a paper that
  // opens at a requested section shows it. Both are keyed by the paper id, so
  // editing the draft neither resets nor jumps again.
  const draftId = draft?.id,
    resetKey = (draftId ?? "") + "|" + commentReset,
    jumpKey = draftId && initialTarget ? draftId + "|" + initialTarget : "",
    [applied, setApplied] = useState({ reset: "", jump: "" });
  if (applied.reset !== resetKey || applied.jump !== jumpKey) {
    setApplied({ reset: resetKey, jump: jumpKey });
    if (applied.reset !== resetKey) {
      setExpanded(false);
      setComment("");
      setReply({ id: "", text: "" });
      setCommentError("");
      setTab("paper");
      setSectionTarget("objective");
    }
    if (jumpKey && applied.jump !== jumpKey && initialTarget) {
      setSectionTarget(initialTarget);
      setTab(initialTarget === "review" ? "review" : "paper");
    }
  }
  // ... and, once shown, scrolls to that section and reports it.
  useEffect(() => {
    if (!draftId || !initialTarget) return;
    targetChangeRef.current?.(initialTarget);
    scrollToTarget(initialTarget);
  }, [draftId, initialTarget, scrollToTarget]);
  const pendingComment = !!comment.trim() || !!reply.text.trim(),
    locked = busy || sending !== null;
  useEffect(() => {
    onCommentDraftChange(pendingComment);
  }, [pendingComment, onCommentDraftChange]);
  const source = engagement?.workflow?.procedures.find(
    (p) => p.paperId === draft?.id,
  );
  const bound = source?.paperRevision !== undefined ? source : undefined;
  // Superseded, retired and release-time papers never change (#94).
  const historyNotice = saved ? paperHistoryNotice(saved) : null;
  const writer = can(role, "editPaper"),
    lead = can(role, "signPaper"),
    reviewer = can(role, "reviewPaper"),
    editable = writer && draft?.status !== "signed" && !bound && !historyNotice;
  const recovery = useRecoverableDraft(
    draft && saved && engagement
      ? {
          tenantId,
          engagementId: engagement.id,
          kind: "paper",
          recordId: draft.id,
          baseRevision: saved.revision + ":" + saved.updatedAt,
        }
      : undefined,
    {
      body: draft?.body ?? {},
      evidenceIds: draft?.evidenceIds ?? [],
      required: draft?.required ?? false,
    },
    dirty,
    !!editable,
  );
  const nextAction = draft
    ? paperNextAction({
        paper: draft,
        saved,
        artifacts: engagement?.artifacts ?? [],
        role,
        userId,
        dirty,
        pendingComment,
      })
    : null;
  const checklist = draft
    ? paperChecklist(draft, engagement?.artifacts ?? [])
    : [];
  const registerState =
    draft && engagement
      ? paperRegisterRow(draft, engagement, role, userId)
      : undefined;
  const reviewSource =
    !!source &&
    !!registerState?.reviewable &&
    source.reviewerId === userId &&
    source.state === "submitted" &&
    !source.contributors.includes(userId) &&
    nextAction?.op === "reviewPaper";
  const sourceAction =
    !!source &&
    (!!registerState?.sourceAction ||
      (!!bound && nextAction?.op !== "signPaper") ||
      nextAction?.op === "reviewPaper");
  const sourceLabel = reviewSource
    ? "Review source procedure"
    : registerState?.label === "Reassess source procedure"
      ? "Reassess source procedure"
      : "Continue in audit program";
  const workflowReason = pendingComment
    ? nextAction?.reason
    : sourceAction
      ? draft?.status === "signed"
        ? "Record changes in the source procedure to preserve this signed revision."
        : (registerState?.reason ??
          "Continue in the source procedure to submit or revise this compiled paper.")
      : nextAction?.reason;
  const visibleError = commentError || error;
  useEffect(() => {
    if (visibleError) {
      errorRef.current?.scrollIntoView({ block: "nearest" });
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [visibleError]);

  function changeTab(value: string) {
    if (value === "review") jump("review");
    else if (sectionTarget === "review") jump("objective");
    else setTab("paper");
  }
  async function postComment() {
    if (locked || dirty || !comment.trim()) return;
    setSending("comment");
    setCommentError("");
    try {
      await onComment(comment);
      setComment("");
    } catch (cause) {
      setCommentError(
        cause instanceof Error
          ? cause.message
          : "The comment could not be recorded. Your text is still here.",
      );
    } finally {
      setSending(null);
    }
  }
  async function postResponse(commentId: string) {
    if (locked || dirty || !reply.text.trim()) return;
    setSending("response");
    setCommentError("");
    try {
      await onResponse(commentId, reply.text);
      setReply({ id: "", text: "" });
    } catch (cause) {
      setCommentError(
        cause instanceof Error
          ? cause.message
          : "The response could not be recorded. Your text is still here.",
      );
    } finally {
      setSending(null);
    }
  }

  return (
    <Sheet
      open={!!draft}
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      {draft && (
        <SheetContent
          side="right"
          className={"paper-sheet " + (expanded ? "expanded" : "")}
        >
          <SheetDescription className="sr-only">
            Working paper document, evidence and review history.
          </SheetDescription>
          <div className="peek-bar">
            <span>
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={onClose}
              >
                <ChevronLeft size={14} aria-hidden="true" /> Back
              </Button>
              <span className="peek-reference">{draft.templateId}</span>
            </span>
            <div>
              <Button
                className="sheet-expand-control"
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <Minimize2 size={15} aria-hidden="true" />
                ) : (
                  <Maximize2 size={15} aria-hidden="true" />
                )}{" "}
                {expanded ? "Side peek" : "Expand"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Export saved paper"
                onClick={onExport}
              >
                <Download size={15} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="sheet-scroll">
            <div className="document-page" ref={documentRef}>
              <FileText
                className="document-icon"
                size={34}
                aria-hidden="true"
              />
              <SheetTitle className="document-title">{draft.title}</SheetTitle>
              {historyNotice && (
                <div
                  className="paper-history-notice"
                  role="note"
                  data-kind={historyNotice.kind}
                >
                  <b>{historyNotice.title}</b>
                  <p>{historyNotice.text}</p>
                </div>
              )}
              <details className="paper-properties-details" key={draft.id}>
                <summary>
                  <span
                    className={
                      "badge " +
                      (draft.status === "signed"
                        ? "green"
                        : draft.status === "draft"
                          ? "neutral"
                          : "blue")
                    }
                  >
                    {humanLabel(draft.status)}
                  </span>
                  <span>
                    {draft.stage} · Revision {draft.revision}
                  </span>
                  <span>
                    Paper details
                    <ChevronRight size={13} aria-hidden="true" />
                  </span>
                </summary>
                <dl className="document-properties">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={
                          "badge " +
                          (draft.status === "signed"
                            ? "green"
                            : draft.status === "draft"
                              ? "neutral"
                              : "blue")
                        }
                      >
                        {humanLabel(draft.status)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>{draft.stage}</dd>
                  </div>
                  <div>
                    <dt>Requirements</dt>
                    <dd>
                      {draft.articleRefs.join(", ") || "Audit methodology"}
                    </dd>
                  </div>
                  <div>
                    <dt>Prepared by</dt>
                    <dd>{resolve(draft.authorId)}</dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>{draft.revision}</dd>
                  </div>
                </dl>
              </details>
              <nav
                className="paper-section-navigation"
                aria-label="Paper section navigation"
              >
                <label
                  className="paper-section-select"
                  htmlFor={sectionSelectId}
                >
                  <span>Go to section</span>
                  <select
                    id={sectionSelectId}
                    value={sectionTarget}
                    onChange={(event) =>
                      jump(event.target.value as PaperTarget)
                    }
                  >
                    {sectionOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="paper-section-shortcuts">
                  {(["results", "conclusion", "evidence"] as const).map(
                    (target) => (
                      <button
                        type="button"
                        key={target}
                        aria-current={
                          sectionTarget === target ? "location" : undefined
                        }
                        onClick={() => jump(target)}
                      >
                        {target === "results"
                          ? "Results"
                          : target === "conclusion"
                            ? "Conclusion"
                            : "Evidence"}
                      </button>
                    ),
                  )}
                </div>
              </nav>
              {visibleError && (
                <div
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="form-error paper-editor-error"
                >
                  {visibleError}
                </div>
              )}
              <Tabs value={tab} onValueChange={changeTab}>
                <TabsList>
                  <TabsTrigger value="paper">Document</TabsTrigger>
                  <TabsTrigger value="review">
                    Comments & history{" "}
                    {saved?.comments.filter((c) => !c.resolved).length
                      ? "(" +
                        saved.comments.filter((c) => !c.resolved).length +
                        ")"
                      : ""}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="paper">
                  <div className="paper-body">
                    <DraftRecovery
                      draft={recovery}
                      onRestore={(value) =>
                        setDraft((p) =>
                          p
                            ? {
                                ...p,
                                body: value.body as Paper["body"],
                                evidenceIds: value.evidenceIds as string[],
                                required: !!value.required,
                              }
                            : p,
                        )
                      }
                    />
                    {art50 && !source && (
                      // A paper of an engagement without a program (#152):
                      // the suggestion goes into the scope section only
                      // when the auditor adds it and saves the paper.
                      <Art50Suggestion
                        suggestion={art50}
                        current=""
                        canUse={canAddToScope(
                          draft.body.scope,
                          art50.rationale,
                          !!editable,
                          !!locked,
                        )}
                        useLabel="Add to scope"
                        decision="in the paper's scope for review"
                        onUse={(s) =>
                          setDraft((p) =>
                            p
                              ? {
                                  ...p,
                                  body: {
                                    ...p.body,
                                    scope: scopeWithRationale(
                                      p.body.scope,
                                      s.rationale,
                                    ),
                                  },
                                }
                              : p,
                          )
                        }
                      />
                    )}
                    <section className="paper-readiness">
                      <h3>
                        {draft.status === "draft"
                          ? "Submission requirements"
                          : "Current revision packet"}{" "}
                        <span className="count-label">
                          {checklist.filter((c) => c.done).length} /{" "}
                          {checklist.length}
                        </span>
                      </h3>
                      <div>
                        {checklist.map((item) => (
                          <button
                            type="button"
                            key={item.target}
                            onClick={() => jump(item.target)}
                            className={item.done ? "complete" : ""}
                          >
                            {item.done ? (
                              <Check size={14} aria-hidden="true" />
                            ) : (
                              <Circle size={13} aria-hidden="true" />
                            )}
                            <span>{item.label}</span>
                            <ChevronRight size={13} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                      {!!draft.comments.filter((c) => !c.resolved).length && (
                        <button
                          type="button"
                          className="packet-comments"
                          onClick={() => jump("review")}
                        >
                          <MessageSquare size={14} aria-hidden="true" />
                          {
                            draft.comments.filter((c) => !c.resolved).length
                          }{" "}
                          open review comments
                          <ChevronRight size={13} aria-hidden="true" />
                        </button>
                      )}
                      {draft.status === "in_review" && (
                        <p className="packet-handoff">
                          Review revision {draft.revision} and its linked
                          evidence. The reviewer must be independent of its
                          preparers.
                        </p>
                      )}
                    </section>
                    {bound && (
                      <section className="comment-box paper-source-handoff">
                        <b>
                          Compiled from {bound.templateId} execution and
                          evaluation
                        </b>
                        <p>
                          {draft.status === "signed"
                            ? "Record changes in the source procedure to preserve this signed revision."
                            : (registerState?.reason ??
                              "Update the source procedure to produce a new working-paper revision.")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={locked || pendingComment}
                          onClick={() => onProcedure(bound.id)}
                        >
                          {sourceLabel}
                        </Button>
                      </section>
                    )}
                    {draft.plannedGuidance && (
                      <details className="captured-record">
                        <summary>Planned methodology guidance</summary>
                        <p className="record-text">{draft.plannedGuidance}</p>
                      </details>
                    )}
                    {Object.entries(sections).map(([key, label]) => (
                      <NarrativeField
                        key={key}
                        target={key}
                        label={
                          key === "procedures" && !draft.plannedGuidance
                            ? "Procedure narrative · legacy draft"
                            : label
                        }
                        value={draft.body[key] ?? ""}
                        disabled={!editable}
                        locked={locked}
                        onChange={(v) =>
                          setDraft((p) =>
                            p ? { ...p, body: { ...p.body, [key]: v } } : p,
                          )
                        }
                      />
                    ))}
                    <div
                      className="document-outcome"
                      data-paper-target="conclusionStatus"
                      tabIndex={-1}
                    >
                      <label>
                        Conclusion status
                        <Select
                          disabled={!editable || locked}
                          value={draft.body.conclusionStatus}
                          onValueChange={(v) =>
                            setDraft((p) =>
                              p
                                ? {
                                    ...p,
                                    body: { ...p.body, conclusionStatus: v },
                                  }
                                : p,
                            )
                          }
                        >
                          <SelectTrigger aria-label="Conclusion status">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[
                              "not_evaluated",
                              "supported",
                              "qualified",
                              "not_supported",
                              "not_applicable",
                            ].map((v) => (
                              <SelectItem key={v} value={v}>
                                {humanLabel(v)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="check-row">
                        <Checkbox
                          checked={draft.required}
                          disabled={!lead || !editable || locked}
                          onCheckedChange={(v) =>
                            setDraft((p) => (p ? { ...p, required: !!v } : p))
                          }
                        />
                        Required for issuance
                      </label>
                    </div>
                    <PaperEvidence
                      paper={draft}
                      artifacts={engagement?.artifacts ?? []}
                      editable={editable}
                      busy={locked}
                      setDraft={setDraft}
                      onVault={onVault}
                      onEvidence={onEvidence}
                      onRequest={onRequest}
                      requests={(engagement?.evidenceRequests ?? []).filter(
                        (r) => r.paperIds.includes(draft.id),
                      )}
                      onRequestRecord={onRequestRecord}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="review">
                  <div
                    className="paper-body"
                    data-paper-target="review"
                    tabIndex={-1}
                  >
                    <h3>Comments</h3>
                    {saved?.comments.map((c) => (
                      <div className="comment-box" key={c.id}>
                        <div className="comment-person">
                          <b>{resolve(c.authorId)}</b>
                          <span className="subtle">
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p>{c.text}</p>
                        {c.responses?.map((r, i) => (
                          <div className="comment-box" key={i}>
                            <small>
                              {resolve(r.actor)} ·{" "}
                              {new Date(r.at).toLocaleString()}
                            </small>
                            <p>{r.text}</p>
                          </div>
                        ))}
                        {!c.resolved &&
                          writer &&
                          draft.status !== "signed" &&
                          (reply.id === c.id ? (
                            <form
                              className="comment-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void postResponse(c.id);
                              }}
                            >
                              <Textarea
                                name="paper-comment-response"
                                autoComplete="off"
                                aria-label="Response to review question"
                                value={reply.text}
                                disabled={locked}
                                onChange={(v) =>
                                  setReply({ id: c.id, text: v.target.value })
                                }
                                required
                                maxLength={5000}
                              />
                              <div className="row-actions">
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={
                                    locked || dirty || !reply.text.trim()
                                  }
                                >
                                  {sending === "response"
                                    ? "Recording…"
                                    : "Record response"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={locked}
                                  onClick={() => {
                                    setReply({ id: "", text: "" });
                                    setCommentError("");
                                  }}
                                >
                                  Cancel response
                                </Button>
                              </div>
                              {dirty && (
                                <p className="subtle">
                                  Save your document changes before recording a
                                  response.
                                </p>
                              )}
                            </form>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={locked || dirty || !!reply.text.trim()}
                              onClick={() => {
                                setReply({ id: c.id, text: "" });
                                setCommentError("");
                              }}
                            >
                              Respond to question
                            </Button>
                          ))}
                        <div className="row-actions">
                          <span className="badge neutral">
                            {c.resolved ? "Resolved" : "Open"}
                          </span>
                          {!c.resolved && c.authorId === userId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                locked ||
                                dirty ||
                                pendingComment ||
                                !c.responses?.length
                              }
                              title={
                                !c.responses?.length
                                  ? "A preparer response is required"
                                  : pendingComment
                                    ? "Record or clear your unsent comment or response first"
                                    : undefined
                              }
                              onClick={() =>
                                onAction("resolveComment", {
                                  paperId: draft.id,
                                  commentId: c.id,
                                })
                              }
                            >
                              Confirm resolution
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!saved?.comments.length && (
                      <p className="subtle">No review comments yet.</p>
                    )}
                    {(writer || reviewer) && draft.status !== "signed" && (
                      <form
                        className="comment-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void postComment();
                        }}
                      >
                        <Textarea
                          name="paper-review-comment"
                          autoComplete="off"
                          disabled={locked}
                          aria-label="Review comment"
                          placeholder="Add a review comment…"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          required
                          maxLength={5000}
                        />
                        {["in_review", "reviewed"].includes(draft.status) && (
                          <p className="paper-comment-impact">
                            Recording a comment returns this paper to draft and
                            clears its review approval.
                          </p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={locked || dirty || !comment.trim()}
                          type="submit"
                        >
                          <MessageSquare size={14} aria-hidden="true" />
                          {sending === "comment" ? "Recording…" : "Add comment"}
                        </Button>
                        {dirty && (
                          <p className="subtle">
                            Save your document changes before adding a comment.
                          </p>
                        )}
                      </form>
                    )}
                    <h3>Changes between saved revisions</h3>
                    {saved && (
                      <PaperComparison
                        paper={saved}
                        userId={userId}
                        resolve={resolve}
                      />
                    )}
                    <h3>Revision history</h3>
                    {saved?.history.map((h) => (
                      <button
                        type="button"
                        className="history-row"
                        key={h.revision}
                        onClick={() => onDetail("Revision " + h.revision, h)}
                      >
                        <History size={15} aria-hidden="true" />
                        <b>Revision {h.revision}</b>
                        <span>{new Date(h.at).toLocaleString()}</span>
                      </button>
                    ))}
                    {!saved?.history.length && (
                      <p className="subtle">Original methodology draft.</p>
                    )}
                    <h3>Approvals</h3>
                    {saved && <ApprovalTable paper={saved} resolve={resolve} />}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <footer className="document-footer paper-workflow-footer">
            <div>
              <span className={dirty || pendingComment ? "unsaved" : "subtle"}>
                {dirty
                  ? recovery.status || "Unsaved changes"
                  : reply.text.trim()
                    ? comment.trim()
                      ? "Unsent comment and response"
                      : "Unsent response"
                    : comment.trim()
                      ? "Unsent comment"
                      : "All changes saved"}
              </span>
              {workflowReason && (
                <p className="workflow-reason">
                  {workflowReason}
                  {nextAction?.target && (
                    <button
                      type="button"
                      onClick={() => jump(nextAction.target!)}
                    >
                      {" "}
                      {nextAction.target === "review"
                        ? "Open comments"
                        : "Go to requirement"}
                    </button>
                  )}
                </p>
              )}
            </div>
            <div className="row-actions">
              {sourceAction && source ? (
                <Button
                  disabled={
                    locked ||
                    pendingComment ||
                    (reviewSource && !nextAction?.enabled)
                  }
                  onClick={() => onProcedure(source.id)}
                >
                  {sourceLabel}
                  <ChevronRight size={14} aria-hidden="true" />
                </Button>
              ) : (
                nextAction?.op && (
                  <Button
                    disabled={locked || !nextAction.enabled}
                    onClick={() =>
                      onAction(
                        nextAction.op!,
                        nextAction.op === "editPaper"
                          ? {
                              paperId: draft.id,
                              body: draft.body,
                              evidenceIds: draft.evidenceIds,
                              required: draft.required,
                            }
                          : { paperId: draft.id },
                      )
                    }
                  >
                    {locked ? "Saving…" : nextAction.label}
                  </Button>
                )
              )}
              {!sourceAction &&
                !nextAction?.op &&
                nextAction?.target === "review" && (
                  <Button
                    variant="outline"
                    disabled={locked}
                    onClick={() => jump("review")}
                  >
                    Open comments
                  </Button>
                )}
              <div className="paper-adjacent">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Previous paper"
                  title={previous?.title}
                  disabled={locked || !previous}
                  onClick={() => previous && onAdjacent(previous)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </Button>
                {position && <span>{position}</span>}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Next paper"
                  title={next?.title}
                  disabled={locked || !next}
                  onClick={() => next && onAdjacent(next)}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </footer>
        </SheetContent>
      )}
    </Sheet>
  );
}
