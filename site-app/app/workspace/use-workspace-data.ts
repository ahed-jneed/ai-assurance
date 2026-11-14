// Workspace data: fetching and reloading GET /api/workspace, running
// engagement and management commands, applying their responses, and the
// first load that restores a deep link or the last engagement.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { Engagement, Paper, Role } from "@/lib/domain/types";
import {
  FetchError,
  errorMessage,
  fetchJson,
  postJson,
  retryable,
} from "@/lib/fetch-json";
import { isClientRole } from "@/lib/permissions";
import { readWorkspaceLink, type WorkspaceLink } from "@/lib/workspace-links";
import {
  auditViews,
  parseResume,
  permittedAuditView,
  resumeKey,
} from "@/lib/workspace-preferences";
import type { WorkspaceData } from "../workspace-types";
import type { CommandOptions } from "./types";

type LoadFailure = "access" | "missing" | "signed_out" | "transient" | null;
type RestoreRequest = {
  userId: string;
  tenantId: string;
  engagementId: string;
  view: string;
};
/**
 * Updates elsewhere in the workspace that load() and act() make before they
 * store a response, so they render together with the new data.
 */
export type WorkspaceDataListener = {
  /** The account now holds a client role where it held a staff role. */
  onClientAudience: (role: Role) => void;
  /** A requested engagement restore arrived; show this view. */
  onRestoreView: (view: string) => void;
  /** An editPaper save returned this revision. */
  onPaperSaved: (paper: Paper) => void;
};
const manageMessages: Record<string, string> = {
  createClient: "Client created",
  createEngagement: "Engagement created",
  updateClient: "Client updated",
  grantMember: "Member access saved",
  updateMember: "Access updated",
  revokeMember: "Practice access revoked",
  grantAdmin: "Practice administration granted",
  revokeAdmin: "Practice administration removed",
  transferAdmin: "Practice administration transferred",
  inviteMember: "Invitation saved",
  cancelInvitation: "Invitation cancelled",
  renamePractice: "Practice renamed",
  setQualityReviewPolicy: "Quality review policy saved",
  setReportSettings: "Report settings saved",
  rotateSigningKey: "Signing key rotated",
};
const actMessages: Record<string, string> = {
  editPaper: "Revision saved",
  submitPaper: "Sent for independent review",
  reviewPaper: "Review approved",
  signPaper: "Revision signed",
  reopenPaper: "Paper reopened as draft",
  acceptEvidence: "Evidence accepted",
  comment: "Comment added",
  resolveComment: "Comment resolution confirmed",
  createPaper: "Working paper created",
  createEvidenceRequest: "Evidence request created",
  updateEvidenceRequest: "Evidence request updated",
  recordEvidenceResponse: "Evidence receipt recorded",
  assessEvidenceRequest: "Evidence assessment recorded",
  closeEvidenceRequest: "Disposition recorded; limitation memo drafted",
  reopenEvidenceRequest: "Evidence request reopened",
  createFinding: "Finding recorded",
  createReport: "Report snapshot created",
  setPaperAudience: "Paper audience updated",
  classify: "Classification saved",
  approveClassification: "Classification approved",
  setStage: "Engagement stage updated",
  updateFinding: "Remediation saved",
  closeFinding: "Retest confirmed",
  executeRun: "Evaluation execution finished",
  createModel: "Model version registered",
  createEvaluationProfile: "Evaluation protocol saved",
  queueRun: "Evaluation request frozen",
};

/** Workspace commands whose effect reaches beyond the saved engagement. */
const reloadingOps = new Set([
  // Creates the follow-up engagement in the directory.
  "openFollowup",
]);
/**
 * The workspace after a workspace command saved `engagement`: the engagement
 * itself, its directory row, and its audit trail and stored size when the
 * response carried them.
 */
export function applySaved(
  data: WorkspaceData,
  engagement: Engagement,
  events?: WorkspaceData["events"],
  metadataBytes?: number | null,
): WorkspaceData {
  return {
    ...data,
    engagement,
    engagements: data.engagements.map((row) =>
      row.id === engagement.id
        ? {
            ...row,
            title: engagement.title,
            stage: engagement.stage,
            due_date: engagement.dueDate,
          }
        : row,
    ),
    ...(events ? { events } : {}),
    ...(metadataBytes !== undefined ? { metadataBytes } : {}),
  };
}

export function useWorkspaceData() {
  const [data, setData] = useState<WorkspaceData | null>(null),
    [error, setError] = useState(""),
    [signedOut, setSignedOut] = useState(false),
    // The account is signed in but the server refused the workspace: no
    // practice access (revoked, archived or never granted).
    [accessDenied, setAccessDenied] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [bootstrapping, setBootstrapping] = useState(true);
  // The committed data, for callbacks and async handlers.
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  });
  const listener = useRef<WorkspaceDataListener | null>(null),
    loadFailure = useRef<LoadFailure>(null),
    restoreRequest = useRef<RestoreRequest | null>(null),
    loadRequest = useRef<{
      generation: number;
      controller: AbortController | null;
    }>({ generation: 0, controller: null }),
    retrySelection = useRef<{ tenantId?: string; engagementId?: string }>({});
  const load = useCallback(async (tenantId?: string, engagementId?: string) => {
    loadFailure.current = null;
    const generation = ++loadRequest.current.generation;
    loadRequest.current.controller?.abort();
    const controller = new AbortController();
    loadRequest.current.controller = controller;
    retrySelection.current = { tenantId, engagementId };
    try {
      setError("");
      const qs = new URLSearchParams();
      if (tenantId) qs.set("tenantId", tenantId);
      if (engagementId) qs.set("engagementId", engagementId);
      let body: WorkspaceData;
      try {
        body = await fetchJson<WorkspaceData>("/api/workspace?" + qs, {
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (failure) {
        if (
          !(failure instanceof FetchError) ||
          generation !== loadRequest.current.generation
        )
          throw failure;
        loadFailure.current =
          failure.kind === "signed_out"
            ? "signed_out"
            : failure.kind === "forbidden"
              ? "access"
              : failure.kind === "missing"
                ? "missing"
                : "transient";
        if (failure.kind === "signed_out") {
          setSignedOut(true);
          setAccessDenied(false);
          setData(null);
          return null;
        }
        if (failure.kind === "forbidden") {
          setAccessDenied(true);
          setData(null);
        } else if (tenantId || engagementId)
          setData((previous) =>
            previous ? { ...previous, engagement: null } : null,
          );
        throw failure;
      }
      if (generation !== loadRequest.current.generation) return null;
      if (
        isClientRole(body.identity.role) &&
        dataRef.current &&
        !isClientRole(dataRef.current.identity.role)
      )
        listener.current?.onClientAudience(body.identity.role);
      setData(body);
      setSignedOut(false);
      setAccessDenied(false);
      // The selected engagement failed to load intact; the rest of the
      // workspace is usable, and the banner says why nothing is open.
      if (body.engagementError) setError(body.engagementError.error);
      const requested = restoreRequest.current;
      if (
        requested &&
        requested.userId === body.identity.id &&
        requested.tenantId === body.tenantId &&
        requested.engagementId === body.engagement?.id
      ) {
        listener.current?.onRestoreView(
          permittedAuditView(requested.view, body.identity.role),
        );
        restoreRequest.current = null;
      }
      return body;
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== loadRequest.current.generation
      )
        return null;
      loadFailure.current ??= "transient";
      setError(
        restoreRequest.current
          ? "Your last engagement could not be loaded. Retry, or choose an engagement from the directory."
          : errorMessage(error, "Workspace unavailable"),
      );
      return null;
    } finally {
      if (generation === loadRequest.current.generation) setLoading(false);
    }
  }, []);
  /**
   * The one error surface of a failed command (F-71): a toast whose action
   * retries a transient failure or reloads after a conflict, unless the
   * caller shows the error itself (a form or the attestation dialog).
   */
  const reportFailure = useCallback(
    (error: unknown, fallback: string, again: () => void, quiet = false) => {
      if (quiet) return;
      const current = dataRef.current;
      toast.error(errorMessage(error, fallback), {
        action: retryable(error)
          ? { label: "Retry", onClick: again }
          : error instanceof FetchError && error.kind === "conflict"
            ? {
                label: "Reload",
                onClick: () =>
                  void load(current?.tenantId, current?.engagement?.id),
              }
            : undefined,
      });
    },
    [load],
  );
  const manage = useCallback(
    async function manage(
      op: string,
      values: Record<string, unknown>,
      options: CommandOptions = {},
    ): Promise<{ details: Record<string, string> }> {
      const current = dataRef.current;
      if (!current) throw Error("Workspace unavailable");
      setBusy(true);
      try {
        const body = await postJson<{ details: Record<string, string> }>(
          "/api/management",
          {
            tenantId: current.tenantId,
            expectedVersion: current.managementVersion,
            op,
            data: values,
          },
        );
        await load(current.tenantId, current.engagement?.id);
        toast.success(manageMessages[op] ?? "Changes saved");
        return body;
      } catch (error) {
        reportFailure(
          error,
          "Could not save",
          () => void manage(op, values, options).catch(() => {}),
          options.quiet,
        );
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [load, reportFailure],
  );
  const act = useCallback(
    async function act(
      op: string,
      values: Record<string, unknown>,
      override?: Engagement,
      options: CommandOptions = {},
    ): Promise<{ engagement: Engagement; details?: Record<string, string> }> {
      const current = dataRef.current;
      if (!current?.engagement) throw Error("Select an engagement");
      setBusy(true);
      try {
        const body = await postJson<{
          engagement: Engagement;
          details?: Record<string, string>;
          events?: WorkspaceData["events"];
          metadataBytes?: number | null;
        }>("/api/workspace", {
          op,
          data: values,
          tenantId: current.tenantId,
          engagementId: override?.id ?? current.engagement.id,
          expectedVersion: override?.version ?? current.engagement.version,
        });
        if (op === "editPaper") {
          const saved = body.engagement.papers.find(
            (p) => p.id === values.paperId,
          );
          if (saved) listener.current?.onPaperSaved(saved);
        }
        // The response carries everything the save changed in this
        // workspace, so it is applied in place; only an op that changes the
        // directory itself, or a response without the trail, reloads.
        const reload = reloadingOps.has(op) || !body.events;
        setData((previous) =>
          previous?.tenantId === current.tenantId &&
          previous.engagement?.id === body.engagement.id
            ? applySaved(
                previous,
                body.engagement,
                body.events,
                body.metadataBytes,
              )
            : previous,
        );
        if (reload) await load(current.tenantId, body.engagement.id);
        toast.success(actMessages[op] ?? "Changes saved");
        return body;
      } catch (e) {
        // A retry runs at the version the workspace then holds.
        reportFailure(
          e,
          "Save failed",
          () => void act(op, values, undefined, options).catch(() => {}),
          options.quiet,
        );
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [load, reportFailure],
  );
  /** Runs a command whose failure is already reported by act(). */
  const safeAct = useCallback(
    (op: string, values: Record<string, unknown>) => {
      void act(op, values).catch(() => {});
    },
    [act],
  );
  const retry = useCallback(() => {
    void load(
      retrySelection.current.tenantId,
      retrySelection.current.engagementId,
    );
  }, [load]);
  const getData = useCallback(() => dataRef.current, []);
  /** Registers the listener; call it from a layout effect of the shell. */
  const connect = useCallback((next: WorkspaceDataListener) => {
    listener.current = next;
  }, []);
  const requestRestore = useCallback((request: RestoreRequest | null) => {
    restoreRequest.current = request;
  }, []);
  const lastFailure = useCallback(() => loadFailure.current, []);
  const abortLoad = useCallback(
    () => loadRequest.current.controller?.abort(),
    [],
  );
  return {
    data,
    setData,
    error,
    setError,
    signedOut,
    accessDenied,
    busy,
    setBusy,
    loading,
    setLoading,
    bootstrapping,
    setBootstrapping,
    load,
    manage,
    act,
    safeAct,
    retry,
    getData,
    connect,
    requestRestore,
    lastFailure,
    abortLoad,
  };
}
export type WorkspaceDataState = ReturnType<typeof useWorkspaceData>;

/**
 * The first load: opens a deep link from the address bar when the account can
 * reach it, otherwise resumes the last engagement and view, otherwise shows
 * the overview (or the engagement directory without an engagement).
 */
export function useWorkspaceBootstrap(
  workspace: WorkspaceDataState,
  applyWorkspaceLink: (current: WorkspaceData, link: WorkspaceLink) => void,
  setView: (view: string) => void,
) {
  const {
    load,
    setData,
    setError,
    setLoading,
    setBootstrapping,
    requestRestore,
    lastFailure,
    abortLoad,
  } = workspace;
  // The bootstrap applies a link and the view with the latest handlers.
  const applyLink = useEffectEvent(applyWorkspaceLink),
    showView = useEffectEvent(setView);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const first = await load();
        if (!active || !first) return;
        const linked = readWorkspaceLink(window.location.search);
        if (linked) {
          if (!first.memberships.some((m) => m.tenant_id === linked.tenantId)) {
            setError("This link is outside your practice access.");
            return;
          }
          const target =
            linked.tenantId === first.tenantId &&
            linked.engagementId === first.engagement?.id
              ? first
              : await load(linked.tenantId, linked.engagementId || undefined);
          if (target) applyLink(target, linked);
          return;
        }
        let preference;
        try {
          preference = parseResume(
            localStorage.getItem(resumeKey(first.identity.id)),
          );
        } catch {}
        if (preference) {
          const validPractice = first.memberships.some(
              (m) => m.tenant_id === preference.tenantId,
            ),
            validEngagement =
              preference.tenantId !== first.tenantId ||
              first.engagements.some((g) => g.id === preference.engagementId);
          if (validPractice && validEngagement) {
            let restored = first;
            if (
              first.tenantId !== preference.tenantId ||
              first.engagement?.id !== preference.engagementId
            ) {
              requestRestore({ userId: first.identity.id, ...preference });
              setData((previous) =>
                previous ? { ...previous, engagement: null } : null,
              );
              setLoading(true);
              const result = await load(
                preference.tenantId,
                preference.engagementId,
              );
              if (!active) return;
              if (!result) {
                if (["access", "missing"].includes(lastFailure() ?? "")) {
                  requestRestore(null);
                  try {
                    localStorage.removeItem(resumeKey(first.identity.id));
                  } catch {}
                  await load();
                }
                return;
              }
              restored = result;
            }
            showView(
              restored.engagement
                ? permittedAuditView(preference.view, restored.identity.role)
                : "Engagements",
            );
            return;
          }
          try {
            localStorage.removeItem(resumeKey(first.identity.id));
          } catch {}
        }
        showView(first.engagement ? "Overview" : "Engagements");
      } finally {
        if (active) setBootstrapping(false);
      }
    })();
    return () => {
      active = false;
      abortLoad();
    };
    // Bootstraps once per load(); the other members are stable callbacks and
    // state setters.
  }, [
    load,
    setData,
    setError,
    setLoading,
    setBootstrapping,
    requestRestore,
    lastFailure,
    abortLoad,
  ]);
}

/** Remembers the engagement and view to resume on the next visit. */
export function useResumePreference(
  data: WorkspaceData | null,
  view: string,
  loading: boolean,
  bootstrapping: boolean,
) {
  // Persists only when the engagement id, view or role changes, not on every
  // engagement refresh.
  const userId = data?.identity.id,
    tenantId = data?.tenantId,
    engagementId = data?.engagement?.id,
    role = data?.identity.role;
  useEffect(() => {
    if (
      !userId ||
      !tenantId ||
      !engagementId ||
      !role ||
      loading ||
      bootstrapping ||
      !auditViews.includes(view as (typeof auditViews)[number])
    )
      return;
    try {
      localStorage.setItem(
        resumeKey(userId),
        JSON.stringify({
          tenantId,
          engagementId,
          view: permittedAuditView(view, role),
        }),
      );
    } catch {}
  }, [userId, tenantId, engagementId, role, view, loading, bootstrapping]);
}
