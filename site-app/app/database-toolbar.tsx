"use client";
import { Search, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";

export function DatabaseToolbar({
  views,
  value,
  onView,
  search,
  onSearch,
  label,
  count,
  children,
}: {
  views: { value: string; label: string }[];
  value: string;
  onView: (v: string) => void;
  search: string;
  onSearch: (v: string) => void;
  label: string;
  count: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="database-toolbar">
      <div
        className="database-views"
        role="group"
        aria-label={label + " views"}
      >
        {views.map((v) => (
          <button
            type="button"
            key={v.value}
            className={value === v.value ? "active" : ""}
            aria-pressed={value === v.value}
            onClick={() => onView(v.value)}
          >
            {v.value === "all" && <Table2 size={15} aria-hidden="true" />}
            <span>{v.label}</span>
            {value === v.value && (
              <span
                className="view-count"
                aria-label={count + " matching records"}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="database-tools">
        <div className="search-field">
          <Search size={16} aria-hidden="true" />
          <Input
            name="register-search"
            autoComplete="off"
            aria-label={"Search " + label.toLowerCase()}
            placeholder={"Search " + label.toLowerCase() + "…"}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              aria-label={"Clear " + label.toLowerCase() + " search"}
              onClick={() => onSearch("")}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
