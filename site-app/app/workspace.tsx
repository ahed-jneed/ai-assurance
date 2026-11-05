"use client";
import {
  readWorkspaceLink,
  authorizedLink,
  linkQuery,
  type WorkspaceLink,
} from "@/lib/workspace-links";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ShieldCheck,
  LayoutDashboard,
  FileText,
  Database,
  FlaskConical,
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  Settings2,
  Plus,
  ChevronRight,
  LockKeyhole,
  Building2,
  Download,
  History,
  RefreshCw,
  Search,
  Upload,
  XCircle,
  Users,
  Link2,
} from "lucide-react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  articleNames,
  classify,
  canWrite,
  finalReportGates,
  roles,
} from "@/lib/domain";
import type {
  Engagement,
  Paper,
  Finding,
  Report,
  AuditGate,
  EvidenceRequest,
} from "@/lib/domain";
import type { WorkspaceData } from "./workspace-types";
import { SavedViews } from "./business-workspace";
import {
  defaultInboxQuery,
  readInboxQuery,
  inboxQueryParams,
  normalizeInboxQuery,
} from "@/lib/work-inbox";
import { MemberOnboarding } from "./member-onboarding";
import type { WorkItem } from "@/lib/work-items";
import { RecordDetails } from "./record-details";
import { humanLabel, readableResults } from "@/lib/presentation";
import { WorkspaceNavigation } from "./workspace-navigation";
import { PaperEditor } from "./paper-editor";
import { WorkingPaperRegister } from "./paper-register";
import {
  readPaperQuery,
  paperQueryParams,
  selectPaperRegister,
  normalizePaperQuery,
  paperSavedFilter,
  readPaperSavedFilter,
  paperProcedureSection,
} from "@/lib/paper-presentation";
import { DatabaseToolbar } from "./database-toolbar";
import { WorkspaceSearch } from "./workspace-search";
import { RegisterControls } from "./register-controls";
import { EvidenceDetails } from "./evidence-details";
import { EvidenceReviewQueue } from "./evidence-workspace";
import {
  readEvidenceQuery,
  evidenceQueryParams,
  normalizeEvidenceQuery,
} from "@/lib/evidence-presentation";
import { EngagementSwitcher } from "./engagement-switcher";
import { EngagementOverview } from "./engagement-overview";
import { AuditGateList } from "./audit-gates";
import { EvidenceRegister, FindingRegister } from "./audit-registers";
import { NewFindingForm, RemediationForm } from "./finding-forms";
import { EvidenceRequestForm } from "./evidence-request-form";
import { PackageIntegrity } from "./package-integrity";
import {
  defaultWorkbenchQuery,
  readWorkbenchQuery,
  workbenchQueryParams,
  normalizeWorkbenchQuery,
} from "@/lib/workbench-presentation";
import {
  parseResume,
  resumeKey,
  permittedAuditView,
  auditViews,
} from "@/lib/workspace-preferences";
import type { PaperTarget } from "@/lib/paper-workflow";
import type { SearchItem } from "@/lib/workspace-search";
import {
  evidenceRows as selectEvidence,
  findingRows as selectFindings,
} from "@/lib/register-views";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
// View-specific panels are code-split out of the initial bundle. They are
// prefetched once the workspace has bootstrapped (see the effect in Workspace),
// so opening a view normally does not wait for the network.
const panelModules = [
  () => import("./work-inbox"),
  () => import("./management-views"),
  () => import("./audit-program"),
  () => import("./client-portal"),
  () => import("./evidence-requests"),
  () => import("./assurance-workbench"),
  () => import("./testing-lab"),
  () => import("./report-workspace"),
] as const;
const [
  loadWorkInbox,
  loadManagementViews,
  loadAuditProgram,
  loadClientPortal,
  loadEvidenceRequests,
  loadAssuranceWorkbench,
  loadTestingLab,
  loadReportWorkspace,
] = panelModules;
const WorkInbox = lazy(() =>
  loadWorkInbox().then((m) => ({ default: m.WorkInbox })),
);
const ManagementViews = lazy(() =>
  loadManagementViews().then((m) => ({ default: m.ManagementViews })),
);
const AuditProgram = lazy(() =>
  loadAuditProgram().then((m) => ({ default: m.AuditProgram })),
);
const ReportRelease = lazy(() =>
  loadAuditProgram().then((m) => ({ default: m.ReportRelease })),
);
const FindingAssurance = lazy(() =>
  loadAuditProgram().then((m) => ({ default: m.FindingAssurance })),
);
const ClientPortal = lazy(() =>
  loadClientPortal().then((m) => ({ default: m.ClientPortal })),
);
const RequestAccess = lazy(() =>
  loadClientPortal().then((m) => ({ default: m.RequestAccess })),
);
const EvidenceRequests = lazy(() =>
  loadEvidenceRequests().then((m) => ({ default: m.EvidenceRequests })),
);
const EvidenceRequestDetails = lazy(() =>
  loadEvidenceRequests().then((m) => ({ default: m.EvidenceRequestDetails })),
);
const AssuranceWorkbench = lazy(() =>
  loadAssuranceWorkbench().then((m) => ({ default: m.AssuranceWorkbench })),
);
const TestingLab = lazy(() =>
  loadTestingLab().then((m) => ({ default: m.TestingLab })),
);
const ReportWorkspace = lazy(() =>
  loadReportWorkspace().then((m) => ({ default: m.ReportWorkspace })),
);
const panelFallback = (
  <div className="loading-grid" aria-label="Loading">
    <Skeleton className="h-16" />
    <Skeleton className="h-80" />
  </div>
);
const navigation = [
  ["Overview", LayoutDashboard],
  ["Audit program", ClipboardCheck],
  ["Working papers", FileText],
  ["Evidence vault", Database],
  ["Testing lab", FlaskConical],
  ["Assurance workbench", ShieldCheck],
  ["Findings", AlertTriangle],
  ["Regulatory mapping", BookOpen],
  ["Reports & sign-off", ClipboardCheck],
  ["Methodology", BookOpen],
] as const;
const managementNavigation = [
  ["My work", LayoutDashboard],
  ["Clients", Building2],
  ["Engagements", ClipboardCheck],
  ["Users & access", Users],
] as const;
const categories = [
  "Dataset",
  "Model",
  "Training log",
  "Validation",
  "Pipeline code",
  "Governance",
  "Instructions",
  "Oversight",
  "Security",
  "Other",
];
function Badge({ value }: { value: string }) {
  const color = [
    "signed",
    "approved",
    "accepted",
    "pass",
    "closed",
    "succeeded",
  ].includes(value)
    ? "green"
    : ["fail", "Critical", "High", "Prohibited", "failed"].includes(value)
      ? "red"
      : ["in_review", "reviewed", "running", "queued"].includes(value)
        ? "blue"
        : [
              "inconclusive",
              "quarantined",
              "provisional",
              "Medium",
              "unverified",
            ].includes(value)
          ? "amber"
          : "neutral";
  return <span className={"badge " + color}>{value.replaceAll("_", " ")}</span>;
}
function Choice({
  value,
  onChange,
  values,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  values: ({ value: string; label: string } | string)[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      value={value || undefined}
      onValueChange={onChange}
    >
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue placeholder={"Choose " + label.toLowerCase()} />
      </SelectTrigger>
      <SelectContent>
        {values.map((v) =>
          typeof v === "string" ? (
            <SelectItem key={v} value={v}>
              {v.includes("_") ? humanLabel(v) : v}
            </SelectItem>
          ) : (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}
function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function getForm(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries()) as Record<
    string,
    string
  >;
}
function formFingerprint(
  form: HTMLFormElement | null,
  choices: Record<string, string>,
  checks: Record<string, boolean>,
) {
  const fields = form
    ? [...new FormData(form).entries()].map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : value.name
            ? {
                name: value.name,
                size: value.size,
                type: value.type,
                lastModified: value.lastModified,
              }
            : null,
      ])
    : [];
  return JSON.stringify({
    fields,
    choices: Object.entries(choices)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b)),
    checks: Object.keys(checks)
      .filter((key) => checks[key])
      .sort(),
  });
}
export default function Workspace() {
  const linkRestoring = useRef(false),
    lastLink = useRef("");
  const [testingDatasetCard, setTestingDatasetCard] = useState("");
  const [data, setData] = useState<WorkspaceData | null>(null),
    [error, setError] = useState(""),
    [signedOut, setSignedOut] = useState(false),
    [view, setView] = useState("Overview"),
    [clientId, setClientId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [modal, setModal] = useState(""),
    [search, setSearch] = useState(""),
    [paperId, setPaperId] = useState<string | null>(null),
    [paperDraft, setPaperDraft] = useState<Paper | null>(null),
    [detail, setDetail] = useState<{ title: string; value: unknown } | null>(
      null,
    ),
    [finding, setFinding] = useState<Finding | null>(null),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [checks, setChecks] = useState<Record<string, boolean>>({}),
    [filter, setFilter] = useState("all");
  const [evidenceTab, setEvidenceTab] = useState("files"),
    [requestFilter, setRequestFilter] = useState("all");
  const [onboarding, setOnboarding] = useState(false);
  const [procedureSection, setProcedureSection] = useState<
    string | undefined
  >();
  const [procedureContext, setProcedureContext] = useState<
    string | undefined
  >();
  const [reportOpinion, setReportOpinion] = useState("Readiness assessment");
  const [reportSection, setReportSection] = useState("packages");
  const [inboxQuery, setInboxQuery] = useState(defaultInboxQuery);
  const [workbenchQuery, setWorkbenchQuery] = useState(defaultWorkbenchQuery);
  const [paperStatus, setPaperStatus] = useState("all");
  const [modalDirty, setModalDirty] = useState(false),
    [discardModal, setDiscardModal] = useState(false),
    [modalError, setModalError] = useState("");
  const modalFormRef = useRef<HTMLFormElement>(null),
    modalErrorRef = useRef<HTMLParagraphElement>(null),
    modalBaselineRef = useRef(""),
    modalSubmitting = useRef(false),
    modalDirtyRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref read by closeModal(); writing it during render is the current behaviour
  modalDirtyRef.current = modalDirty;
  useEffect(() => {
    if (!modal) modalBaselineRef.current = "";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the modal state after another modal opens or it closes
    setModalDirty(false);
    setModalError("");
    setDiscardModal(false);
  }, [modal]);
  useEffect(() => {
    if (modal && modalBaselineRef.current)
      setModalDirty(
        formFingerprint(modalFormRef.current, choices, checks) !==
          modalBaselineRef.current,
      );
  }, [choices, checks, modal]);
  function closeModal() {
    if (busy) return;
    if (modalDirtyRef.current) setDiscardModal(true);
    else setModal("");
  }
  const dataRef = useRef(data);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref read by callbacks and async handlers; writing it during render is the current behaviour
  dataRef.current = data;
  const loadFailure = useRef<
      "access" | "missing" | "signed_out" | "transient" | null
    >(null),
    restoreRequest = useRef<{
      userId: string;
      tenantId: string;
      engagementId: string;
      view: string;
    } | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false),
    [bootstrapping, setBootstrapping] = useState(true),
    [paperTarget, setPaperTarget] = useState<PaperTarget | undefined>(
      undefined,
    );
  const [sidebarWidth, setSidebarWidth] = useState(272);
  const [searchOpen, setSearchOpen] = useState(false),
    [facet, setFacet] = useState("all"),
    [sort, setSort] = useState("program");
  const [labView, setLabView] = useState("models"),
    [labEditing, setLabEditing] = useState(false),
    [hasPendingComment, setHasPendingComment] = useState(false),
    [commentReset, setCommentReset] = useState(0);
  const [discardPaper, setDiscardPaper] = useState(false),
    [paperConflict, setPaperConflict] = useState(false),
    [detailExpanded, setDetailExpanded] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null),
    savedPaperRef = useRef<Paper | undefined>(undefined),
    draftRef = useRef<Paper | null>(null),
    dirtyRef = useRef(false),
    navigationDirtyRef = useRef(false),
    viewMemory = useRef<
      Record<
        string,
        { search: string; filter: string; facet: string; sort: string }
      >
    >({}),
    loadRequest = useRef<{
      generation: number;
      controller: AbortController | null;
    }>({ generation: 0, controller: null }),
    retrySelection = useRef<{ tenantId?: string; engagementId?: string }>({}),
    navigateRef = useRef<(view: string) => string>(() => "busy");
  // eslint-disable-next-line react-hooks/refs -- latest-value ref read by callbacks and async handlers; writing it during render is the current behaviour
  draftRef.current = paperDraft;
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React Compiler is not enabled; this useCallback, which reads latest-value refs, is the memoization in effect
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
        ["Client Viewer", "Client Contributor"].includes(body.identity.role) &&
        dataRef.current &&
        !["Client Viewer", "Client Contributor"].includes(
          dataRef.current.identity.role,
        )
      ) {
        setEvidenceTab("files");
        setRequestFilter("all");
        setFilter("all");
        setFacet("all");
        setSearch("");
        setSort("newest");
        setDetail(null);
        setPaperId(null);
        setPaperDraft(null);
        setModal("");
        setLabEditing(false);
        setHasPendingComment(false);
        setView((v) => permittedAuditView(v, body.identity.role));
      }
      setData(body);
      setSignedOut(false);
      const requested = restoreRequest.current;
      if (
        requested &&
        requested.userId === body.identity.id &&
        requested.tenantId === body.tenantId &&
        requested.engagementId === body.engagement?.id
      ) {
        setView(permittedAuditView(requested.view, body.identity.role));
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
              restoreRequest.current = {
                userId: first.identity.id,
                ...preference,
              };
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
                if (["access", "missing"].includes(loadFailure.current ?? "")) {
                  restoreRequest.current = null;
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally aborts whichever request is in flight at cleanup time
      loadRequest.current.controller?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstraps once per load(); applyWorkspaceLink is a plain function recreated on every render
  }, [load]);
  useEffect(() => {
    if (bootstrapping) return;
    // Prefetch the code-split panels in the background once the workspace is up.
    for (const loadPanel of panelModules) void loadPanel().catch(() => {});
  }, [bootstrapping]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        data &&
        !busy &&
        !loading &&
        !bootstrapping &&
        !switchOpen &&
        !modal &&
        !detail &&
        !labEditing
      ) {
        event.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [
    data,
    busy,
    loading,
    bootstrapping,
    switchOpen,
    modal,
    detail,
    labEditing,
  ]);
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
        toast.success(
          (
            {
              createClient: "Client created",
              createEngagement: "Engagement created",
              updateClient: "Client updated",
              grantMember: "Member access saved",
              updateMember: "Access updated",
              revokeMember: "Practice access revoked",
            } as Record<string, string>
          )[op] ?? "Changes saved",
        );
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
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React Compiler is not enabled; this useCallback, which reads latest-value refs, is the memoization in effect
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
          if (saved && draftRef.current?.id === saved.id) {
            const draft = structuredClone(saved);
            draft.body.results = readableResults(draft.body.results ?? "");
            savedPaperRef.current = saved;
            setPaperDraft(draft);
            setPaperConflict(false);
          }
        }
        setData((previous) =>
          previous?.tenantId === current.tenantId &&
          previous.engagement?.id === body.engagement.id
            ? { ...previous, engagement: body.engagement }
            : previous,
        );
        await load(current.tenantId, body.engagement.id);
        toast.success(
          (
            {
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
              closeEvidenceRequest:
                "Disposition recorded; limitation memo drafted",
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
            } as Record<string, string>
          )[op] ?? "Changes saved",
        );
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
  useEffect(() => {
    const registry = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => void;
        };
      }
    ).modelContext;
    if (!registry?.registerTool) return;
    const controller = new AbortController();
    const tools = [
      {
        name: "read_audit_workspace",
        title: "Read engagement status",
        description:
          "Read the selected engagement and its review blockers. Does not change audit data.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input: unknown) {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw Error("No input fields accepted");
          const current = dataRef.current;
          if (!current?.engagement) throw Error("No engagement selected");
          return {
            engagementId: current.engagement.id,
            title: current.engagement.title,
            stage: current.engagement.stage,
            role: current.identity.role,
            blockers: finalReportGates(current.engagement).map(
              (g) => g.message,
            ),
          };
        },
      },
      {
        name: "navigate_audit_workspace",
        title: "Open audit module",
        description:
          "Navigate to one audit module without changing audit records.",
        inputSchema: {
          type: "object",
          properties: {
            module: {
              type: "string",
              enum: [...managementNavigation, ...navigation].map(
                ([label]) => label,
              ),
            },
          },
          required: ["module"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input: unknown) {
          const value = input as { module?: string };
          if (
            !value ||
            Object.keys(value).length !== 1 ||
            ![...managementNavigation, ...navigation].some(
              ([label]) => label === value.module,
            )
          )
            throw Error("Unknown audit module");
          return {
            module: value.module,
            status: navigateRef.current(value.module!),
          };
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          registry.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {}
    return () => controller.abort();
  }, []);
  const e = data?.engagement,
    role = data?.identity.role ?? "Client Viewer",
    writer = canWrite(role),
    reviewer = ["Reviewer", "Lead Auditor"].includes(role),
    lead = role === "Lead Auditor",
    viewer = ["Client Viewer", "Client Contributor"].includes(role);
  const displayedEvidenceTab = viewer ? "files" : evidenceTab;
  useEffect(() => {
    if (data)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-normalises the inbox query after the account or the engagement list changes
      setInboxQuery((q) =>
        normalizeInboxQuery(
          q,
          data.identity.role === "Lead Auditor",
          data.engagements.map((e) => e.id),
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on the listed fields of data, not on its identity, which changes on every refresh
  }, [
    data?.tenantId,
    data?.identity.id,
    data?.identity.role,
    data?.engagements,
  ]);
  const selectedPaper = e?.papers.find((p) => p.id === paperId);
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
  const paperFingerprint = (p: Paper) =>
    JSON.stringify({
      body: { ...p.body, results: readableResults(p.body.results ?? "") },
      required: p.required,
      evidenceIds: [...p.evidenceIds].sort(),
    });
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
    const draft = structuredClone(selectedPaper);
    draft.body.results = readableResults(draft.body.results ?? "");
    setPaperDraft(draft);
    setPaperConflict(false);
  }, [selectedPaper]);
  useEffect(() => {
    if (!navigationDirty && !labEditing && !modalDirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [navigationDirty, labEditing, modalDirty]);
  function guarded(next: () => void) {
    if (busy || loading || bootstrapping) return "busy";
    if (modal && !modalSubmitting.current) {
      toast.info("Finish or cancel this form before changing workspace.");
      return "editor_open";
    }
    if (labEditing) {
      toast.info(
        view === "Assurance workbench"
          ? "Finish the pending workbench action or close your unsaved review before changing workspace."
          : "Finish or cancel the model/evaluation setup before changing workspace.",
      );
      return "editor_open";
    }
    if (navigationDirtyRef.current) {
      pendingNavigation.current = next;
      setDiscardPaper(true);
      return "needs_confirmation";
    }
    next();
    return "opened";
  }
  function closePaper() {
    guarded(() => {
      setPaperId(null);
      setPaperDraft(null);
      setPaperConflict(false);
      savedPaperRef.current = undefined;
    });
  }
  function paperAction(op: string, values: Record<string, unknown>) {
    const p = e?.workflow?.procedures.find((p) => p.paperId === values.paperId);
    if (op === "reviewPaper" && p) {
      openPaperProcedure(p.id);
      return;
    }
    void act(op, values).catch(() => {});
  }
  function open(
    name: string,
    defaults: Record<string, string> = {},
    flags: Record<string, boolean> = {},
  ) {
    modalBaselineRef.current = "";
    setModalError("");
    setModalDirty(false);
    setChoices(defaults);
    setChecks(flags);
    setModal(name);
  }
  const choice = (key: string, value: string) =>
    setChoices((x) => ({ ...x, [key]: value }));
  function openPaper(p: Paper, target?: PaperTarget) {
    guarded(() => {
      setPaperTarget(target);
      setError("");
      if (view === "Audit program") setProcedureContext(undefined);
      const draft = structuredClone(p);
      draft.body.results = readableResults(draft.body.results ?? "");
      savedPaperRef.current = p;
      setPaperId(p.id);
      setPaperDraft(draft);
      setPaperConflict(false);
    });
  }
  const management = ["Clients", "Engagements", "Users & access"].includes(
    view,
  );
  const selectedClient =
    view === "Users & access"
      ? undefined
      : data?.clients.find(
          (c) => c.id === (management ? clientId : e?.clientId),
        );
  function navigate(
    label: string,
    options: { search?: string; filter?: string; facet?: string } = {},
    afterOpen?: () => void,
  ) {
    return guarded(() => {
      viewMemory.current[view] = {
        search,
        filter:
          view === "Working papers"
            ? paperSavedFilter({ ...registerQuery, status: paperStatus })
            : view === "Evidence vault" && evidenceTab === "requests"
              ? "requests:" + requestFilter
              : filter,
        facet,
        sort,
      };
      const memory = viewMemory.current[label];
      setView(label);
      if (label === "Evidence vault") {
        const selectedFilter = options.filter ?? memory?.filter ?? "all",
          q = normalizeEvidenceQuery(
            {
              tab: selectedFilter.startsWith("requests:")
                ? "requests"
                : "files",
              filter: selectedFilter.replace(/^requests:/, ""),
              search: options.search ?? memory?.search ?? "",
              facet: options.facet ?? memory?.facet ?? "all",
              sort: memory?.sort,
            },
            role,
          );
        setEvidenceTab(q.tab);
        setRequestFilter(q.tab === "requests" ? q.filter : "all");
      }
      if (label === "Assurance workbench" && procedureContext)
        setWorkbenchQuery({ ...defaultWorkbenchQuery, section: "execution" });
      if (label === "Testing lab")
        setLabView(e?.runs.length ? "runs" : "models");
      setSearch(options.search ?? memory?.search ?? "");
      setFilter(
        label === "Evidence vault" &&
          (options.filter ?? memory?.filter ?? "").startsWith("requests:")
          ? "all"
          : (options.filter ?? memory?.filter ?? "all"),
      );
      setFacet(options.facet ?? memory?.facet ?? "all");
      setSort(
        memory?.sort ??
          (label === "Findings"
            ? "risk"
            : label === "Evidence vault"
              ? "newest"
              : "program"),
      );
      if (label === "Working papers") {
        const q = readPaperSavedFilter(
          options.filter ?? memory?.filter ?? "all",
        );
        setFilter(q.view);
        setPaperStatus(q.status);
      }
      if (label === "Clients") setClientId(null);
      setPaperId(null);
      setPaperDraft(null);
      setDetail(null);
      setPaperConflict(false);
      setHasPendingComment(false);
      afterOpen?.();
    });
  }
  // eslint-disable-next-line react-hooks/refs -- latest-function ref read by the navigation tool registered with navigator.modelContext; writing it during render is the current behaviour
  navigateRef.current = navigate;
  function applyWorkspaceLink(current: WorkspaceData, link: WorkspaceLink) {
    if (!authorizedLink(link, current.identity.role, !!current.engagement)) {
      setError("This page is outside your current access.");
      return;
    }
    setPaperId(null);
    setPaperDraft(null);
    setDetail(null);
    setProcedureContext(undefined);
    setView(link.module);
    setProcedureSection(link.section);
    setPaperTarget(
      link.kind === "paper"
        ? readPaperQuery(window.location.search).target
        : undefined,
    );
    if (link.module === "Working papers") {
      const q = readPaperQuery(window.location.search);
      setFilter(q.view);
      setPaperStatus(q.status);
      setFacet(q.facet);
      setSearch(q.search);
      setSort(q.sort);
    }
    setReportSection(link.section === "completion" ? "completion" : "packages");
    if (link.module === "My work")
      setInboxQuery(
        readInboxQuery(
          window.location.search,
          current.identity.role === "Lead Auditor",
        ),
      );
    if (link.module === "Evidence vault") {
      const q = readEvidenceQuery(
        window.location.search,
        current.identity.role,
      );
      setEvidenceTab(q.tab);
      setRequestFilter(q.tab === "requests" ? q.filter : "all");
      setFilter(q.tab === "files" ? q.filter : "all");
      setSearch(q.search);
      setFacet(q.facet);
      setSort(q.sort);
    }
    setHasPendingComment(false);
    const audit = current.engagement;
    if (link.module === "Assurance workbench") {
      setWorkbenchQuery(readWorkbenchQuery(window.location.search));
      const procedure = new URLSearchParams(window.location.search).get(
        "procedure",
      );
      if (
        procedure &&
        audit?.workflow?.procedures.some((p) => p.id === procedure)
      )
        setProcedureContext(procedure);
    }
    if (!link.recordId) return;
    if (!audit) {
      setError("No engagement is available for this record.");
      return;
    }
    if (link.kind === "procedure") {
      if (audit.workflow?.procedures.some((p) => p.id === link.recordId)) {
        setProcedureContext(link.recordId);
        setView("Audit program");
      } else setError("This procedure is unavailable.");
      return;
    }
    if (link.kind === "paper") {
      const p = audit.papers.find((p) => p.id === link.recordId);
      if (!p) {
        setError("This paper is unavailable.");
        return;
      }
      savedPaperRef.current = p;
      setPaperId(p.id);
      setPaperDraft(structuredClone(p));
      setPaperConflict(false);
      return;
    }
    const record =
      link.kind === "evidence"
        ? audit.artifacts.find((a) => a.id === link.recordId)
        : link.kind === "request"
          ? audit.evidenceRequests?.find((r) => r.id === link.recordId)
          : link.kind === "finding"
            ? audit.findings.find((f) => f.id === link.recordId)
            : link.kind === "report"
              ? audit.reports.find((r) => r.id === link.recordId)
              : link.kind === "model"
                ? audit.models.find((m) => m.id === link.recordId)
                : link.kind === "run"
                  ? audit.runs.find((r) => r.id === link.recordId)
                  : undefined;
    if (record)
      viewDetail(
        "snapshot" in record
          ? (record.kind === "final" ? "Final report" : "Draft report") +
              " · " +
              new Date(record.createdAt).toLocaleDateString()
          : "title" in record
            ? record.title
            : "name" in record
              ? record.name
              : "subject" in record
                ? record.subject
                : "suite" in record
                  ? "Diagnostic run"
                  : "Audit record",
        record,
      );
    else setError("This record is unavailable under your current access.");
    if (
      link.kind === "request" &&
      !["Client Viewer", "Client Contributor"].includes(current.identity.role)
    )
      setEvidenceTab("requests");
  }
  useEffect(() => {
    if (!data || bootstrapping || loading) return;
    const audit = data.engagement,
      v = detail?.value as Record<string, unknown> | undefined;
    const kind = paperId
      ? "paper"
      : v && "id" in v
        ? "category" in v
          ? "evidence"
          : "responsibleParty" in v
            ? "request"
            : "riskScore" in v
              ? "finding"
              : "snapshot" in v
                ? "report"
                : "suite" in v
                  ? "run"
                  : "format" in v
                    ? "model"
                    : ""
        : view === "Audit program" && procedureContext
          ? "procedure"
          : "";
    const recordId =
      paperId ??
      (kind === "procedure"
        ? procedureContext
        : kind
          ? String(v?.id ?? "")
          : "") ??
      "";
    const query = linkQuery({
      tenantId: data.tenantId,
      engagementId: audit?.id ?? "",
      module: view,
      kind,
      recordId,
      section:
        kind === "paper"
          ? (paperTarget ?? "objective")
          : view === "Reports & sign-off"
            ? reportSection
            : view === "Evidence vault"
              ? displayedEvidenceTab
              : view === "Assurance workbench"
                ? workbenchQuery.section
                : kind === "procedure"
                  ? (procedureSection ?? "")
                  : "",
    });
    const params = new URLSearchParams(query);
    if (view === "My work")
      for (const [key, value] of inboxQueryParams(inboxQuery))
        params.set(key, value);
    if (view === "Evidence vault")
      for (const [key, value] of evidenceQueryParams(
        {
          tab: evidenceTab === "requests" ? "requests" : "files",
          filter: evidenceTab === "requests" ? requestFilter : filter,
          search,
          facet,
          sort,
        },
        role,
      ))
        params.set(key, value);
    if (view === "Assurance workbench") {
      for (const [key, value] of workbenchQueryParams(workbenchQuery))
        params.set(key, value);
      if (
        procedureContext &&
        audit?.workflow?.procedures.some((p) => p.id === procedureContext)
      )
        params.set("procedure", procedureContext);
    }
    if (view === "Working papers")
      for (const [key, value] of paperQueryParams({
        view: filter,
        status: paperStatus,
        facet,
        search,
        sort,
      }))
        params.set(key, value);
    const url = window.location.pathname + "?" + params.toString();
    if (lastLink.current === url) return;
    const restoring = linkRestoring.current,
      previousParams = new URLSearchParams(
        lastLink.current.split("?")[1] ?? "",
      ),
      searchChanged =
        (view === "My work" ||
          view === "Evidence vault" ||
          view === "Assurance workbench" ||
          view === "Working papers") &&
        previousParams.get("view") === view &&
        (previousParams.get("q") ?? "") !==
          (view === "My work"
            ? inboxQuery.search
            : view === "Assurance workbench"
              ? workbenchQuery.search
              : search);
    linkRestoring.current = false;
    const paperSectionChanged =
      kind === "paper" &&
      previousParams.get("kind") === "paper" &&
      previousParams.get("record") === recordId &&
      previousParams.get("view") === view &&
      previousParams.get("section") !== params.get("section");
    if (!lastLink.current || restoring || searchChanged || paperSectionChanged)
      window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    lastLink.current = url;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncs the URL from the listed fields of data, not from its identity, which changes on every refresh
  }, [
    data?.tenantId,
    data?.engagement?.id,
    view,
    paperId,
    paperTarget,
    paperStatus,
    detail,
    procedureContext,
    procedureSection,
    reportSection,
    inboxQuery,
    workbenchQuery,
    evidenceTab,
    requestFilter,
    search,
    filter,
    facet,
    sort,
    role,
    displayedEvidenceTab,
    bootstrapping,
    loading,
  ]);
  useEffect(() => {
    const pop = () => {
      const link = readWorkspaceLink(window.location.search),
        current = dataRef.current;
      if (!link || !current) return;
      const previous = lastLink.current;
      const result = guarded(() => {
        void (async () => {
          linkRestoring.current = true;
          const target =
            current.tenantId === link.tenantId &&
            current.engagement?.id === link.engagementId
              ? current
              : await load(link.tenantId, link.engagementId || undefined);
          if (target) applyWorkspaceLink(target, link);
        })();
      });
      if (result !== "opened") window.history.replaceState(null, "", previous);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-registers when the guarding state changes; applyWorkspaceLink and guarded are plain functions recreated on every render
  }, [busy, loading, bootstrapping, modal, labEditing, load]);
  async function copyWorkspaceLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied. Recipients need existing access.");
    } catch {
      toast.error("Link could not be copied. Use the address bar.");
    }
  }
  function openWork(item: WorkItem) {
    guarded(() => {
      void (async () => {
        const loaded =
          item.engagementId === dataRef.current?.engagement?.id
            ? dataRef.current
            : await load(dataRef.current?.tenantId, item.engagementId);
        const audit = loaded?.engagement;
        if (!audit) return;
        setView(item.module);
        setSearch("");
        setFilter("all");
        setPaperStatus("all");
        setFacet("all");
        setSort("program");
        setPaperTarget(undefined);
        setProcedureContext(undefined);
        setHasPendingComment(false);
        setPaperId(null);
        setPaperDraft(null);
        setDetail(null);
        if (
          ["procedure", "scope", "program", "monitoring"].includes(item.kind)
        ) {
          setProcedureContext(
            item.kind === "procedure" ? item.recordId : undefined,
          );
          setProcedureSection(
            item.section ??
              (item.kind === "scope"
                ? "brief"
                : item.kind === "monitoring"
                  ? "followup"
                  : "program"),
          );
        } else if (item.kind === "paper") {
          const p = audit.papers.find((p) => p.id === item.recordId);
          if (p) {
            savedPaperRef.current = p;
            setPaperId(p.id);
            setPaperDraft(structuredClone(p));
            setPaperConflict(false);
          }
        } else {
          const record =
            item.kind === "request"
              ? audit.evidenceRequests?.find((r) => r.id === item.recordId)
              : item.kind === "finding"
                ? audit.findings.find((r) => r.id === item.recordId)
                : audit.reports.find((r) => r.id === item.recordId);
          if (record) viewDetail(item.title, record);
          if (item.kind === "request") setEvidenceTab("requests");
        }
      })();
    });
  }
  function openRequests() {
    if (
      navigate("Evidence vault", {
        search: "",
        filter: "all",
        facet: "all",
      }) === "opened"
    ) {
      setEvidenceTab("requests");
      setRequestFilter("open");
    }
  }
  function requestForm(form: string, r?: EvidenceRequest, p?: Paper) {
    const live = r
      ? (e?.evidenceRequests?.find((q) => q.id === r.id) ?? r)
      : undefined;
    const flags = Object.fromEntries([
      ...(live?.paperIds ?? (p ? [p.id] : [])).map((id) => [
        "paper:" + id,
        true,
      ]),
      ...(live?.evidenceIds ?? []).map((id) => ["evidence:" + id, true]),
    ]);
    open(
      form,
      {
        requestId: live?.id ?? "",
        decision: "",
        disposition: "",
        deliveryComplete:
          live?.deliveryComplete === undefined
            ? ""
            : String(live.deliveryComplete),
      },
      flags,
    );
  }
  function requestForPaper(p: Paper) {
    guarded(() => {
      setPaperId(null);
      setPaperDraft(null);
      setHasPendingComment(false);
      setView("Evidence vault");
      setEvidenceTab("requests");
      setSearch("");
      requestForm("request", undefined, p);
    });
  }
  function openGate(gate: AuditGate, target?: PaperTarget) {
    if (["paper", "conclusion"].includes(gate.kind)) {
      const paper = e?.papers.find((p) => p.id === gate.recordId);
      if (paper) openPaper(paper, target);
    } else if (gate.kind === "request") {
      const request = e?.evidenceRequests?.find((r) => r.id === gate.recordId);
      if (request) guarded(() => viewDetail(request.subject, request));
    } else if (gate.kind === "workflow") {
      setProcedureContext(gate.recordId);
      navigate("Audit program");
    } else if (gate.kind === "classification")
      navigate("Regulatory mapping", {
        search: "",
        filter: "all",
        facet: "all",
      });
    else if (gate.kind === "stage") navigate("Overview");
    else if (gate.kind === "run") {
      if (navigate("Testing lab") === "opened") setLabView("runs");
    } else if (gate.kind === "finding") {
      const record = e?.findings.find((f) => f.id === gate.recordId);
      if (record) guarded(() => viewDetail(record.title, record));
    }
  }
  function openClient(id: string) {
    guarded(() => {
      setPaperId(null);
      setPaperDraft(null);
      setDetail(null);
      setHasPendingComment(false);
      setClientId(id);
      setView("Clients");
      setSearch("");
    });
  }
  function switchEngagement() {
    if (busy || loading || bootstrapping) return "busy";
    setSwitchOpen(true);
    return "opened";
  }
  function openEngagement(id: string) {
    const current = dataRef.current;
    if (!current?.engagements.some((g) => g.id === id)) return;
    if (current.engagement?.id === id) {
      setSwitchOpen(false);
      if (!auditViews.includes(view as (typeof auditViews)[number]))
        navigate("Overview");
      return;
    }
    guarded(() => {
      restoreRequest.current = null;
      setPaperId(null);
      setPaperDraft(null);
      setDetail(null);
      setHasPendingComment(false);
      setView(
        auditViews.includes(view as (typeof auditViews)[number])
          ? permittedAuditView(view, current.identity.role)
          : "Overview",
      );
      setSearch("");
      setFilter("all");
      setEvidenceTab("files");
      setRequestFilter("all");
      setWorkbenchQuery({ ...defaultWorkbenchQuery });
      setProcedureContext(undefined);
      setFacet("all");
      setSort(
        view === "Findings"
          ? "risk"
          : view === "Evidence vault"
            ? "newest"
            : "program",
      );
      setPaperStatus("all");
      setLoading(true);
      setSwitchOpen(false);
      setSearchOpen(false);
      savedPaperRef.current = undefined;
      viewMemory.current = {};
      void load(current.tenantId, id);
    });
  }
  function searchSelect(item: SearchItem) {
    const current = dataRef.current;
    if (!current) return;
    if (item.kind === "page") {
      navigate(item.id);
      return;
    }
    if (item.kind === "client") {
      if (current.clients.some((c) => c.id === item.id)) openClient(item.id);
      return;
    }
    if (item.kind === "engagement") {
      if (current.engagements.some((e) => e.id === item.id))
        openEngagement(item.id);
      return;
    }
    const audit = current.engagement;
    if (!audit) return;
    if (item.kind === "paper") {
      const paper = audit.papers.find((p) => p.id === item.id);
      if (paper) openPaper(paper);
      return;
    }
    if (item.kind === "procedure") {
      navigate("Audit program", {}, () => {
        setProcedureContext(item.id);
        setProcedureSection("plan");
      });
      return;
    }
    const record =
      item.kind === "request"
        ? audit.evidenceRequests?.find((r) => r.id === item.id)
        : item.kind === "model"
          ? audit.models.find((m) => m.id === item.id)
          : item.kind === "run"
            ? audit.runs.find((r) => r.id === item.id)
            : item.kind === "evidence"
              ? audit.artifacts.find((a) => a.id === item.id)
              : item.kind === "finding"
                ? audit.findings.find((f) => f.id === item.id)
                : item.kind === "report"
                  ? audit.reports.find((r) => r.id === item.id)
                  : current.catalog?.items.find((t) => t.id === item.id);
    if (record)
      guarded(() => {
        setPaperId(null);
        setPaperDraft(null);
        setHasPendingComment(false);
        viewDetail(item.label, record);
      });
  }
  function clearRegister() {
    setSearch("");
    setFilter("all");
    setFacet("all");
    if (view === "Working papers") {
      setPaperStatus("all");
      setSort("program");
    }
  }
  function openPaperProcedure(id: string) {
    guarded(() => {
      setPaperId(null);
      setPaperDraft(null);
      setProcedureContext(id);
      const source = e?.workflow?.procedures.find((p) => p.id === id);
      setProcedureSection(
        e && source ? paperProcedureSection(e, source) : "plan",
      );
      setView("Audit program");
      setHasPendingComment(false);
    });
  }
  function resolveName(id: string) {
    return (
      data?.people.find((p) => p.user_id === id)?.display_name ??
      (id === data?.identity.id ? data.identity.name : undefined) ??
      e?.artifacts.find((a) => a.id === id)?.name ??
      e?.models.find((m) => m.id === id)?.name ??
      e?.papers.find((p) => p.id === id)?.title ??
      id
    );
  }
  function viewDetail(title: string, value: unknown) {
    setDetailExpanded(false);
    setDetail({ title, value });
  }
  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget,
      v = getForm(form);
    setModalError("");
    modalSubmitting.current = true;
    try {
      if (modal === "requestAssess" && !choices.decision)
        throw Error(
          "Choose whether evidence is sufficient or needs follow-up.",
        );
      if (modal === "requestClose" && !choices.disposition)
        throw Error("Choose the reason for closing this request.");
      if (
        ["request", "requestEdit"].includes(modal) &&
        !e?.papers.some((p) => checks["paper:" + p.id])
      )
        throw Error(
          "Link at least one working paper supported by this request.",
        );
      if (modal === "requestResponse" && !choices.deliveryComplete)
        throw Error("Record whether the delivery is complete or partial.");
      if (
        modal === "requestResponse" &&
        !e?.artifacts.some((a) => checks["evidence:" + a.id])
      )
        throw Error(
          "Select the received evidence files. Upload them in the vault first if needed.",
        );
      if (modal === "paper" && !choices.templateId)
        throw Error("Choose a methodology template before creating the paper.");
      if (modal === "engagement" && !choices.clientId)
        throw Error("Choose a client for this engagement.");
      if (
        ["member", "memberEdit"].includes(modal) &&
        (!choices.role ||
          (["Client Viewer", "Client Contributor"].includes(choices.role) &&
            !choices.clientId))
      )
        throw Error(
          ["Client Viewer", "Client Contributor"].includes(choices.role)
            ? "Choose the client this viewer can access."
            : "Choose a role for this member.",
        );
      if (modal === "paper") {
        const result = await act("createPaper", {
          templateId: choices.templateId,
        });
        const paper = result.engagement.papers.find(
          (p) => p.id === result.details?.paperId,
        );
        if (paper) {
          setView("Working papers");
          setSearch("");
          setFilter("all");
          setPaperStatus("all");
          setFacet("all");
          setSort("program");
          openPaper(paper);
        }
      }
      if (modal === "linkEvidence") {
        const paper = e?.papers.find(
          (p) => p.id === choices.paperId && p.status !== "signed",
        );
        if (!paper) throw Error("Choose an unsigned paper");
        const draft = structuredClone(paper);
        draft.body.results = readableResults(draft.body.results ?? "");
        draft.evidenceIds = [
          ...new Set([...draft.evidenceIds, choices.artifactId]),
        ];
        setPaperTarget("evidence");
        if (
          navigate("Working papers", {
            search: "",
            filter: "all",
            facet: "all",
          }) !== "opened"
        )
          return;
        setDetail(null);
        setPaperId(paper.id);
        savedPaperRef.current = paper;
        setPaperDraft(draft);
        setView("Working papers");
      }
      if (modal === "client") {
        const result = await manage("createClient", {
          name: v.name,
          sector: v.sector,
        });
        setClientId(result.details.clientId);
        setView("Clients");
        setSearch("");
      }
      if (modal === "clientEdit") {
        await manage("updateClient", {
          clientId: choices.clientId,
          name: v.name,
          sector: v.sector,
        });
      }
      if (modal === "engagement") {
        const result = await manage("createEngagement", {
          clientId: choices.clientId,
          title: v.title,
        });
        if (result.details?.engagementId) {
          await load(data!.tenantId, result.details.engagementId);
          setView("Overview");
          setSearch("");
        }
      }
      if (modal === "rename") {
        await act("renameEngagement", { title: v.title, dueDate: v.dueDate });
      }
      if (modal === "member" || modal === "memberEdit") {
        await manage(modal === "member" ? "grantMember" : "updateMember", {
          userId: choices.userId || v.userId,
          displayName: v.displayName,
          role: choices.role,
          clientId: choices.clientId || null,
        });
      }
      if (modal === "memberRevoke") {
        await manage("revokeMember", { userId: choices.userId });
      }
      if (modal === "upload") {
        setBusy(true);
        const fd = new FormData(form);
        fd.set("tenantId", data!.tenantId);
        fd.set("engagementId", e!.id);
        fd.set("expectedVersion", String(e!.version));
        fd.set("category", choices.category || "Other");
        fd.set("visibility", choices.visibility || "internal");
        fd.set("handlingBasis", choices.handlingBasis || "");
        fd.set("governanceArtifactId", choices.governanceArtifactId || "");
        const response = await fetch("/api/evidence", {
            method: "POST",
            body: fd,
          }),
          body = (await response.json()) as WorkspaceData & { error?: string };
        if (!response.ok) throw Error(body.error ?? "Request failed");
        await load(data!.tenantId, e!.id);
        toast.success("Evidence uploaded; acceptance review required");
        setBusy(false);
      }
      if (modal === "classification") {
        await act("classify", {
          prohibited: !!checks.prohibited,
          highRisk: !!checks.highRisk,
          transparency: !!checks.transparency,
          profiling: !!checks.profiling,
          annexRoute: choices.annexRoute,
          operatorRole: choices.operatorRole,
          intendedPurpose: v.intendedPurpose,
          rationale: v.rationale,
        });
      }
      if (modal === "finding") {
        await act("createFinding", {
          title: v.title,
          procedureId: choices.procedureId || undefined,
          article: choices.article,
          condition: v.condition,
          criteria: v.criteria,
          cause: v.cause,
          effect: v.effect,
          likelihood: Number(choices.likelihood),
          impact: Number(choices.impact),
          owner: v.owner,
          dueDate: v.dueDate,
          visibility: choices.visibility,
        });
      }
      if (["request", "requestEdit"].includes(modal))
        await act(
          modal === "request"
            ? "createEvidenceRequest"
            : "updateEvidenceRequest",
          {
            ...(modal === "requestEdit"
              ? { requestId: choices.requestId }
              : {}),
            subject: v.subject,
            description: v.description,
            responsibleParty: v.responsibleParty,
            periodVersion: v.periodVersion,
            handling: v.handling,
            dueDate: v.dueDate,
            paperIds: e!.papers
              .filter((p) => checks["paper:" + p.id])
              .map((p) => p.id),
          },
        );
      if (modal === "requestResponse")
        await act("recordEvidenceResponse", {
          requestId: choices.requestId,
          response: v.response,
          deliveryComplete: choices.deliveryComplete === "true",
          remainingItems: v.remainingItems,
          evidenceIds: e!.artifacts
            .filter((a) => checks["evidence:" + a.id])
            .map((a) => a.id),
        });
      if (modal === "requestAssess")
        await act("assessEvidenceRequest", {
          requestId: choices.requestId,
          decision: choices.decision,
          assessment: v.assessment,
        });
      if (modal === "requestClose")
        await act("closeEvidenceRequest", {
          requestId: choices.requestId,
          disposition: choices.disposition,
          assessment: v.assessment,
        });
      if (modal === "requestReopen")
        await act("reopenEvidenceRequest", {
          requestId: choices.requestId,
          reason: v.reason,
        });
      if (modal === "findingEdit" && finding) {
        await act("updateFinding", {
          findingId: finding.id,
          status: choices.status,
          response: v.response,
          remediation: v.remediation,
          retestEvidenceIds: e!.artifacts
            .filter((a) => checks[a.id])
            .map((a) => a.id),
        });
      }
      if (
        modal === "report" &&
        choices.kind === "final" &&
        e &&
        finalReportGates(e, choices.opinion).length
      )
        throw Error(
          "Resolve the final-report requirements or choose a draft snapshot.",
        );
      if (modal === "report") {
        await act("createReport", {
          kind: choices.kind,
          opinion: choices.opinion,
          summary: v.summary,
        });
      }
      setModal("");
    } catch (err) {
      setBusy(false);
      const message = err instanceof Error ? err.message : "Could not save";
      setModalError(message);
      requestAnimationFrame(() => modalErrorRef.current?.focus());
      if (modal === "upload") {
        setError(message);
        toast.error(message);
      }
    } finally {
      modalSubmitting.current = false;
    }
  };
  function safeAct(op: string, values: Record<string, unknown>) {
    void act(op, values).catch(() => {});
  }
  function remediateFinding(id: string) {
    const current = e?.findings.find((f) => f.id === id);
    if (!writer || !current || current.status === "closed") return;
    setFinding(current);
    open(
      "findingEdit",
      { status: current.status === "open" ? "in_progress" : current.status },
      Object.fromEntries(current.retestEvidenceIds.map((id) => [id, true])),
    );
  }
  const liveDetail =
    detail?.value && typeof detail.value === "object" && "id" in detail.value
      ? (("condition" in detail.value
          ? e?.findings.find((f) => f.id === (detail.value as Finding).id)
          : "responsibleParty" in detail.value
            ? e?.evidenceRequests?.find(
                (r) => r.id === (detail.value as EvidenceRequest).id,
              )
            : undefined) ?? detail.value)
      : detail?.value;
  const controls = Object.entries(articleNames).map(([article, title]) => {
    const papers =
      e?.papers.filter(
        (p) =>
          p.required &&
          p.articleRefs.some((r) =>
            new RegExp(
              "(?:Art\\.?|Article)\\s*" + article + "(?:\\D|$)",
              "i",
            ).test(r),
          ),
      ) ?? [];
    const signed = papers.filter((p) => p.status === "signed").length;
    return {
      article,
      title,
      papers,
      signed,
      coverage: papers.length ? Math.round((signed / papers.length) * 100) : 0,
    };
  });
  const registerQuery = { view: filter, facet, search, sort },
    paperQuery = normalizePaperQuery({ ...registerQuery, status: paperStatus }),
    paperRegister = e
      ? selectPaperRegister(
          e,
          role,
          data?.identity.id ?? "",
          paperQuery,
          resolveName,
        )
      : { rows: [], counts: { all: 0, mine: 0, review: 0, blocked: 0 } },
    paperRows = paperRegister.rows.map((r) => r.paper),
    evidenceRows = selectEvidence(e?.artifacts ?? [], registerQuery),
    findingRows = selectFindings(e?.findings ?? [], registerQuery);
  const templateRows =
    data?.catalog?.items
      .filter(
        (t) =>
          (filter === "all" || t.kind === filter) &&
          (facet === "all" || t.stage === facet) &&
          (t.id + " " + t.title).toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) =>
        sort === "name_asc"
          ? a.title.localeCompare(b.title)
          : a.id.localeCompare(b.id),
      ) ?? [];
  const paperSequence =
      view === "Working papers" ? paperRows : (e?.papers ?? []),
    paperPosition = paperSequence.findIndex((p) => p.id === paperId);
  const registerControls = (
    label: string,
    values: string[],
    sorts: { value: string; label: string }[],
  ) => (
    <RegisterControls
      facetLabel={label}
      facets={values}
      facet={facet}
      onFacet={setFacet}
      sort={sort}
      sorts={sorts}
      onSort={setSort}
      active={!!search || filter !== "all" || facet !== "all"}
      onClear={clearRegister}
    />
  );
  const actions: Record<string, { label: string; action: () => void }> = {
    "Working papers": {
      label: "New working paper",
      action: () => open("paper"),
    },
    "Evidence vault": {
      label: "Upload evidence",
      action: () =>
        open("upload", {
          category: "Dataset",
          visibility: "internal",
          handlingBasis: "synthetic",
        }),
    },
    Findings: {
      label: "New finding",
      action: () =>
        open("finding", {
          article: "10",
          likelihood: "3",
          impact: "3",
          visibility: "internal",
        }),
    },
    "Regulatory mapping": {
      label: "Assess classification",
      action: () =>
        open(
          "classification",
          {
            operatorRole: e?.classification.operatorRole ?? "Provider",
            annexRoute: e?.classification.annexRoute ?? "Unassessed",
          },
          e
            ? {
                prohibited: e.classification.prohibited,
                highRisk: e.classification.highRisk,
                transparency: e.classification.transparency,
                profiling: e.classification.profiling,
              }
            : {},
        ),
    },
    "Reports & sign-off": {
      label: "Create report snapshot",
      action: () => open("report", { kind: "draft", opinion: reportOpinion }),
    },
  };
  const contextualNew = () =>
    currentAction && writer ? (
      <Button disabled={busy} onClick={currentAction.action}>
        <Plus size={15} />
        {currentAction.label}
      </Button>
    ) : null;
  const currentAction = actions[view],
    PageIcon = navigation.find(([label]) => label === view)?.[1] ?? FileText;
  if (signedOut)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <ShieldCheck size={40} />
          <p className="eyebrow">AI ASSURANCE</p>
          <h1>Your audit workspace</h1>
          <p className="body-copy">
            Sign in to access your practice, client engagements and controlled
            audit evidence.
          </p>
          <a
            href="/signin-with-chatgpt?return_to=%2F"
            target="_top"
            className="signin-button"
          >
            Sign in with ChatGPT
          </a>
          <p className="subtle">
            Access is determined by your practice membership.
          </p>
        </div>
      </div>
    );
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": sidebarWidth + "px",
          "--sidebar-width-icon": "4rem",
        } as React.CSSProperties
      }
    >
      <a href="#audit-main-content" className="audit-skip-link">
        Skip to audit content
      </a>
      <Toaster richColors />
      <WorkspaceNavigation
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        data={data}
        view={view}
        navigationDisabled={
          !data || busy || loading || bootstrapping || switchOpen
        }
        onSearch={() => setSearchOpen(true)}
        searchDisabled={
          !data ||
          busy ||
          loading ||
          bootstrapping ||
          switchOpen ||
          !!modal ||
          !!detail ||
          labEditing
        }
        onNavigate={navigate}
        onSwitch={switchEngagement}
        onPractice={(id) =>
          guarded(() => {
            restoreRequest.current = null;
            setPaperId(null);
            setPaperDraft(null);
            setClientId(null);
            setView("Overview");
            setWorkbenchQuery({ ...defaultWorkbenchQuery });
            setProcedureContext(undefined);
            setInboxQuery({ ...defaultInboxQuery });
            setSearch("");
            setEvidenceTab("files");
            setRequestFilter("all");
            setFilter("all");
            setFacet("all");
            setSort("program");
            setPaperStatus("all");
            setDetail(null);
            setHasPendingComment(false);
            setSearchOpen(false);
            savedPaperRef.current = undefined;
            viewMemory.current = {};
            setLoading(true);
            void load(id);
          })
        }
      />
      <SidebarInset>
        <header className="topbar">
          <div className="workspace-breadcrumbs">
            <SidebarTrigger />
            {view === "Users & access" ? (
              <span>Members & access</span>
            ) : (
              <>
                <button className="crumb" onClick={() => navigate("Clients")}>
                  Clients
                </button>
                {selectedClient && (
                  <>
                    <ChevronRight size={13} />
                    <button
                      className="crumb"
                      onClick={() => openClient(selectedClient.id)}
                    >
                      {selectedClient.name}
                    </button>
                  </>
                )}
                {!management && e && (
                  <>
                    <ChevronRight size={13} />
                    <button
                      className="crumb engagement-crumb"
                      onClick={() => navigate("Overview")}
                    >
                      {e.title}
                    </button>
                    {view !== "Overview" && (
                      <>
                        <ChevronRight size={13} />
                        <span>
                          {view === "Methodology"
                            ? "Templates & history"
                            : view}
                        </span>
                      </>
                    )}
                  </>
                )}
                {management && view === "Engagements" && (
                  <>
                    <ChevronRight size={13} />
                    <span>Engagements</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="topbar-tools">
            <Button
              className="topbar-search"
              variant="ghost"
              size="sm"
              disabled={
                !data ||
                busy ||
                loading ||
                bootstrapping ||
                switchOpen ||
                !!modal ||
                !!detail ||
                labEditing
              }
              aria-label="Search workspace"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={15} />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </Button>
            <span className="topbar-access">
              <LockKeyhole size={13} />
              {role}
            </span>
          </div>
        </header>
        <main id="audit-main-content" tabIndex={-1} className="audit-main">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void load(
                    retrySelection.current.tenantId,
                    retrySelection.current.engagementId,
                  )
                }
              >
                <RefreshCw size={14} /> Retry
              </Button>
            </div>
          )}
          {loading || bootstrapping ? (
            <div className="loading-grid" aria-label="Loading workspace">
              <Skeleton className="h-16" />
              <Skeleton className="h-32" />
              <Skeleton className="h-80" />
            </div>
          ) : (
            data && (
              <>
                {view === "My work" && !viewer ? (
                  <Suspense fallback={panelFallback}>
                    <WorkInbox
                      data={data}
                      onOpen={openWork}
                      query={inboxQuery}
                      onQueryChange={setInboxQuery}
                      onCopyLink={() => void copyWorkspaceLink()}
                    />
                  </Suspense>
                ) : management ? (
                  <Suspense fallback={panelFallback}>
                    <ManagementViews
                      onBack={() => navigate("Clients")}
                      view={view}
                      data={data}
                      clientId={clientId}
                      setClientId={setClientId}
                      onEngagement={openEngagement}
                      open={open}
                      onOnboard={() => setOnboarding(true)}
                      busy={busy}
                      search={search}
                      setSearch={setSearch}
                    />
                  </Suspense>
                ) : e ? (
                  <>
                    <div className="page-head">
                      <div className="page-heading">
                        <PageIcon size={22} />
                        <h1>
                          {view === "Overview"
                            ? e.title
                            : view === "Methodology"
                              ? "Templates & history"
                              : view}
                        </h1>
                      </div>
                      <div className="row-actions page-head-actions">
                        {!viewer && (
                          <div className="page-utilities">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Copy page link"
                              aria-label="Copy page link"
                              onClick={() => void copyWorkspaceLink()}
                            >
                              <Link2 size={16} aria-hidden="true" />
                            </Button>
                            <SavedViews
                              compact
                              tenantId={data.tenantId}
                              current={{
                                module: view,
                                search,
                                filter:
                                  view === "Working papers"
                                    ? paperSavedFilter({
                                        ...registerQuery,
                                        status: paperStatus,
                                      })
                                    : view === "Evidence vault" &&
                                        evidenceTab === "requests"
                                      ? "requests:" + requestFilter
                                      : filter,
                                facet,
                                sort,
                              }}
                              onOpen={(v) =>
                                navigate(
                                  v.module,
                                  {
                                    search: v.search,
                                    filter: v.filter,
                                    facet: v.facet,
                                  },
                                  () => setSort(v.sort),
                                )
                              }
                            />
                          </div>
                        )}
                        {view === "Overview" && !viewer && (
                          <>
                            {lead && (
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => open("rename")}
                                aria-label="Engagement settings"
                              >
                                <Settings2 size={16} />
                              </Button>
                            )}
                            <Button onClick={() => navigate("Audit program")}>
                              {e.workflow
                                ? "Open audit program"
                                : "Set up audit program"}
                              <ChevronRight size={15} />
                            </Button>
                          </>
                        )}
                        {/* eslint-disable-next-line react-hooks/refs -- currentAction.action is a click handler; the refs it reaches are read only when it runs */}
                        {currentAction &&
                          ![
                            "Working papers",
                            "Evidence vault",
                            "Findings",
                            "Reports & sign-off",
                          ].includes(view) &&
                          (view === "Reports & sign-off" ? lead : writer) && (
                            <Button
                              disabled={
                                busy ||
                                (view === "Testing lab" &&
                                  (!e.models.some(
                                    (m) =>
                                      m.format === "Prediction file" &&
                                      m.task === "Binary classification" &&
                                      m.status === "registered",
                                  ) ||
                                    !e.artifacts.some(
                                      (a) =>
                                        a.category === "Dataset" &&
                                        a.status === "accepted" &&
                                        a.name.toLowerCase().endsWith(".csv"),
                                    )))
                              }
                              onClick={currentAction.action}
                            >
                              <Plus size={16} />
                              {currentAction.label}
                            </Button>
                          )}
                      </div>
                    </div>
                    {view === "Overview" && (
                      <div className="context-strip">
                        <Badge value={classify(e.classification)} />
                        <span>{e.stage}</span>
                        {e.dueDate && <span>Due {e.dueDate}</span>}
                      </div>
                    )}
                    {procedureContext &&
                      !viewer &&
                      view !== "Audit program" &&
                      e.workflow?.procedures.some(
                        (p) => p.id === procedureContext,
                      ) && (
                        <div className="procedure-return">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate("Audit program")}
                          >
                            <ChevronRight size={14} />
                            Return to{" "}
                            {
                              e.workflow.procedures.find(
                                (p) => p.id === procedureContext,
                              )?.templateId
                            }{" "}
                            ·{" "}
                            {
                              e.workflow.procedures.find(
                                (p) => p.id === procedureContext,
                              )?.title
                            }
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Clear procedure context"
                            onClick={() => setProcedureContext(undefined)}
                          >
                            <XCircle size={14} />
                          </Button>
                        </div>
                      )}
                    {view === "Audit program" && !viewer && (
                      <Suspense fallback={panelFallback}>
                        <AuditProgram
                          onLocation={(id, section) => {
                            setProcedureContext(id);
                            setProcedureSection(section);
                          }}
                          key={e.id}
                          data={data}
                          busy={busy}
                          act={act}
                          onPaper={openPaper}
                          onRequest={requestForPaper}
                          onNavigate={navigate}
                          onEditing={setLabEditing}
                          initialProcedure={procedureContext}
                          initialSection={procedureSection}
                          onRecord={viewDetail}
                          onContext={setProcedureContext}
                          onFinding={(p) =>
                            open("finding", {
                              procedureId: p.id,
                              title: p.title + " — exception",
                              condition: p.execution?.results ?? "",
                              criteria: p.criterion,
                              article:
                                p.candidateRefs
                                  .join(" ")
                                  .match(/(?:Art\.?|Article)\s*(\d+)/i)?.[1] ??
                                "10",
                              likelihood: "3",
                              impact: "3",
                              visibility: "internal",
                            })
                          }
                          onFollowup={(id) => openEngagement(id)}
                        />
                      </Suspense>
                    )}
                    {view === "Overview" &&
                      viewer &&
                      role === "Client Contributor" && (
                        <Suspense fallback={panelFallback}>
                          <ClientPortal
                            data={data}
                            busy={busy}
                            onEditing={setLabEditing}
                            onReload={() => load(data.tenantId, e.id)}
                          />
                        </Suspense>
                      )}
                    {view === "Overview" &&
                      (viewer ? (
                        <ClientOverview engagement={e} onView={navigate} />
                      ) : (
                        <>
                          <EngagementOverview
                            data={data}
                            onWork={openWork}
                            engagement={e}
                            role={role}
                            userId={data.identity.id}
                            onPaper={openPaper}
                            onNavigate={navigate}
                            onGate={openGate}
                            onRequests={openRequests}
                            busy={busy}
                            onAdvance={(stage) =>
                              safeAct("setStage", { stage })
                            }
                          />
                          <details className="engagement-details">
                            <summary>Article coverage</summary>
                            {controls.map((c) => (
                              <button
                                className="control-row"
                                key={c.article}
                                onClick={() => {
                                  navigate("Working papers", {
                                    search: c.papers[0]?.templateId ?? "",
                                    filter: "all",
                                    facet: "all",
                                  });
                                }}
                              >
                                <span className="article">{c.article}</span>
                                <div>
                                  <b>{c.title}</b>
                                  <Progress
                                    value={c.coverage}
                                    aria-label={c.title + " signed coverage"}
                                  />
                                </div>
                                <span className="badge neutral">
                                  {c.signed} / {c.papers.length}
                                </span>
                              </button>
                            ))}
                          </details>
                        </>
                      ))}
                    {view === "Working papers" && (
                      <WorkingPaperRegister
                        engagement={e}
                        rows={paperRegister.rows}
                        role={role}
                        query={paperQuery}
                        onQuery={(patch) => {
                          if (patch.view !== undefined) setFilter(patch.view);
                          if (patch.status !== undefined)
                            setPaperStatus(patch.status);
                          if (patch.facet !== undefined) setFacet(patch.facet);
                          if (patch.search !== undefined)
                            setSearch(patch.search);
                          if (patch.sort !== undefined) setSort(patch.sort);
                        }}
                        onReset={clearRegister}
                        onOpen={openPaper}
                        onProcedure={openPaperProcedure}
                        resolve={resolveName}
                        busy={busy}
                        onNew={writer ? () => open("paper") : undefined}
                      />
                    )}
                    {view === "Evidence vault" && (
                      <>
                        {role === "Client Contributor" && (
                          <Suspense fallback={panelFallback}>
                            <ClientPortal
                              data={data}
                              busy={busy}
                              onEditing={setLabEditing}
                              onReload={() => load(data.tenantId, e.id)}
                            />
                          </Suspense>
                        )}
                        <EvidenceReviewQueue
                          engagement={e}
                          role={role}
                          tab={evidenceTab}
                          filter={
                            evidenceTab === "requests" ? requestFilter : filter
                          }
                          onSelect={(tab, nextFilter) => {
                            setEvidenceTab(tab);
                            setFilter(tab === "files" ? nextFilter : "all");
                            setRequestFilter(
                              tab === "requests" ? nextFilter : "all",
                            );
                            setSearch("");
                            setFacet("all");
                            setSort("newest");
                          }}
                        />
                        <Tabs
                          className="evidence-workspace-tabs"
                          value={displayedEvidenceTab}
                          onValueChange={(v) => {
                            setEvidenceTab(v);
                            setSearch("");
                            setFilter("all");
                            setRequestFilter("all");
                            setFacet("all");
                            setSort("newest");
                          }}
                        >
                          <TabsList aria-label="Evidence workspace">
                            <TabsTrigger value="files">
                              Files{" "}
                              <span className="view-count">
                                {e.artifacts.length}
                              </span>
                            </TabsTrigger>
                            {!viewer && (
                              <TabsTrigger value="requests">
                                Requests{" "}
                                <span className="view-count">
                                  {(e.evidenceRequests ?? []).length}
                                </span>
                              </TabsTrigger>
                            )}
                          </TabsList>
                          <TabsContent value="files">
                            <section className="panel evidence-files-panel">
                              <DatabaseToolbar
                                label="Evidence"
                                views={[
                                  { value: "all", label: "All evidence" },
                                  {
                                    value: "unverified",
                                    label: "Awaiting acceptance",
                                  },
                                  { value: "accepted", label: "Accepted" },
                                  {
                                    value: "quarantined",
                                    label: "Quarantined",
                                  },
                                ]}
                                value={filter}
                                onView={setFilter}
                                search={search}
                                onSearch={setSearch}
                                count={evidenceRows.length}
                              >
                                {registerControls("Category", categories, [
                                  { value: "newest", label: "Newest first" },
                                  { value: "name_asc", label: "Name A–Z" },
                                  { value: "category", label: "Category" },
                                ])}
                                {contextualNew()}
                              </DatabaseToolbar>
                              {evidenceRows.length ? (
                                <EvidenceRegister
                                  artifacts={evidenceRows}
                                  tenantId={data.tenantId}
                                  engagementId={e.id}
                                  role={role}
                                  resolve={resolveName}
                                  onOpen={(a) => viewDetail(a.name, a)}
                                />
                              ) : (
                                <div className="empty-state">
                                  <Database size={26} aria-hidden="true" />
                                  <h3>
                                    {e.artifacts.length
                                      ? "No matching evidence"
                                      : "No evidence yet"}
                                  </h3>
                                  <p>
                                    {e.artifacts.length
                                      ? "No files match this view, category and search."
                                      : "Add the files supporting this engagement."}
                                  </p>
                                  {e.artifacts.length ? (
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        setSearch("");
                                        setFilter("all");
                                        setFacet("all");
                                      }}
                                    >
                                      Clear filters
                                    </Button>
                                  ) : (
                                    writer && (
                                      <Button
                                        disabled={busy}
                                        onClick={() =>
                                          open("upload", {
                                            category: "Dataset",
                                            visibility: "internal",
                                            handlingBasis: "synthetic",
                                          })
                                        }
                                      >
                                        <Upload size={14} aria-hidden="true" />
                                        Upload evidence
                                      </Button>
                                    )
                                  )}
                                </div>
                              )}
                            </section>
                          </TabsContent>
                          {!viewer && (
                            <TabsContent value="requests">
                              <Suspense fallback={panelFallback}>
                                <EvidenceRequests
                                  engagement={e}
                                  role={role}
                                  busy={busy}
                                  view={requestFilter}
                                  onView={setRequestFilter}
                                  search={search}
                                  onSearch={setSearch}
                                  onOpen={(r) => viewDetail(r.subject, r)}
                                  onNew={() => requestForm("request")}
                                />
                                <RequestAccess
                                  data={data}
                                  busy={busy}
                                  act={act}
                                  onEditing={setLabEditing}
                                />
                              </Suspense>
                            </TabsContent>
                          )}
                        </Tabs>
                      </>
                    )}
                    {view === "Assurance workbench" && !viewer && (
                      <Suspense fallback={panelFallback}>
                        <AssuranceWorkbench
                          location={workbenchQuery}
                          onLocation={(q) =>
                            setWorkbenchQuery(normalizeWorkbenchQuery(q))
                          }
                          onEvidence={(id) => {
                            const artifact = e.artifacts.find(
                              (a) => a.id === id,
                            );
                            if (artifact)
                              guarded(() =>
                                viewDetail(artifact.name, artifact),
                              );
                          }}
                          initialProcedure={procedureContext}
                          onHosted={(id, cardId) =>
                            navigate("Testing lab", {}, () => {
                              setProcedureContext(id);
                              setTestingDatasetCard(cardId);
                            })
                          }
                          key={data.tenantId + ":" + e.id}
                          data={data}
                          onRefresh={() => load(data.tenantId, e.id)}
                          onPaper={(id) => {
                            const p = e.papers.find((p) => p.id === id);
                            if (p) openPaper(p);
                          }}
                          onNavigate={navigate}
                          onEditing={setLabEditing}
                        />
                      </Suspense>
                    )}
                    {view === "Testing lab" && (
                      <Suspense fallback={panelFallback}>
                        <TestingLab
                          initialProcedure={procedureContext}
                          datasetCardRecordId={testingDatasetCard}
                          onRefresh={() => load(data.tenantId, e.id)}
                          key={data.tenantId + ":" + e.id}
                          engagement={e}
                          tenantId={data.tenantId}
                          role={role}
                          busy={busy}
                          view={labView}
                          onView={setLabView}
                          onEditorOpen={setLabEditing}
                          act={act}
                          onPaper={openPaper}
                          resolve={resolveName}
                          onEvidence={() => navigate("Evidence vault")}
                        />
                      </Suspense>
                    )}
                    {view === "Findings" && (
                      <section className="panel">
                        <DatabaseToolbar
                          label="Findings"
                          views={[
                            { value: "all", label: "All findings" },
                            { value: "open", label: "Open" },
                            { value: "high", label: "High risk" },
                            { value: "closed", label: "Closed" },
                          ]}
                          value={filter}
                          onView={setFilter}
                          search={search}
                          onSearch={setSearch}
                          count={findingRows.length}
                        >
                          {registerControls(
                            "Severity",
                            ["Critical", "High", "Medium", "Low"],
                            [
                              { value: "risk", label: "Highest risk" },
                              { value: "due", label: "Earliest due date" },
                              { value: "name_asc", label: "Name A–Z" },
                            ],
                          )}
                          {contextualNew()}
                        </DatabaseToolbar>
                        {findingRows.length ? (
                          <FindingRegister
                            findings={findingRows}
                            artifacts={e.artifacts}
                            role={role}
                            userId={data.identity.id}
                            busy={busy}
                            onOpen={(f) => viewDetail(f.title, f)}
                            onRemediate={remediateFinding}
                          />
                        ) : (
                          <Empty
                            icon={AlertTriangle}
                            title={
                              e.findings.length
                                ? "No matching findings"
                                : "No findings recorded"
                            }
                            text={
                              e.findings.length
                                ? "Change the view or clear the search."
                                : "Add a finding to track its risk and remediation."
                            }
                          />
                        )}
                      </section>
                    )}
                    {view === "Regulatory mapping" && (
                      <>
                        <div className="split-grid">
                          <section className="panel">
                            <div className="panel-head">
                              <h2>Risk classification</h2>
                              <Badge value={e.classification.status} />
                            </div>
                            <div className="content-pad body-copy">
                              <h3>{classify(e.classification)}</h3>
                              <p>
                                {e.classification.rationale ||
                                  "Complete the guided assessment and record your legal classification rationale."}
                              </p>
                              <p>
                                <b>Operator:</b> {e.classification.operatorRole}
                                <br />
                                <b>Route:</b> {e.classification.annexRoute}
                                <br />
                                <b>Transparency duties:</b>{" "}
                                {e.classification.transparency
                                  ? "Flagged separately"
                                  : "Not flagged"}
                                <br />
                                <b>Profiling:</b>{" "}
                                {e.classification.profiling
                                  ? "Flagged; high-risk assessment required"
                                  : "Not flagged"}
                              </p>
                              <p>
                                <b>Intended purpose:</b>{" "}
                                {e.classification.intendedPurpose ||
                                  "Unrecorded"}
                              </p>
                              {reviewer &&
                                e.classification.status === "provisional" && (
                                  <Button
                                    disabled={busy}
                                    onClick={() =>
                                      safeAct("approveClassification", {})
                                    }
                                  >
                                    Approve independently
                                  </Button>
                                )}
                            </div>
                          </section>
                          <section className="panel">
                            <div className="panel-head">
                              <h2>Regulatory basis</h2>
                              <BookOpen size={20} />
                            </div>
                            <div className="content-pad body-copy">
                              <details className="regulatory-detail">
                                <summary>
                                  Applicable dates and legal sources
                                </summary>
                                <p>
                                  Current snapshot: <b>02024R1689-20260727</b>,
                                  researched 5 October 2026.
                                </p>
                                <p>
                                  Chapter III Sections 1–3, except Article 6(5):
                                  Annex III applies from <b>2 December 2027</b>;
                                  Annex I from <b>2 August 2028</b>. Assess each
                                  provision and transitional rule.
                                </p>
                                <p>
                                  Articles 4, 5, 26, 27, 50, 72 and 73, quality
                                  management, conformity routes and sector rules
                                  have separate applicability checks in the work
                                  program.
                                </p>
                                <a
                                  className="source-link"
                                  href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Authentic amendment (EU) 2026/1744
                                </a>
                                <p className="subtle">
                                  Annex I Section B requires sector-specific
                                  legal review. Sensitive-category bias
                                  processing under Article 4a requires
                                  assessment of access restrictions and
                                  data-protection law.
                                </p>
                              </details>
                            </div>
                          </section>
                        </div>
                        <section className="panel">
                          <div className="panel-head">
                            <h2>Article-to-evidence mapping</h2>
                          </div>
                          {controls.map((c) => (
                            <div className="control-row" key={c.article}>
                              <span className="article">{c.article}</span>
                              <div>
                                <b>{c.title}</b>
                                <p className="control-result">
                                  {c.papers
                                    .map((p) => p.templateId)
                                    .join(" · ") || "No required papers"}
                                </p>
                                <Progress
                                  value={c.coverage}
                                  aria-label={c.title + " signed coverage"}
                                />
                              </div>
                              <Badge
                                value={
                                  c.coverage === 100
                                    ? "signed"
                                    : "not evaluated"
                                }
                              />
                            </div>
                          ))}
                        </section>
                      </>
                    )}
                    {view === "Reports & sign-off" && (
                      <Suspense fallback={panelFallback}>
                        <ReportWorkspace
                          key={e.id}
                          engagement={e}
                          tenantId={data.tenantId}
                          role={role}
                          userId={data.identity.id}
                          busy={busy}
                          opinion={reportOpinion}
                          onOpinion={setReportOpinion}
                          onGate={openGate}
                          onCreate={(kind) =>
                            open("report", { kind, opinion: reportOpinion })
                          }
                          onOpen={(r) =>
                            viewDetail(
                              (r.kind === "final"
                                ? "Final report"
                                : "Draft report") +
                                " · " +
                                new Date(r.createdAt).toLocaleDateString(),
                              r,
                            )
                          }
                          section={reportSection}
                          onSection={setReportSection}
                          query={registerQuery}
                          onQuery={(patch) => {
                            if (patch.view !== undefined) setFilter(patch.view);
                            if (patch.search !== undefined)
                              setSearch(patch.search);
                            if (patch.facet !== undefined)
                              setFacet(patch.facet);
                            if (patch.sort !== undefined) setSort(patch.sort);
                          }}
                          onReset={clearRegister}
                        />
                      </Suspense>
                    )}
                    {view === "Methodology" && (
                      <Tabs defaultValue="templates">
                        <TabsList>
                          <TabsTrigger value="templates">Templates</TabsTrigger>
                          <TabsTrigger value="trail">Audit history</TabsTrigger>
                        </TabsList>
                        <TabsContent value="templates">
                          <section className="panel">
                            <DatabaseToolbar
                              label="Templates"
                              views={[
                                { value: "all", label: "All templates" },
                                {
                                  value: "working_paper",
                                  label: "Working papers",
                                },
                                { value: "memo", label: "Memos" },
                              ]}
                              value={filter}
                              onView={setFilter}
                              search={search}
                              onSearch={setSearch}
                              count={templateRows.length}
                            >
                              {registerControls(
                                "Stage",
                                [
                                  ...new Set(
                                    data.catalog?.items.map((t) => t.stage) ??
                                      [],
                                  ),
                                ],
                                [
                                  {
                                    value: "program",
                                    label: "Reference order",
                                  },
                                  { value: "name_asc", label: "Name A–Z" },
                                ],
                              )}
                            </DatabaseToolbar>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Reference</TableHead>
                                  <TableHead>Template</TableHead>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Stage</TableHead>
                                  <TableHead />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {templateRows.map((t) => (
                                  <TableRow key={t.id}>
                                    <TableCell className="mono">
                                      {t.id}
                                    </TableCell>
                                    <TableCell>
                                      <button
                                        className="paper-link"
                                        onClick={() => viewDetail(t.title, t)}
                                      >
                                        {t.title}
                                      </button>
                                    </TableCell>
                                    <TableCell>
                                      {t.kind === "memo"
                                        ? "Memo"
                                        : "Working paper"}
                                    </TableCell>
                                    <TableCell>{t.stage}</TableCell>
                                    <TableCell>
                                      {writer && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled={busy}
                                          onClick={() => {
                                            void act("createPaper", {
                                              templateId: t.id,
                                            })
                                              .then((result) => {
                                                const paper =
                                                  result.engagement.papers.find(
                                                    (p) =>
                                                      p.id ===
                                                      result.details?.paperId,
                                                  );
                                                if (paper) {
                                                  navigate(
                                                    "Working papers",
                                                    {
                                                      search: "",
                                                      filter: "all",
                                                      facet: "all",
                                                    },
                                                    () => setSort("program"),
                                                  );
                                                  openPaper(paper);
                                                }
                                              })
                                              .catch(() => {});
                                          }}
                                        >
                                          Use template
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </section>
                        </TabsContent>
                        <TabsContent value="trail">
                          <section className="panel">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Time</TableHead>
                                  <TableHead>Action</TableHead>
                                  <TableHead>Person</TableHead>
                                  <TableHead />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {data.events.map((event) => (
                                  <TableRow key={event.id}>
                                    <TableCell>
                                      {new Date(
                                        event.created_at,
                                      ).toLocaleString()}
                                    </TableCell>
                                    <TableCell>
                                      {humanLabel(event.action)}
                                    </TableCell>
                                    <TableCell>
                                      {resolveName(event.actor)}
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          viewDetail("Audit event", event)
                                        }
                                      >
                                        Details
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {!data.events.length && (
                              <div className="empty-state">
                                <History size={28} />
                                <h3>No audit activity yet</h3>
                              </div>
                            )}
                          </section>
                        </TabsContent>
                      </Tabs>
                    )}
                  </>
                ) : (
                  <Empty
                    icon={Building2}
                    title="No engagement is assigned"
                    text="Ask your Lead Auditor to assign client access."
                  />
                )}
              </>
            )
          )}
        </main>
      </SidebarInset>

      {data && (
        <MemberOnboarding
          open={onboarding}
          onClose={() => setOnboarding(false)}
          data={data!}
          busy={busy}
          manage={manage}
          act={act}
          onEditing={setLabEditing}
        />
      )}
      <PaperEditor
        onTargetChange={setPaperTarget}
        error={error}
        onEvidence={(id) => {
          const artifact = e?.artifacts.find((a) => a.id === id);
          if (artifact)
            guarded(() => {
              setPaperId(null);
              setPaperDraft(null);
              setHasPendingComment(false);
              viewDetail(artifact.name, artifact);
            });
        }}
        tenantId={data?.tenantId ?? ""}
        initialTarget={paperTarget}
        previous={paperSequence[paperPosition - 1]}
        next={paperPosition >= 0 ? paperSequence[paperPosition + 1] : undefined}
        position={
          paperPosition >= 0
            ? paperPosition + 1 + " / " + paperSequence.length
            : undefined
        }
        onAdjacent={(p) => openPaper(p)}
        onVault={() => {
          if (navigate("Evidence vault") === "opened") setEvidenceTab("files");
        }}
        onRequest={() => paperDraft && requestForPaper(paperDraft)}
        onRequestRecord={(r) => {
          guarded(() => {
            setPaperId(null);
            setPaperDraft(null);
            setHasPendingComment(false);
            viewDetail(r.subject, r);
          });
        }}
        commentReset={commentReset}
        draft={paperDraft}
        saved={selectedPaper}
        setDraft={setPaperDraft}
        engagement={e}
        role={role}
        userId={data?.identity.id ?? ""}
        busy={busy}
        dirty={paperDirty}
        onCommentDraftChange={setHasPendingComment}
        onClose={closePaper}
        onAction={paperAction}
        onComment={(text) => act("comment", { paperId: paperId!, text })}
        onResponse={(commentId, text) =>
          act("respondComment", { paperId: paperId!, commentId, text })
        }
        onProcedure={openPaperProcedure}
        onDetail={viewDetail}
        onExport={() =>
          download(
            (selectedPaper?.templateId ?? "paper") +
              "-" +
              selectedPaper?.revision +
              ".json",
            selectedPaper,
          )
        }
        resolve={resolveName}
      />
      {paperConflict && (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>This paper has a newer revision</DialogTitle>
              <DialogDescription>
                Your local changes are preserved. Export them before reloading
                the saved revision.
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => download("unsaved-paper.json", paperDraft)}
            >
              Export local changes
            </Button>
            <Button
              onClick={() => {
                dirtyRef.current = false;
                const draft = structuredClone(selectedPaper!);
                draft.body.results = readableResults(draft.body.results ?? "");
                setPaperDraft(draft);
                setPaperConflict(false);
              }}
            >
              Load saved revision
            </Button>
          </DialogContent>
        </Dialog>
      )}
      <AlertDialog open={discardPaper} onOpenChange={setDiscardPaper}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasPendingComment
                ? "Your unsent comments or responses will be discarded. Saved revisions and recorded comments remain available."
                : "Your unsaved document changes will be discarded. The saved revision remains available."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                pendingNavigation.current = null;
              }}
            >
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dirtyRef.current = false;
                navigationDirtyRef.current = false;
                setHasPendingComment(false);
                setCommentReset((v) => v + 1);
                pendingNavigation.current?.();
                pendingNavigation.current = null;
                setDiscardPaper(false);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!modal}
        onOpenChange={(o) => {
          if (!o) closeModal();
        }}
      >
        {!!modal && (
          <DialogContent className="audit-dialog">
            <DialogHeader>
              <DialogTitle>
                {
                  {
                    paper: "New working paper or memo",
                    linkEvidence: "Link evidence to a paper",
                    client: "New client",
                    clientEdit: "Edit client",
                    engagement: "New engagement",
                    rename: "Engagement settings",
                    member: "Add member",
                    memberEdit: "Edit access",
                    memberRevoke: "Revoke practice access",
                    upload: "Upload evidence",
                    classification: "Guided regulatory classification",
                    finding: "Record audit finding",
                    findingEdit: "Remediation & retest",
                    report: "Create immutable report snapshot",
                    request: "Request evidence",
                    requestEdit: "Edit evidence request",
                    requestResponse: "Record received evidence",
                    requestAssess: "Assess evidence",
                    requestClose: "Record limitation / scope change",
                    requestReopen: "Reopen evidence request",
                  }[modal]
                }
              </DialogTitle>
              <DialogDescription className="sr-only">
                Complete the fields below.
              </DialogDescription>
            </DialogHeader>
            <form
              key={modal}
              ref={(form) => {
                modalFormRef.current = form;
                if (form && !modalBaselineRef.current)
                  modalBaselineRef.current = formFingerprint(
                    form,
                    choices,
                    checks,
                  );
              }}
              onSubmit={submit}
              onChange={() =>
                setModalDirty(
                  formFingerprint(modalFormRef.current, choices, checks) !==
                    modalBaselineRef.current,
                )
              }
              className="standard-form"
            >
              <fieldset disabled={busy} className="form-grid">
                {modal === "linkEvidence" && (
                  <>
                    <label>
                      Working paper
                      <Choice
                        label="Working paper"
                        value={choices.paperId ?? ""}
                        onChange={(v) => choice("paperId", v)}
                        values={
                          e?.papers
                            .filter(
                              (p) =>
                                p.status !== "signed" &&
                                (lead ||
                                  p.required ||
                                  p.body.conclusionStatus !== "not_applicable"),
                            )
                            .map((p) => ({
                              value: p.id,
                              label: p.templateId + " · " + p.title,
                            })) ?? []
                        }
                      />
                    </label>
                    <p className="subtle">
                      The link opens as an unsaved edit. Save a revision to keep
                      it.
                    </p>
                  </>
                )}
                {modal === "paper" && (
                  <label>
                    Methodology template
                    <Choice
                      value={choices.templateId ?? ""}
                      onChange={(v) => choice("templateId", v)}
                      label="Template"
                      values={
                        data?.catalog?.items.map((t) => ({
                          value: t.id,
                          label: t.id + " · " + t.title,
                        })) ?? []
                      }
                    />
                  </label>
                )}
                {(modal === "client" || modal === "clientEdit") && (
                  <>
                    <label>
                      Client name
                      <Input
                        name="name"
                        defaultValue={choices.name}
                        required
                        maxLength={300}
                      />
                    </label>
                    <label>
                      Sector
                      <Input
                        name="sector"
                        defaultValue={choices.sector}
                        required
                        maxLength={300}
                      />
                    </label>
                  </>
                )}
                {modal === "engagement" && (
                  <>
                    <label>
                      Client
                      <Choice
                        label="Client"
                        value={choices.clientId ?? ""}
                        values={
                          data?.clients.map((c) => ({
                            value: c.id,
                            label: c.name,
                          })) ?? []
                        }
                        onChange={(v) => choice("clientId", v)}
                      />
                    </label>
                    <label>
                      Engagement title
                      <Input name="title" required maxLength={300} />
                    </label>
                  </>
                )}
                {modal === "rename" && (
                  <>
                    <label>
                      Title
                      <Input
                        name="title"
                        defaultValue={e?.title}
                        required
                        maxLength={300}
                      />
                    </label>
                    <label>
                      Target completion
                      <Input
                        name="dueDate"
                        type="date"
                        defaultValue={e?.dueDate}
                      />
                    </label>
                  </>
                )}
                {(modal === "member" || modal === "memberEdit") && (
                  <>
                    {modal === "member" && (
                      <label>
                        Account ID
                        <Input
                          name="userId"
                          defaultValue={choices.userId}
                          readOnly={!!choices.userId}
                          required
                          maxLength={300}
                        />
                        <small className="subtle">
                          Ask your colleague to copy this from Members & access
                          after signing in.
                        </small>
                      </label>
                    )}
                    <label>
                      Name
                      <Input
                        name="displayName"
                        defaultValue={choices.displayName}
                        required
                        maxLength={300}
                      />
                    </label>
                    <label>
                      Role
                      <Choice
                        label="Role"
                        value={choices.role}
                        values={roles}
                        onChange={(v) => choice("role", v)}
                      />
                    </label>
                    {["Client Viewer", "Client Contributor"].includes(
                      choices.role,
                    ) ? (
                      <label>
                        Client
                        <Choice
                          label="Client"
                          value={choices.clientId ?? ""}
                          values={
                            data?.clients.map((c) => ({
                              value: c.id,
                              label: c.name,
                            })) ?? []
                          }
                          onChange={(v) => choice("clientId", v)}
                        />
                      </label>
                    ) : (
                      <p className="subtle">
                        Assign this member to specific engagements in Assurance
                        workbench → Team & runtime.
                      </p>
                    )}
                    <p className="subtle">
                      Site sharing must also allow this person to open the
                      platform.
                    </p>
                  </>
                )}
                {modal === "memberRevoke" && (
                  <p>
                    Revoke <b>{choices.displayName}</b>&apos;s access to this
                    practice? Their prior audit contributions and approvals will
                    remain in the history.
                  </p>
                )}
                {modal === "upload" && (
                  <>
                    <label>
                      Evidence file
                      <Input name="file" type="file" required />
                    </label>
                    <div className="field-grid">
                      <label>
                        Category
                        <Choice
                          label="Category"
                          value={choices.category}
                          values={categories}
                          onChange={(v) => choice("category", v)}
                        />
                      </label>
                      <label>
                        Visibility
                        <Choice
                          label="Visibility"
                          value={choices.visibility}
                          values={[
                            { value: "internal", label: "Internal audit team" },
                            {
                              value: "client",
                              label: "Client release eligible",
                            },
                          ]}
                          onChange={(v) => choice("visibility", v)}
                        />
                      </label>
                    </div>
                    <label>
                      Evidence handling basis
                      <Choice
                        label="Handling basis"
                        value={choices.handlingBasis ?? ""}
                        values={[
                          {
                            value: "synthetic",
                            label: "Synthetic / non-personal evidence",
                          },
                          {
                            value: "anonymized",
                            label: "Reviewed anonymous evidence",
                          },
                          {
                            value: "reviewed",
                            label: "Independently reviewed processing route",
                          },
                        ]}
                        onChange={(v) => choice("handlingBasis", v)}
                      />
                    </label>
                    {choices.handlingBasis === "reviewed" && (
                      <label>
                        Accepted privacy / governance decision
                        <Choice
                          label="Privacy evidence"
                          value={choices.governanceArtifactId ?? ""}
                          values={
                            e?.artifacts
                              .filter(
                                (a) =>
                                  a.category === "Governance" &&
                                  a.status === "accepted",
                              )
                              .map((a) => ({ value: a.id, label: a.name })) ??
                            []
                          }
                          onChange={(v) => choice("governanceArtifactId", v)}
                        />
                      </label>
                    )}
                    <div className="note">
                      Limit 50 MB. Where Article 4a restricts access by other
                      parties, process sensitive-category records in the
                      client&apos;s controlled environment and upload permitted
                      aggregate evidence. Review privacy and confidentiality
                      before upload.
                    </div>
                  </>
                )}
                {modal === "classification" && (
                  <>
                    <label>
                      Intended purpose & deployment context
                      <Textarea
                        name="intendedPurpose"
                        defaultValue={e?.classification.intendedPurpose}
                        required
                      />
                    </label>
                    <label>
                      Operator role
                      <Choice
                        label="Operator role"
                        value={choices.operatorRole}
                        values={[
                          "Provider",
                          "Deployer",
                          "Provider and deployer",
                          "Importer / distributor",
                        ]}
                        onChange={(v) => choice("operatorRole", v)}
                      />
                    </label>
                    {[
                      [
                        "prohibited",
                        "Article 5 prohibited practice identified",
                      ],
                      [
                        "highRisk",
                        "High-risk route identified under Article 6",
                      ],
                      [
                        "transparency",
                        "Article 50 transparency duties apply separately",
                      ],
                      [
                        "profiling",
                        "Annex III use involves profiling of natural persons",
                      ],
                    ].map(([key, label]) => (
                      <label className="check-row" key={key}>
                        <Checkbox
                          checked={!!checks[key]}
                          onCheckedChange={(v) =>
                            setChecks((c) => ({ ...c, [key]: !!v }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <label>
                      Classification route
                      <Choice
                        label="Annex route"
                        value={choices.annexRoute}
                        values={[
                          "Unassessed",
                          "Annex III — sensitive use case",
                          "Annex I Section A — regulated product",
                          "Annex I Section B — sector-specific review",
                          "Article 6(3) exception assessment",
                          "Article 50 only",
                          "Outside high-risk scope",
                        ]}
                        onChange={(v) => choice("annexRoute", v)}
                      />
                    </label>
                    <label>
                      Legal rationale, facts, exceptions & transition analysis
                      <Textarea
                        name="rationale"
                        defaultValue={e?.classification.rationale}
                        required
                      />
                    </label>
                    <p className="subtle">
                      This guided record supports legal review. It does not
                      automatically determine the applicability of every
                      prohibition, exception or sector regime.
                    </p>
                  </>
                )}
                {modal === "finding" && (
                  <NewFindingForm choices={choices} onChoice={choice} />
                )}
                {modal === "findingEdit" && finding && (
                  <RemediationForm
                    finding={finding}
                    artifacts={e?.artifacts ?? []}
                    choices={choices}
                    onChoice={choice}
                    checks={checks}
                    onCheck={(id, value) =>
                      setChecks((c) => ({ ...c, [id]: value }))
                    }
                  />
                )}
                {modal.startsWith("request") && e && (
                  <EvidenceRequestForm
                    mode={modal}
                    request={e.evidenceRequests?.find(
                      (r) => r.id === choices.requestId,
                    )}
                    engagement={e}
                    choices={choices}
                    checks={checks}
                    onChoice={choice}
                    onCheck={(key, value) =>
                      setChecks((c) => ({ ...c, [key]: value }))
                    }
                  />
                )}
                {modal === "report" && (
                  <>
                    <label>
                      Package type
                      <Choice
                        label="Package kind"
                        value={choices.kind}
                        values={[
                          { value: "draft", label: "Draft — review snapshot" },
                          {
                            value: "final",
                            label: "Final — subject to completion gates",
                          },
                        ]}
                        onChange={(v) => choice("kind", v)}
                      />
                    </label>
                    <label>
                      Scoped opinion
                      <Choice
                        label="Opinion"
                        value={choices.opinion}
                        values={[
                          "Readiness assessment",
                          "Qualified conclusion",
                          "Adverse conclusion",
                          "Unable to conclude",
                        ]}
                        onChange={(v) => choice("opinion", v)}
                      />
                    </label>
                    <label>
                      Executive summary, scope & limitations
                      <Textarea name="summary" required maxLength={5000} />
                    </label>
                    {e && (
                      <section className="report-form-readiness">
                        <h3>
                          {choices.kind === "final"
                            ? "Before final issuance"
                            : "Outstanding at capture"}{" "}
                          <span className="count-label">
                            {finalReportGates(e, choices.opinion).length}
                          </span>
                        </h3>
                        {choices.kind === "draft" && (
                          <p className="subtle">
                            A draft can capture the engagement while these
                            requirements remain open.
                          </p>
                        )}
                        <AuditGateList
                          compact
                          gates={finalReportGates(e, choices.opinion)}
                          engagement={e}
                          role={role}
                          userId={data!.identity.id}
                        />
                        {choices.kind === "final" &&
                          !!finalReportGates(e, choices.opinion).length && (
                            <p className="form-error">
                              Resolve these requirements, or select a draft
                              snapshot.
                            </p>
                          )}
                      </section>
                    )}
                    <p className="subtle">
                      The snapshot is fixed when created. A later report becomes
                      a new package with a new digest.
                    </p>
                  </>
                )}
                {modalError && (
                  <p
                    ref={modalErrorRef}
                    tabIndex={-1}
                    className="form-error"
                    role="alert"
                  >
                    {modalError}
                  </p>
                )}
                <div className="form-footer">
                  <span className={modalDirty ? "unsaved" : "subtle"}>
                    {modalDirty ? "Unsaved changes" : ""}
                  </span>
                  <div className="row-actions">
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        (modal === "linkEvidence" && !choices.paperId) ||
                        (modal === "report" &&
                          choices.kind === "final" &&
                          !!e &&
                          !!finalReportGates(e, choices.opinion).length)
                      }
                    >
                      {busy
                        ? "Saving…"
                        : modal === "linkEvidence"
                          ? "Open paper"
                          : modal === "upload"
                            ? "Upload for acceptance"
                            : modal === "memberRevoke"
                              ? "Revoke access"
                              : modal === "member"
                                ? "Add member"
                                : modal === "engagement"
                                  ? "Create engagement"
                                  : modal === "client"
                                    ? "Create client"
                                    : modal === "paper"
                                      ? "Create paper"
                                      : modal === "request"
                                        ? "Create request"
                                        : modal === "requestEdit"
                                          ? "Save request"
                                          : modal === "requestResponse"
                                            ? "Record receipt"
                                            : modal === "requestAssess"
                                              ? "Record assessment"
                                              : modal === "requestClose"
                                                ? "Record disposition & draft memo"
                                                : modal === "requestReopen"
                                                  ? "Reopen request"
                                                  : modal === "report"
                                                    ? "Create snapshot"
                                                    : modal === "finding"
                                                      ? "Record finding"
                                                      : modal === "findingEdit"
                                                        ? "Save remediation"
                                                        : modal ===
                                                            "classification"
                                                          ? "Save classification"
                                                          : modal ===
                                                              "memberEdit"
                                                            ? "Update access"
                                                            : modal ===
                                                                "clientEdit"
                                                              ? "Save client details"
                                                              : modal ===
                                                                  "rename"
                                                                ? "Save engagement"
                                                                : "Save changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={closeModal}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </fieldset>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <AlertDialog open={discardModal} onOpenChange={setDiscardModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this form?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved entries will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setModalDirty(false);
                modalDirtyRef.current = false;
                setDiscardModal(false);
                setModal("");
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o && !labEditing) setDetail(null);
        }}
      >
        {!!detail && (
          <SheetContent
            side="right"
            className={"record-sheet " + (detailExpanded ? "expanded" : "")}
          >
            <div className="peek-bar">
              <span>Record</span>
              <Button
                className="sheet-expand-control"
                variant="ghost"
                size="sm"
                onClick={() => setDetailExpanded((v) => !v)}
              >
                {detailExpanded ? "Side peek" : "Expand"}
              </Button>
            </div>
            <div className="sheet-scroll">
              <div className="document-page">
                <SheetTitle className="document-title">
                  {detail?.title}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Record details
                </SheetDescription>{" "}
                {e &&
                data &&
                detail?.value &&
                typeof detail.value === "object" &&
                "category" in detail.value &&
                "sha256" in detail.value ? (
                  <EvidenceDetails
                    artifact={detail.value as import("@/lib/domain").Artifact}
                    engagement={e}
                    tenantId={data.tenantId}
                    role={role}
                    busy={busy}
                    resolve={resolveName}
                    onAccept={() =>
                      safeAct("acceptEvidence", {
                        artifactId: (
                          detail.value as import("@/lib/domain").Artifact
                        ).id,
                      })
                    }
                    onPaper={(p) => {
                      setDetail(null);
                      openPaper(p);
                    }}
                    onModel={(m) => viewDetail(m.name, m)}
                    onRun={(r) => viewDetail("Diagnostic run", r)}
                    onFinding={(f) => viewDetail(f.title, f)}
                    onRequest={(r) => viewDetail(r.subject, r)}
                    onLink={() =>
                      open("linkEvidence", {
                        artifactId: (
                          detail.value as import("@/lib/domain").Artifact
                        ).id,
                      })
                    }
                  />
                ) : e &&
                  liveDetail &&
                  typeof liveDetail === "object" &&
                  "responsibleParty" in liveDetail ? (
                  <Suspense fallback={panelFallback}>
                    <EvidenceRequestDetails
                      key={
                        data?.tenantId +
                        ":" +
                        e.id +
                        ":" +
                        (liveDetail as EvidenceRequest).id
                      }
                      request={liveDetail as EvidenceRequest}
                      engagement={e}
                      role={role}
                      busy={busy}
                      resolve={resolveName}
                      onForm={requestForm}
                      onPaper={(p) => {
                        setDetail(null);
                        openPaper(p);
                      }}
                      onArtifact={(id) => {
                        const artifact = e.artifacts.find((a) => a.id === id);
                        if (artifact) viewDetail(artifact.name, artifact);
                      }}
                    />
                  </Suspense>
                ) : (
                  <RecordDetails
                    findingReview={
                      !viewer &&
                      e &&
                      !!liveDetail &&
                      typeof liveDetail === "object" &&
                      "riskScore" in liveDetail ? (
                        <Suspense fallback={null}>
                          <FindingAssurance
                            finding={liveDetail as Finding}
                            engagement={e}
                            role={role}
                            userId={data?.identity.id ?? ""}
                            busy={busy}
                            act={act}
                            onEditing={setLabEditing}
                          />
                        </Suspense>
                      ) : undefined
                    }
                    value={liveDetail}
                    engagement={e}
                    role={role}
                    userId={data?.identity.id ?? ""}
                    busy={busy}
                    onRemediate={remediateFinding}
                    onRetest={(id) => {
                      const f = e?.findings.find((f) => f.id === id);
                      if (f) viewDetail(f.title, f);
                    }}
                    onPaper={(p) => {
                      setDetail(null);
                      openPaper(p);
                    }}
                    resolve={resolveName}
                  />
                )}
                <div className="report-package-administration">
                  {e &&
                    data &&
                    !!liveDetail &&
                    typeof liveDetail === "object" &&
                    "snapshot" in liveDetail && (
                      <PackageIntegrity
                        tenantId={data.tenantId}
                        engagementId={e.id}
                        reportId={(liveDetail as Report).id}
                        onRefresh={() => load(data.tenantId, e.id)}
                      />
                    )}
                  {!viewer &&
                    !!liveDetail &&
                    typeof liveDetail === "object" &&
                    "clientSnapshot" in liveDetail && (
                      <Suspense fallback={null}>
                        <ReportRelease
                          reports={e?.reports ?? []}
                          report={liveDetail as Report}
                          role={role}
                          userId={data?.identity.id ?? ""}
                          busy={busy}
                          act={act}
                          onEditing={setLabEditing}
                        />
                      </Suspense>
                    )}
                </div>
                <details className="provenance">
                  <summary>Export record</summary>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      download(
                        "audit-record.json",
                        detail?.value &&
                          typeof detail.value === "object" &&
                          "category" in detail.value &&
                          "id" in detail.value
                          ? (e?.artifacts.find(
                              (a) =>
                                a.id === (detail.value as { id: string }).id,
                            ) ?? detail.value)
                          : liveDetail,
                      )
                    }
                  >
                    <Download size={14} /> Export JSON
                  </Button>
                </details>
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>
      {data && (
        <EngagementSwitcher
          data={data}
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          onSelect={openEngagement}
        />
      )}
      {data && (
        <WorkspaceSearch
          data={data}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={searchSelect}
        />
      )}
    </SidebarProvider>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function ClientOverview({
  engagement: e,
  onView,
}: {
  engagement: Engagement;
  onView: (view: string) => void;
}) {
  return (
    <>
      <div className="stat-grid client-stat-grid">
        {[
          ["Released reports", e.reports.length],
          [
            "Shared findings",
            e.findings.filter((f) => f.status !== "closed").length,
          ],
          ["Accepted evidence", e.artifacts.length],
        ].map(([label, count]) => (
          <section className="stat" key={label}>
            <p>{label}</p>
            <strong>{count}</strong>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Engagement records</h2>
        </div>
        {[
          ["Reports", "Reports & sign-off"],
          ["Findings & remediation", "Findings"],
          ["Evidence", "Evidence vault"],
        ].map(([title, view]) => (
          <button
            className="attention-row"
            key={view}
            onClick={() => onView(view)}
          >
            <span>{title}</span>
            <span>View</span>
          </button>
        ))}
      </section>
    </>
  );
}
