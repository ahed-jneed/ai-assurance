// Workspace data: fetching and reloading GET /api/workspace, running
// engagement and management commands, applying their responses, and the
// first load that restores a deep link or the last engagement.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Engagement, Paper, Role } from "@/lib/domain";
import { readWorkspaceLink, type WorkspaceLink } from "@/lib/workspace-links";
import {
  auditViews,
  parseResume,
  permittedAuditView,
  resumeKey,
} from "@/lib/workspace-preferences";
import type { WorkspaceData } from "../workspace-types";

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
const clientRoles = ["Client Viewer", "Client Contributor"];
const manageMessages: Record<string, string> = {
  createClient: "Client created",
  createEngagement: "Engagement created",
  updateClient: "Client updated",
  grantMember: "Member access saved",
  updateMember: "Access updated",
  revokeMember: "Practice access revoked",
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

export function useWorkspaceData() {
  const [data, setData] = useState<WorkspaceData | null>(null),
    [error, setError] = useState(""),
    [signedOut, setSignedOut] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [bootstrapping, setBootstrapping] = useState(true);
  const dataRef = useRef(data);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref read by callbacks and async handlers; writing it during render is the current behaviour
  dataRef.current = data;
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
      const response = await fetch("/api/workspace?" + qs, {
          cache: "no-store",
          signal: controller.signal,
        }),
        body = (await response.json()) as WorkspaceData & { error?: string };
      if (generation !== loadRequest.current.generation) return null;
      if (!response.ok) {
        loadFailure.current =
          response.status === 401
            ? "signed_out"
            : response.status === 403
              ? "access"
              : response.status === 404
                ? "missing"
                : "transient";
        if (response.status === 401) {
          setSignedOut(true);
          setData(null);
          return null;
        }
        if (response.status === 403) setData(null);
        else if (tenantId || engagementId)
          setData((previous) =>
            previous ? { ...previous, engagement: null } : null,
          );
        throw Error(body.error ?? "Request failed");
      }
      if (
        clientRoles.includes(body.identity.role) &&
        dataRef.current &&
        !clientRoles.includes(dataRef.current.identity.role)
      )
        listener.current?.onClientAudience(body.identity.role);
      setData(body);
      setSignedOut(false);
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
          : error instanceof Error
            ? error.message
            : "Workspace unavailable",
      );
      return null;
    } finally {
      if (generation === loadRequest.current.generation) setLoading(false);
    }
  }, []);
  const manage = useCallback(
    async (op: string, values: Record<string, unknown>) => {
      const current = dataRef.current;
      if (!current) throw Error("Workspace unavailable");
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/management", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId: current.tenantId,
              expectedVersion: current.managementVersion,
              op,
              data: values,
            }),
          }),
          body = (await response.json()) as {
            error?: string;
            details: Record<string, string>;
          };
        if (!response.ok) throw Error(body.error ?? "Could not save");
        await load(current.tenantId, current.engagement?.id);
        toast.success(manageMessages[op] ?? "Changes saved");
        return body;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not save";
        setError(message);
        toast.error(message);
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );
  const act = useCallback(
    async (
      op: string,
      values: Record<string, unknown>,
      override?: Engagement,
    ) => {
      const current = dataRef.current;
      if (!current?.engagement) throw Error("Select an engagement");
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              op,
              data: values,
              tenantId: current.tenantId,
              engagementId: override?.id ?? current.engagement.id,
              expectedVersion: override?.version ?? current.engagement.version,
            }),
          }),
          body = (await res.json()) as {
            error?: string;
            engagement: Engagement;
            details?: Record<string, string>;
          };
        if (!res.ok) throw Error(body.error ?? "Request failed");
        if (op === "editPaper") {
          const saved = body.engagement.papers.find(
            (p) => p.id === values.paperId,
          );
          if (saved) listener.current?.onPaperSaved(saved);
        }
        setData((previous) =>
          previous?.tenantId === current.tenantId &&
          previous.engagement?.id === body.engagement.id
            ? { ...previous, engagement: body.engagement }
            : previous,
        );
        await load(current.tenantId, body.engagement.id);
        toast.success(actMessages[op] ?? "Changes saved");
        return body as {
          engagement: Engagement;
          details?: Record<string, string>;
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Save failed";
        setError(message);
        toast.error(message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [load],
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
          if (target) applyWorkspaceLink(target, linked);
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
            setView(
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
        setView(first.engagement ? "Overview" : "Engagements");
      } finally {
        if (active) setBootstrapping(false);
      }
    })();
    return () => {
      active = false;
      abortLoad();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstraps once per load(); applyWorkspaceLink is a plain function recreated on every render, and the other members are stable
  }, [load]);
}

/** Remembers the engagement and view to resume on the next visit. */
export function useResumePreference(
  data: WorkspaceData | null,
  view: string,
  loading: boolean,
  bootstrapping: boolean,
) {
  useEffect(() => {
    if (
      !data?.engagement ||
      loading ||
      bootstrapping ||
      !auditViews.includes(view as (typeof auditViews)[number])
    )
      return;
    try {
      localStorage.setItem(
        resumeKey(data.identity.id),
        JSON.stringify({
          tenantId: data.tenantId,
          engagementId: data.engagement.id,
          view: permittedAuditView(view, data.identity.role),
        }),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persists only when the engagement id, view or role changes, not on every engagement refresh
  }, [
    data?.identity.id,
    data?.tenantId,
    data?.engagement?.id,
    data?.identity.role,
    view,
    loading,
    bootstrapping,
  ]);
}
