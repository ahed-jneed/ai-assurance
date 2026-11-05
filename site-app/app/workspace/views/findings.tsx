"use client";
import { AlertTriangle } from "lucide-react";
import type { Engagement, Finding, Role } from "@/lib/domain";
import { findingRows as selectFindings } from "@/lib/register-views";
import { FindingRegister } from "../../audit-registers";
import { DatabaseToolbar } from "../../database-toolbar";
import type { Register } from "../use-url-state";
import { Empty } from "../workspace-ui";
import { NewRecordButton, RegisterFacets } from "./register-toolbar";

export function Findings({
  engagement: e,
  register,
  role,
  userId,
  writer,
  busy,
  onOpen,
  onRemediate,
  onNew,
}: {
  engagement: Engagement;
  register: Register;
  role: Role;
  userId: string;
  writer: boolean;
  busy: boolean;
  onOpen: (finding: Finding) => void;
  onRemediate: (findingId: string) => void;
  onNew: () => void;
}) {
  const findingRows = selectFindings(e.findings, register.query);
  return (
    <section className="panel">
      <DatabaseToolbar
        label="Findings"
        views={[
          { value: "all", label: "All findings" },
          { value: "open", label: "Open" },
          { value: "high", label: "High risk" },
          { value: "closed", label: "Closed" },
        ]}
        value={register.filter}
        onView={register.setFilter}
        search={register.search}
        onSearch={register.setSearch}
        count={findingRows.length}
      >
        <RegisterFacets
          register={register}
          label="Severity"
          values={["Critical", "High", "Medium", "Low"]}
          sorts={[
            { value: "risk", label: "Highest risk" },
            { value: "due", label: "Earliest due date" },
            { value: "name_asc", label: "Name A–Z" },
          ]}
        />
        {writer && (
          <NewRecordButton label="New finding" busy={busy} onClick={onNew} />
        )}
      </DatabaseToolbar>
      {findingRows.length ? (
        <FindingRegister
          findings={findingRows}
          artifacts={e.artifacts}
          role={role}
          userId={userId}
          busy={busy}
          onOpen={onOpen}
          onRemediate={onRemediate}
        />
      ) : (
        <Empty
          icon={AlertTriangle}
          title={
            e.findings.length ? "No matching findings" : "No findings recorded"
          }
          text={
            e.findings.length
              ? "Change the view or clear the search."
              : "Add a finding to track its risk and remediation."
          }
        />
      )}
    </section>
  );
}
