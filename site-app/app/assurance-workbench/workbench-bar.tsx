"use client";

import { RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  workbenchReviewStates,
  workbenchSections,
} from "@/lib/workbench-presentation";

/** The section picker, the section tabs and the refresh button. */
export function WorkbenchBar({
  tab,
  onSection,
  hasPanel,
  refreshDisabled,
  refreshing,
  onRefresh,
}: {
  tab: string;
  onSection: (section: string) => void;
  // Whether the section panel is rendered (it is not while loading).
  hasPanel: boolean;
  refreshDisabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="workbench-bar">
      <label className="workbench-section-picker">
        Workbench section
        <select value={tab} onChange={(ev) => onSection(ev.target.value)}>
          {workbenchSections.map(([value, title]) => (
            <option key={value} value={value}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <Tabs value={tab} onValueChange={onSection}>
        <TabsList aria-label="Assurance workbench sections">
          {workbenchSections.map(([value, title]) => (
            <TabsTrigger
              key={value}
              value={value}
              // The section renders below the bar, outside these tabs, so
              // each tab controls that panel; while it loads, none (#36).
              aria-controls={hasPanel ? "workbench-section-panel" : undefined}
            >
              {title}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="sm"
        disabled={refreshDisabled}
        aria-label="Refresh workbench"
        onClick={onRefresh}
      >
        <RefreshCw
          size={15}
          aria-hidden="true"
          className={refreshing ? "animate-spin" : ""}
        />
      </Button>
    </div>
  );
}

/** The record search, the review-status filter and the clear button. */
export function RecordFilters({
  tab,
  query,
  reviewFilter,
  onQuery,
  onReviewFilter,
  onClear,
}: {
  tab: string;
  query: string;
  reviewFilter: string;
  onQuery: (search: string) => void;
  onReviewFilter: (review: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="assurance-filters">
      <div className="search-field">
        <Search size={15} aria-hidden="true" />
        <Input
          name="assurance-search"
          autoComplete="off"
          aria-label="Search assurance records"
          placeholder="Search records, references or people…"
          value={query}
          onChange={(ev) => onQuery(ev.target.value)}
        />
      </div>
      {["evidence", "impact"].includes(tab) && (
        <select
          aria-label="Filter by review status"
          value={reviewFilter}
          onChange={(ev) => onReviewFilter(ev.target.value)}
        >
          {workbenchReviewStates.map((value) => (
            <option value={value} key={value}>
              {value === "all"
                ? "All review states"
                : value === "Returned"
                  ? "Returned for revision"
                  : value}
            </option>
          ))}
        </select>
      )}
      {(query || reviewFilter !== "all") && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Clear record filters"
          onClick={onClear}
        >
          <X size={14} aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>
  );
}
