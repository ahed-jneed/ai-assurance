"use client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
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
function UploadFields({ choices, choice, engagement: e }: ModalFieldsProps) {
  return (
    <>
      <label>
        Evidence file
        <Input name="file" type="file" required />
      </label>
      <div className="field-grid">
        <label>
          Category
          <Choice
            label="Category"
            value={choices.category}
            values={evidenceCategories}
            onChange={(v) => choice("category", v)}
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
          onChange={(v) => choice("handlingBasis", v)}
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
  submit: async ({ form, data, engagement: e, choices, setBusy, load }) => {
    setBusy(true);
    const fd = new FormData(form);
    fd.set("tenantId", data!.tenantId);
    fd.set("engagementId", e!.id);
    fd.set("expectedVersion", String(e!.version));
    fd.set("category", choices.category || "Other");
    fd.set("visibility", choices.visibility || "internal");
    fd.set("handlingBasis", choices.handlingBasis || "");
    fd.set("governanceArtifactId", choices.governanceArtifactId || "");
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
