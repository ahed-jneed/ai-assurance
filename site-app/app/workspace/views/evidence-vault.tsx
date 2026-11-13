"use client";
import { Suspense } from "react";
import { Database, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Artifact, Engagement, EvidenceRequest, Role } from "@/lib/domain";
import { evidenceRows as selectEvidence } from "@/lib/register-views";
import { EvidenceRegister } from "../../audit-registers";
import { DatabaseToolbar } from "../../database-toolbar";
import { EvidenceReviewQueue } from "../../evidence-workspace";
import type { WorkspaceData } from "../../workspace-types";
import { evidenceCategories } from "../modules";
import type { EditingReporter } from "../navigation-guards";
import { useGenaiLevels } from "../use-genai-levels";
import {
  ClientPortal,
  EvidenceRequests,
  RequestAccess,
  panelFallback,
} from "../panels";
import type { WorkspaceAct } from "../types";
import type { UrlState } from "../use-url-state";
import { NewRecordButton, RegisterFacets } from "./register-toolbar";

/** Evidence files and, for the audit team, evidence requests. */
export function EvidenceVault({
  data,
  engagement: e,
  role,
  viewer,
  writer,
  busy,
  url,
  displayedEvidenceTab,
  resolve,
  act,
  onEditing,
  onReload,
  onOpenArtifact,
  onOpenRequest,
  onUpload,
  onNewRequest,
}: {
  data: WorkspaceData;
  engagement: Engagement;
  role: Role;
  viewer: boolean;
  writer: boolean;
  busy: boolean;
  url: UrlState;
  /** The tab shown; client roles only see files. */
  displayedEvidenceTab: string;
  resolve: (id: string) => string;
  act: WorkspaceAct;
  onEditing: { clientPortal: EditingReporter; requestAccess: EditingReporter };
  onReload: () => Promise<unknown>;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenRequest: (request: EvidenceRequest) => void;
  onUpload: () => void;
  onNewRequest: () => void;
}) {
  const {
    evidenceTab,
    setEvidenceTab,
    requestFilter,
    setRequestFilter,
    register,
  } = url;
  const { search, setSearch, filter, setFilter, setFacet, setSort } = register;
  const evidenceRows = selectEvidence(e.artifacts, register.query);
  const genaiLevels = useGenaiLevels(data.tenantId, e, role);
  return (
    <>
      {role === "Client Contributor" && (
        <Suspense fallback={panelFallback}>
          <ClientPortal
            data={data}
            busy={busy}
            onEditing={onEditing.clientPortal}
            onReload={onReload}
          />
        </Suspense>
      )}
      <EvidenceReviewQueue
        engagement={e}
        role={role}
        tab={evidenceTab}
        filter={evidenceTab === "requests" ? requestFilter : filter}
        onSelect={(tab, nextFilter) => {
          setEvidenceTab(tab);
          setFilter(tab === "files" ? nextFilter : "all");
          setRequestFilter(tab === "requests" ? nextFilter : "all");
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
            Files <span className="view-count">{e.artifacts.length}</span>
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
              views={
                viewer
                  ? // The client portal (#36): a client sees accepted,
                    // shared evidence, and a contributor also its own
                    // submissions; quarantine is the audit team's concern.
                    [
                      { value: "all", label: "All shared evidence" },
                      ...(role === "Client Contributor"
                        ? [
                            {
                              value: "unverified",
                              label: "Your submissions awaiting review",
                            },
                            { value: "accepted", label: "Accepted" },
                          ]
                        : []),
                    ]
                  : [
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
                    ]
              }
              value={filter}
              onView={setFilter}
              search={search}
              onSearch={setSearch}
              count={evidenceRows.length}
            >
              <RegisterFacets
                register={register}
                label="Category"
                values={evidenceCategories}
                sorts={[
                  { value: "newest", label: "Newest first" },
                  { value: "name_asc", label: "Name A–Z" },
                  { value: "category", label: "Category" },
                ]}
              />
              {writer && (
                <NewRecordButton
                  label="Upload evidence"
                  busy={busy}
                  onClick={onUpload}
                />
              )}
            </DatabaseToolbar>
            {evidenceRows.length ? (
              <EvidenceRegister
                artifacts={evidenceRows}
                tenantId={data.tenantId}
                engagementId={e.id}
                role={role}
                resolve={resolve}
                onOpen={onOpenArtifact}
                genaiLevels={genaiLevels}
              />
            ) : (
              <div className="empty-state">
                <Database size={26} aria-hidden="true" />
                <h3>
                  {e.artifacts.length
                    ? "No matching evidence"
                    : viewer
                      ? "No shared evidence yet"
                      : "No evidence yet"}
                </h3>
                <p>
                  {e.artifacts.length
                    ? "No files match this view, category and search."
                    : viewer
                      ? "Your auditor has not shared any accepted evidence yet."
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
                    <Button disabled={busy} onClick={onUpload}>
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
                onOpen={onOpenRequest}
                onNew={onNewRequest}
              />
              <RequestAccess
                data={data}
                busy={busy}
                act={act}
                onEditing={onEditing.requestAccess}
              />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
