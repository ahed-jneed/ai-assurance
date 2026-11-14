// The audit program's location: the open tab, register filter and search,
// remembered per member and engagement for this page load, and the selected
// procedure and section, kept in step with the workspace URL. With no
// procedure open, the URL's section is the open tab (#227), as the
// Assurance workbench writes its own, so reload, Copy page link and
// Back/Forward keep it.
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Workflow } from "@/lib/workflow-types";
import { procedureSections, programSections } from "./program-sections";

const programViewMemory = new Map<
  string,
  {
    tab: string;
    query: string;
    filter: string;
    section: string;
  }
>();

export function useProgramLocation({
  memoryKey,
  w,
  initialProcedure,
  initialSection,
  onLocation,
  editing: form,
}: {
  /** Tenant, member and engagement the view memory belongs to. */
  memoryKey: string;
  w: Workflow | undefined;
  initialProcedure?: string;
  initialSection?: string;
  onLocation: (id: string | undefined, section: string) => void;
  /** A form is open: incoming links and URL updates wait until it closes. */
  editing: boolean;
}) {
  const memory = programViewMemory.get(memoryKey);
  const availableInitialProcedure =
    initialProcedure && w?.procedures.some((p) => p.id === initialProcedure)
      ? initialProcedure
      : undefined;
  const requestedProcedureSection =
    availableInitialProcedure &&
    procedureSections.includes(initialSection ?? "")
      ? initialSection
      : undefined;
  const requestedProgramTab = requestedProcedureSection
    ? requestedProcedureSection === "review"
      ? "review"
      : "program"
    : programSections.includes(initialSection ?? "")
      ? initialSection
      : undefined;
  const [tab, setTab] = useState(
      requestedProgramTab ?? memory?.tab ?? "program",
    ),
    [query, setQuery] = useState(memory?.query ?? ""),
    [filter, setFilter] = useState(memory?.filter ?? "selected"),
    [selected, setSelected] = useState<string | undefined>(
      availableInitialProcedure,
    ),
    [section, setSection] = useState(
      requestedProcedureSection ?? memory?.section ?? "plan",
    );
  const restoringLocation = useRef<{
    id: string | undefined;
    section: string;
    tab: string;
  } | null>(null);
  const reportLocation = useEffectEvent((id: string | undefined, at: string) =>
    onLocation(id, at),
  );
  // An incoming procedure link is applied when the linked procedure, section
  // or open form changes; the current section is read at that moment.
  const applyLocation = useEffectEvent(() => {
    // Hold URL updates until both parts of an incoming procedure link are applied.
    restoringLocation.current = {
      id: availableInitialProcedure,
      section: requestedProcedureSection ?? section,
      tab: requestedProgramTab ?? tab,
    };
    setSelected(availableInitialProcedure);
    if (requestedProcedureSection) setSection(requestedProcedureSection);
    if (requestedProgramTab) setTab(requestedProgramTab);
  });
  useEffect(() => {
    programViewMemory.set(memoryKey, { tab, query, filter, section });
  }, [memoryKey, tab, query, filter, section]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the link must be applied after commit, together with restoringLocation, which holds the URL-sync effect below until both parts are in place
    if (!form) applyLocation();
  }, [availableInitialProcedure, initialSection, form]);
  useEffect(() => {
    if (form) return;
    const restoring = restoringLocation.current;
    if (
      restoring &&
      (restoring.id !== selected ||
        restoring.section !== section ||
        restoring.tab !== tab)
    )
      return;
    restoringLocation.current = null;
    if (selected) reportLocation(selected, section);
    else reportLocation(undefined, tab);
  }, [selected, section, tab, availableInitialProcedure, initialSection, form]);
  return {
    tab,
    setTab,
    query,
    setQuery,
    filter,
    setFilter,
    selected,
    setSelected,
    section,
    setSection,
  };
}
