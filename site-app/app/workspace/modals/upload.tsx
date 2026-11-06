"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  headerScanBytes,
  specialColumns,
  uploadHeader,
  type SpecialColumn,
} from "@/lib/special-category";
import { PendingLegalReview } from "../../special-category";
import type { WorkspaceData } from "../../workspace-types";
import { evidenceCategories } from "../modules";
import { Choice } from "../workspace-ui";
import type { ModalDefinition, ModalFieldsProps } from "./types";

/** Choices the upload form opens with. */
export const uploadDefaults = () => ({
  category: "Dataset",
  visibility: "internal",
  handlingBasis: "synthetic",
});
function UploadFields({
  choices,
  choice,
  checks,
  check,
  engagement: e,
}: ModalFieldsProps) {
  // The chosen CSV's special-category columns, read from its header here so
  // the uploader sees what the server will gate (#60, D-11).
  const [found, setFound] = useState<SpecialColumn[]>([]);
  async function inspect(file: File | undefined) {
    setFound([]);
    check("specialCategoryNotPersonal", false);
    if (!file || !e) return;
    try {
      const headers = uploadHeader(
        file.name,
        await file.slice(0, headerScanBytes).arrayBuffer(),
      );
      setFound(headers ? specialColumns(headers, e) : []);
    } catch {
      setFound([]);
    }
  }
  const uncovered = found.filter((c) => !c.basisId);
  return (
    <>
      <label>
        Evidence file
        <Input
          name="file"
          type="file"
          required
          onChange={(ev) => void inspect(ev.target.files?.[0])}
        />
      </label>
      <div className="field-grid">
        <label>
          Category
          <Choice
            label="Category"
            value={choices.category}
            values={evidenceCategories}
            onChange={(v) => {
              choice("category", v);
              check("specialCategoryNotPersonal", false);
            }}
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
          onChange={(v) => {
            choice("handlingBasis", v);
            // The declaration holds only for the basis it was ticked under.
            check("specialCategoryNotPersonal", false);
          }}
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
                  (a) => a.category === "Governance" && a.status === "accepted",
                )
                .map((a) => ({ value: a.id, label: a.name })) ?? []
            }
            onChange={(v) => choice("governanceArtifactId", v)}
          />
        </label>
      )}
      {choices.category === "Dataset" && found.length > 0 && (
        <div className="note" role="status">
          <p>
            Special-category columns:{" "}
            {found
              .map(
                (c) =>
                  c.column + (c.basisId ? " (basis " + c.basisId + ")" : ""),
              )
              .join(", ")}
            .{" "}
            {uncovered.length
              ? "Record the client's Art 4a or GDPR Art 9(2) basis for " +
                uncovered.map((c) => c.column).join(", ") +
                " under Testing lab › Datasets before uploading, or upload only approved aggregates."
              : "The recorded basis is logged with this upload."}{" "}
            Only Dataset evidence is gated; runs read only Dataset evidence.{" "}
            <PendingLegalReview />
          </p>
          {uncovered.length > 0 &&
            ["synthetic", "anonymized"].includes(choices.handlingBasis) && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={!!checks.specialCategoryNotPersonal}
                  onChange={(ev) =>
                    check("specialCategoryNotPersonal", ev.target.checked)
                  }
                />{" "}
                These columns hold no special-category personal data (synthetic,
                anonymised or aggregate evidence). This declaration is recorded
                in the audit trail.
              </label>
            )}
        </div>
      )}
      <div className="note">
        Limit 50 MB. Where Article 4a restricts access by other parties, process
        sensitive-category records in the client&apos;s controlled environment
        and upload permitted aggregate evidence. Review privacy and
        confidentiality before upload.
      </div>
    </>
  );
}
/** Uploads a file to the evidence vault through POST /api/evidence. */
export const uploadModal: ModalDefinition = {
  title: "Upload evidence",
  submitLabel: "Upload for acceptance",
  Fields: UploadFields,
  reportsToWorkspace: true,
  submit: async ({
    form,
    data,
    engagement: e,
    choices,
    checks,
    setBusy,
    load,
  }) => {
    setBusy(true);
    const fd = new FormData(form);
    fd.set("tenantId", data!.tenantId);
    fd.set("engagementId", e!.id);
    fd.set("expectedVersion", String(e!.version));
    fd.set("category", choices.category || "Other");
    fd.set("visibility", choices.visibility || "internal");
    fd.set("handlingBasis", choices.handlingBasis || "");
    fd.set("governanceArtifactId", choices.governanceArtifactId || "");
    fd.set(
      "specialCategoryDeclaration",
      checks.specialCategoryNotPersonal ? "not_personal" : "",
    );
    const response = await fetch("/api/evidence", {
        method: "POST",
        body: fd,
      }),
      body = (await response.json()) as WorkspaceData & { error?: string };
    if (!response.ok) throw Error(body.error ?? "Request failed");
    await load(data!.tenantId, e!.id);
    toast.success("Evidence uploaded; acceptance review required");
    setBusy(false);
  },
};
