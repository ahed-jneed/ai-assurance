"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { RefreshCw } from "lucide-react";
import { can, canBeAssigned } from "@/lib/permissions";
import { errorMessage, postJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import type { AssuranceRecord } from "@/lib/assurance-core";
import { refreshAfterMutation } from "@/lib/assurance-query";
import {
  workbenchSections,
  type WorkbenchQuery,
} from "@/lib/workbench-presentation";
import {
  RecordRegister,
  useRecordContext,
  type SearchScope,
} from "../assurance-record-search";
import { recordTitle } from "../assurance-register";
import { packFeatures, type WorkspaceData } from "../workspace-types";
import { AccessSection } from "./access-section";
import { AssistantSection } from "./assistant-section";
import { EvidenceSection } from "./evidence-section";
import { ExecutionSection } from "./execution-section";
import { workbenchFields } from "./form-config";
import { FormDialog } from "./form-dialog";
import { ImpactSection } from "./impact-section";
import { RecordDialog } from "./record-dialog";
import { RecordReview } from "./record-review";
import { ReviewQueue } from "./review-queue";
import { SamplingSection } from "./sampling-section";
import { downloadPacket, submitValues } from "./submit-values";
import { SystemsSection } from "./systems-section";
import { TokenDialog } from "./token-dialog";
import { jobName, predictionOptionLabel, type ActResult } from "./types";
import { useWorkbenchData } from "./use-workbench-data";
import { useWorkbenchForm } from "./use-workbench-form";
import { RecordFilters, WorkbenchBar } from "./workbench-bar";

export function AssuranceWorkbench({
  data,
  onRefresh,
  onPaper,
  onNavigate,
  onEditing,
  onHosted,
  initialProcedure,
  location,
  onLocation,
  onEvidence,
}: {
  location: WorkbenchQuery;
  onLocation: (q: WorkbenchQuery) => void;
  onEvidence: (id: string) => void;
  onHosted: (procedureId: string, cardId: string) => void;
  initialProcedure?: string;
  data: WorkspaceData;
  onRefresh: () => Promise<unknown>;
  onPaper: (id: string) => void;
  onNavigate: (s: string) => void;
  onEditing: (v: boolean) => void;
}) {
  const e = data.engagement!,
    writer = can(data.identity.role, "registerSystem"),
    lead = can(data.identity.role, "setAccess"),
    reviewer = can(data.identity.role, "reviewAssertion"),
    // Obligation-subitem assessments exist only on packs that switch them on
    // (docs/design/criteria-model.md section 7.1); other packs take their
    // assertion criteria from the pack's requirements. The subitems are those
    // of the pinned AI Act framework, served by GET /api/workspace.
    obligations = packFeatures(data).obligationAssessments
      ? data.criteria?.obligations
      : undefined,
    obligationsOn = !!obligations;

  const query = location.search,
    reviewFilter = location.review,
    tab = location.section;
  const setQuery = (search: string) => onLocation({ ...location, search }),
    setReviewFilter = (review: string) => onLocation({ ...location, review });
  const [detailSection, setDetailSection] = useState<"overview" | "review">(
    "overview",
  );
  const formState = useWorkbenchForm(),
    { form, setForm } = formState;

  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    // The record last opened from a register, until its context has loaded.
    [opened, setOpened] = useState<AssuranceRecord | null>(null),
    // Records seen in pickers and details, by id: the titles of selected
    // records on other pages, and the kinds of selected briefing sources.
    // Records are immutable, so an entry never goes stale.
    [known, setKnown] = useState<ReadonlyMap<string, AssuranceRecord>>(
      () => new Map(),
    ),
    // Whether the review queue is listed (its pages load only when opened).
    [queueListed, setQueueListed] = useState(false),
    [dirty, setDirty] = useState(false),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [token, setToken] = useState<{ workerId: string; token: string } | null>(
      null,
    );

  const { snapshot, refreshing, loadError, loaded, load } = useWorkbenchData(
    { tenantId: data.tenantId, engagementId: e.id, version: e.version },
    obligationsOn,
  );

  useEffect(() => {
    const protect = (ev: BeforeUnloadEvent) => {
      if (dirty || busy) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);

  async function act(op: string, values: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const v = await postJson<ActResult>("/api/assurance", {
        tenantId: data.tenantId,
        engagementId: e.id,
        op,
        data: values,
      });
      await refreshAfterMutation(
        { tenantId: data.tenantId, engagementId: e.id },
        onRefresh,
      );
      return v;
    } catch (x) {
      setError(errorMessage(x, "Action could not be completed"));
      throw x;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    onEditing(dirty || busy);
    return () => onEditing(false);
  }, [dirty, busy, onEditing]);
  // A compiled draft paper opens once the action has settled (the effect
  // above has reported the workbench idle) and the refreshed engagement
  // holds it (#202). The compile records it before that render commits.
  const compiledPaper = useRef<string | null>(null);
  const compiled = useCallback((paperId: string) => {
    compiledPaper.current = paperId;
  }, []);
  useEffect(() => {
    const id = compiledPaper.current;
    if (!id || busy || !e.papers.some((p) => p.id === id)) return;
    compiledPaper.current = null;
    onPaper(id);
  }, [busy, e.papers, onPaper]);
  // Selecting another record clears the unsaved-review flag.
  const [dirtyRecord, setDirtyRecord] = useState(location.recordId);
  if (dirtyRecord !== location.recordId) {
    setDirtyRecord(location.recordId);
    setDirty(false);
  }

  const all = snapshot?.records ?? [],
    scope: SearchScope = { tenantId: data.tenantId, engagementId: e.id },
    // The open record with its reviews, successors and the records it names,
    // read by id; reloaded after each action.
    details = useRecordContext(scope, location.recordId, loaded),
    selected =
      details.context?.record ??
      (opened?.id === location.recordId ? opened : null) ??
      known.get(location.recordId) ??
      null,
    related = details.context
      ? [details.context.record, ...details.context.related]
      : selected
        ? [selected]
        : [],
    remember = (...records: AssuranceRecord[]) =>
      setKnown((map) => {
        if (records.every((r) => map.get(r.id) === r)) return map;
        const next = new Map(map);
        for (const r of records) next.set(r.id, r);
        return next;
      }),
    describeRecord = (id: string) => {
      const r = known.get(id) ?? related.find((x) => x.id === id);
      return r ? recordTitle(r) : id;
    },
    hasKind = (...kinds: string[]) =>
      kinds.some((k) => (snapshot?.kindCounts[k] ?? 0) > 0),
    queue = snapshot?.queue,
    kind = (k: string) => all.filter((r) => r.kind === k),
    options = (k: string) =>
      kind(k).map((r) => ({
        value: r.id,
        label:
          r.kind === "prediction"
            ? predictionOptionLabel(r, e)
            : (r.body.name ?? r.body.label ?? r.body.statement ?? r.id) +
              (r.body.version ? " · " + r.body.version : ""),
      })),
    artifacts = e.artifacts.filter((a) => a.status === "accepted"),
    artifactOptions = (category?: string) =>
      artifacts
        .filter((a) => !category || a.category === category)
        .map((a) => ({ value: a.id, label: a.name })),
    models = e.models.map((m) => ({
      value: m.id,
      label: m.name + " · " + m.version,
    })),
    profiles = (e.evaluationProfiles ?? []).map((p) => ({
      value: p.id,
      label: p.name + " · " + p.version,
    })),
    procedures =
      e.workflow?.procedures
        .filter(
          (p) =>
            p.selected && ["applicable", "readiness"].includes(p.applicability),
        )
        .map((p) => ({ value: p.id, label: p.templateId + " · " + p.title })) ??
      [];

  const fields = workbenchFields({
    engagement: e,
    obligations,
    requirements: data.criteria?.requirements,
    lead,
    artifactOptions,
    models,
    profiles,
    procedures,
    options,
    members: (snapshot?.eligibleMembers ?? data.people)
      .filter((p) => canBeAssigned(p.role, "engagementAccess"))
      .map((p) => ({
        value: p.user_id,
        label: p.display_name + " · " + p.role,
      })),
    workers: (snapshot?.workers ?? [])
      .filter((w) => w.active)
      .map((w) => ({ value: w.id, label: w.name })),
    activeJobs: (snapshot?.jobs ?? [])
      .filter((j) => ["queued", "running"].includes(j.state))
      .map((j) => ({
        value: j.id,
        label: jobName(j, e.workflow?.procedures ?? []) + " · " + j.id,
      })),
  });

  function open(
    op: string,
    previous: AssuranceRecord | null = null,
    defaults: Record<string, string> = {},
  ) {
    formState.start(op, previous, defaults);
    setDirty(false);
    setError("");
  }

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const submitted = submitValues(form, new FormData(ev.currentTarget), {
      ...formState,
      fields: fields[form],
      known,
      sourceIds,
    });
    if ("error" in submitted) {
      setError(submitted.error);
      return;
    }
    try {
      const result = await act(form, submitted.values);
      if (result.token)
        setToken({ workerId: result.workerId, token: result.token });
      if (result.packet) downloadPacket(result.packet, result.trust);
      if (result.record) {
        setDetailSection("overview");
        onLocation({ ...location, recordId: result.record.id });
      }
      setDirty(false);
      setForm("");
    } catch {}
  }

  const person = (id: string) =>
    id === data.identity.id
      ? data.identity.name
      : (data.people.find((p) => p.user_id === id)?.display_name ??
        "Practice member");

  const clearFilters = () =>
    onLocation({ ...location, search: "", review: "all" });
  const selectSection = (section: string) =>
    onLocation({ section, search: "", review: "all", recordId: "" });
  const setSelected = (
    record: AssuranceRecord | null,
    section: "overview" | "review" = "overview",
  ) => {
    if (busy || (dirty && !window.confirm("Discard unsaved review?"))) return;
    setDirty(false);
    setError("");
    setDetailSection(section);
    setOpened(record);
    onLocation({ ...location, recordId: record?.id ?? "" });
  };
  // A register of the records of `kinds` that match the search and review
  // filter, read from the server one page at a time.
  const list = (kinds: string[], empty: string, emptyAction?: ReactNode) => (
    <RecordRegister
      scope={scope}
      query={{ kinds, q: query, review: reviewFilter }}
      refreshKey={loaded}
      // The snapshot may be loading or stale while the register already
      // answers; until it settles, a filtered register without matches says
      // so (and offers to clear the filters) instead of calling it empty.
      hasRecords={refreshing || hasKind(...kinds)}
      onOpen={(r) => setSelected(r)}
      empty={empty}
      person={person}
      onReset={clearFilters}
      emptyAction={emptyAction}
    />
  );
  const hasDatasets = artifactOptions("Dataset").length > 0,
    canLinkPredictions =
      kind("system").length > 0 && models.length > 0 && hasDatasets;
  const openLinkedSource = (action: () => void) => {
    if (dirty || busy) return;
    setSelected(null);
    action();
  };
  const closeRecord = () => onLocation({ ...location, recordId: "" });

  return (
    <div className="assurance-workbench">
      <WorkbenchBar
        tab={tab}
        onSection={selectSection}
        hasPanel={!!snapshot}
        refreshDisabled={busy || refreshing}
        refreshing={refreshing}
        onRefresh={() => void load()}
      />
      {queue && (queue.awaiting > 0 || queue.returned > 0) && (
        <ReviewQueue
          queue={queue}
          scope={scope}
          refreshKey={loaded}
          listed={queueListed}
          onListed={setQueueListed}
          person={person}
          onOpen={setSelected}
        />
      )}
      {(loadError || error) && (
        <div className="workbench-load-error" role="alert">
          <p>{loadError || error}</p>
          {!form && !selected && (
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void load()}
            >
              Retry loading records
            </Button>
          )}
          {snapshot && loadError && !form && !selected && (
            <small>Showing the last loaded records.</small>
          )}
        </div>
      )}
      {!snapshot && refreshing && (
        <div className="workbench-load-state" role="status">
          <RefreshCw size={18} className="animate-spin" aria-hidden="true" />
          <p>Loading assurance records…</p>
        </div>
      )}
      {location.recordId && !selected && details.loading && (
        <p className="subtle" role="status">
          Opening assurance record…
        </p>
      )}
      {snapshot &&
        !loadError &&
        location.recordId &&
        !selected &&
        !details.loading && (
          <div className="workbench-load-error" role="alert">
            <p>
              {details.error && details.error !== "Assurance record not found"
                ? details.error
                : "This assurance record is unavailable in this engagement."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Back to records
            </Button>
          </div>
        )}
      {snapshot && !["execution", "access"].includes(tab) && (
        <RecordFilters
          tab={tab}
          query={query}
          reviewFilter={reviewFilter}
          onQuery={setQuery}
          onReviewFilter={setReviewFilter}
          onClear={clearFilters}
        />
      )}
      {snapshot && (
        <div
          className="workbench-section-content"
          id="workbench-section-panel"
          role="tabpanel"
          aria-label={
            workbenchSections.find(([value]) => value === tab)?.[1] ?? tab
          }
          aria-busy={refreshing}
        >
          {tab === "systems" && (
            <SystemsSection
              writer={writer}
              hasModels={models.length > 0}
              hasDatasets={hasDatasets}
              canLinkPredictions={canLinkPredictions}
              open={open}
              list={list}
              onNavigate={onNavigate}
            />
          )}
          {tab === "execution" && (
            <ExecutionSection
              snapshot={snapshot}
              records={all}
              engagement={e}
              role={data.identity.role}
              writer={writer}
              busy={busy}
              initialProcedure={initialProcedure}
              open={open}
              act={act}
              onSystems={() => selectSection("systems")}
              onNavigate={onNavigate}
              onHosted={onHosted}
              onCompiled={compiled}
            />
          )}
          {tab === "evidence" && (
            <EvidenceSection
              writer={writer}
              hasArtifacts={artifacts.length > 0}
              open={open}
              list={list}
              onNavigate={onNavigate}
            />
          )}
          {tab === "sampling" && (
            <SamplingSection
              writer={writer}
              hasDatasets={hasDatasets}
              open={open}
              list={list}
            />
          )}
          {tab === "assistant" && (
            <AssistantSection
              scope={scope}
              refreshKey={loaded}
              writer={writer}
              busy={busy}
              sourceIds={sourceIds}
              setSourceIds={setSourceIds}
              known={known}
              hasSources={hasKind("location", "assertion")}
              act={act}
              open={open}
              list={list}
              onBriefing={(r) => setSelected(r)}
              onEvidenceSection={() => selectSection("evidence")}
              remember={remember}
              describeRecord={describeRecord}
            />
          )}
          {tab === "impact" && (
            <ImpactSection
              data={data}
              engagement={e}
              obligations={obligations}
              records={all}
              writer={writer}
              open={open}
              list={list}
            />
          )}
          {tab === "access" && (
            <AccessSection
              snapshot={snapshot}
              lead={lead}
              busy={busy}
              open={open}
            />
          )}
        </div>
      )}

      <FormDialog
        state={formState}
        fields={fields}
        busy={busy}
        dirty={dirty}
        error={error}
        scope={scope}
        refreshKey={loaded}
        onSubmit={submit}
        onDirty={() => setDirty(true)}
        onClose={() => {
          setForm("");
          setDirty(false);
        }}
        remember={remember}
        describeRecord={describeRecord}
      />

      <RecordDialog
        selected={selected}
        related={related}
        engagement={e}
        person={person}
        initialSection={detailSection}
        linksDisabled={dirty || busy}
        onRecord={(r) => setSelected(r)}
        onPaper={(id) => openLinkedSource(() => onPaper(id))}
        onEvidence={(id) => openLinkedSource(() => onEvidence(id))}
        onClose={() => setSelected(null)}
        review={
          selected && (
            <RecordReview
              selected={selected}
              related={related}
              details={details}
              engagement={e}
              identityId={data.identity.id}
              writer={writer}
              reviewer={reviewer}
              busy={busy}
              dirty={dirty}
              error={error}
              setDirty={setDirty}
              person={person}
              act={act}
              open={open}
              remember={remember}
              onClose={closeRecord}
            />
          )
        }
      />

      <TokenDialog token={token} onClose={() => setToken(null)} />
    </div>
  );
}
