"use client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AuditTrail } from "../../audit-trail";
import { DatabaseToolbar } from "../../database-toolbar";
import type { CatalogItem, WorkspaceData } from "../../workspace-types";
import type { ViewDetail } from "../types";
import type { Register } from "../use-url-state";
import { RegisterFacets } from "./register-toolbar";

/** Catalog templates matching the register's type, stage and search. */
export function selectTemplates(
  items: CatalogItem[] | undefined,
  {
    filter,
    facet,
    search,
    sort,
  }: Pick<Register, "filter" | "facet" | "search" | "sort">,
) {
  return (
    items
      ?.filter(
        (t) =>
          (filter === "all" || t.kind === filter) &&
          (facet === "all" || t.stage === facet) &&
          (t.id + " " + t.title).toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) =>
        sort === "name_asc"
          ? a.title.localeCompare(b.title)
          : a.id.localeCompare(b.id),
      ) ?? []
  );
}

/** Methodology templates and the engagement's audit history. */
export function Methodology({
  data,
  register,
  writer,
  busy,
  onDetail,
  onUseTemplate,
}: {
  data: WorkspaceData;
  register: Register;
  writer: boolean;
  busy: boolean;
  onDetail: ViewDetail;
  onUseTemplate: (templateId: string) => void;
}) {
  const templateRows = selectTemplates(data.catalog?.items, register);
  return (
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
            value={register.filter}
            onView={register.setFilter}
            search={register.search}
            onSearch={register.setSearch}
            count={templateRows.length}
          >
            <RegisterFacets
              register={register}
              label="Stage"
              values={[
                ...new Set(data.catalog?.items.map((t) => t.stage) ?? []),
              ]}
              sorts={[
                {
                  value: "program",
                  label: "Reference order",
                },
                { value: "name_asc", label: "Name A–Z" },
              ]}
            />
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
                  <TableCell className="mono">{t.id}</TableCell>
                  <TableCell>
                    <button
                      className="paper-link"
                      onClick={() => onDetail(t.title, t)}
                    >
                      {t.title}
                    </button>
                  </TableCell>
                  <TableCell>
                    {t.kind === "memo" ? "Memo" : "Working paper"}
                  </TableCell>
                  <TableCell>{t.stage}</TableCell>
                  <TableCell>
                    {writer && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onUseTemplate(t.id)}
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
        {data.engagement && (
          // Keyed by engagement so its filters start empty in another
          // engagement: the trail refuses an event type that engagement
          // has not recorded (#201).
          <AuditTrail
            key={data.engagement.id}
            tenantId={data.tenantId}
            engagementId={data.engagement.id}
            version={data.engagement.version}
            onDetail={onDetail}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
