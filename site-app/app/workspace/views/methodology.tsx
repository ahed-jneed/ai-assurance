"use client";
import { History } from "lucide-react";
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
import { humanLabel } from "@/lib/presentation";
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
  resolve,
  onDetail,
  onUseTemplate,
}: {
  data: WorkspaceData;
  register: Register;
  writer: boolean;
  busy: boolean;
  resolve: (id: string) => string;
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
                    {new Date(event.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{humanLabel(event.action)}</TableCell>
                  <TableCell>{resolve(event.actor)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDetail("Audit event", event)}
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
  );
}
