"use client";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RegisterControls } from "../../register-controls";
import type { Register } from "../use-url-state";

/** Facet and sort controls of a register view, with "clear filters". */
export function RegisterFacets({
  register,
  label,
  values,
  sorts,
}: {
  register: Register;
  label: string;
  values: string[];
  sorts: { value: string; label: string }[];
}) {
  return (
    <RegisterControls
      facetLabel={label}
      facets={values}
      facet={register.facet}
      onFacet={register.setFacet}
      sort={register.sort}
      sorts={sorts}
      onSort={register.setSort}
      active={
        !!register.search ||
        register.filter !== "all" ||
        register.facet !== "all"
      }
      onClear={register.clear}
    />
  );
}
/** The toolbar button that creates a record in the current register. */
export function NewRecordButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button disabled={busy} onClick={onClick}>
      <Plus size={15} />
      {label}
    </Button>
  );
}
