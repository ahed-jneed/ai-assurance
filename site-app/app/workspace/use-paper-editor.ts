import { useCallback, useEffect, useRef, useState } from "react";
import type { Engagement, Paper } from "@/lib/domain";
import { readableResults } from "@/lib/presentation";

/** A copy of a saved paper for editing, with readable result text. */
export function editableDraft(paper: Paper) {
  const draft = structuredClone(paper);
  draft.body.results = readableResults(draft.body.results ?? "");
  return draft;
}
const paperFingerprint = (p: Paper) =>
  JSON.stringify({
    body: { ...p.body, results: readableResults(p.body.results ?? "") },
    required: p.required,
    evidenceIds: [...p.evidenceIds].sort(),
  });

/**
 * The open working paper: its unsaved draft, the saved revision the draft is
 * compared with, conflict detection when a newer revision arrives, and the
 * discard confirmation that guards leaving unsaved edits or comments.
 */
export function usePaperEditor(engagement: Engagement | null | undefined) {
  const [paperId, setPaperId] = useState<string | null>(null),
    [paperDraft, setPaperDraft] = useState<Paper | null>(null);
  const [hasPendingComment, setHasPendingComment] = useState(false),
    [commentReset, setCommentReset] = useState(0);
  const [discardPaper, setDiscardPaper] = useState(false),
    [paperConflict, setPaperConflict] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null),
    savedPaperRef = useRef<Paper | undefined>(undefined),
    draftRef = useRef<Paper | null>(null),
    dirtyRef = useRef(false),
    navigationDirtyRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref read by acceptSavedRevision(); writing it during render is the current behaviour
  draftRef.current = paperDraft;
  const selectedPaper = engagement?.papers.find((p) => p.id === paperId);
  /* eslint-disable react-hooks/refs -- the saved-paper baseline and the dirty flags live in refs that the navigation guards read; reading and writing them during render is the current behaviour */
  const paperBaseline =
    savedPaperRef.current?.id === paperDraft?.id
      ? savedPaperRef.current
      : selectedPaper;
  const paperDirty =
    !!paperBaseline &&
    !!paperDraft &&
    paperFingerprint(paperBaseline) !== paperFingerprint(paperDraft);
  dirtyRef.current = paperDirty;
  const navigationDirty = paperDirty || hasPendingComment;
  navigationDirtyRef.current = navigationDirty;
  /* eslint-enable react-hooks/refs */
  useEffect(() => {
    if (!selectedPaper) return;
    const previous = savedPaperRef.current;
    savedPaperRef.current = selectedPaper;
    if (previous?.id === selectedPaper.id && dirtyRef.current) {
      if (previous.revision !== selectedPaper.revision) setPaperConflict(true);
      return;
    }
    setPaperDraft(editableDraft(selectedPaper));
    setPaperConflict(false);
  }, [selectedPaper]);
  /** Rebases the open draft on a revision returned by an editPaper save. */
  const acceptSavedRevision = useCallback((saved: Paper) => {
    if (draftRef.current?.id !== saved.id) return;
    savedPaperRef.current = saved;
    setPaperDraft(editableDraft(saved));
    setPaperConflict(false);
  }, []);
  function showPaper(paper: Paper, draft: Paper) {
    savedPaperRef.current = paper;
    setPaperId(paper.id);
    setPaperDraft(draft);
    setPaperConflict(false);
  }
  function clearPaper() {
    setPaperId(null);
    setPaperDraft(null);
  }
  function forgetSavedPaper() {
    savedPaperRef.current = undefined;
  }
  /** Whether leaving now would lose unsaved paper edits or comments. */
  const isNavigationDirty = () => navigationDirtyRef.current;
  /** Asks to discard unsaved edits; `next` runs if the user agrees. */
  function confirmDiscard(next: () => void) {
    pendingNavigation.current = next;
    setDiscardPaper(true);
  }
  function keepEditing() {
    pendingNavigation.current = null;
  }
  function discardAndContinue() {
    dirtyRef.current = false;
    navigationDirtyRef.current = false;
    setHasPendingComment(false);
    setCommentReset((v) => v + 1);
    pendingNavigation.current?.();
    pendingNavigation.current = null;
    setDiscardPaper(false);
  }
  /** Drops local edits and reloads the newer saved revision. */
  function loadSavedRevision() {
    dirtyRef.current = false;
    setPaperDraft(editableDraft(selectedPaper!));
    setPaperConflict(false);
  }
  return {
    paperId,
    paperDraft,
    setPaperDraft,
    selectedPaper,
    paperDirty,
    navigationDirty,
    paperConflict,
    setPaperConflict,
    hasPendingComment,
    setHasPendingComment,
    commentReset,
    discardPaper,
    setDiscardPaper,
    acceptSavedRevision,
    showPaper,
    clearPaper,
    forgetSavedPaper,
    isNavigationDirty,
    confirmDiscard,
    keepEditing,
    discardAndContinue,
    loadSavedRevision,
  };
}
export type PaperEditorState = ReturnType<typeof usePaperEditor>;
