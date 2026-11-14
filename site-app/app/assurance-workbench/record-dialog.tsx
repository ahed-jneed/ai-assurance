"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { AssuranceRecord } from "@/lib/assurance-core";
import {
  AssuranceRecordDetails,
  recordSubtitle,
} from "../assurance-record-details";
import { recordTitle } from "../assurance-register";
import type { Engagement } from "./types";

/** The dialog of the open record: its details, with `review` as its review. */
export function RecordDialog({
  selected,
  related,
  engagement,
  person,
  initialSection,
  linksDisabled,
  onRecord,
  onPaper,
  onEvidence,
  onClose,
  review,
}: {
  selected: AssuranceRecord | null;
  related: AssuranceRecord[];
  engagement: Engagement;
  person: (id: string) => string;
  initialSection: "overview" | "review";
  linksDisabled: boolean;
  onRecord: (record: AssuranceRecord) => void;
  onPaper: (id: string) => void;
  onEvidence: (id: string) => void;
  onClose: () => void;
  review: ReactNode;
}) {
  return (
    <Dialog
      open={!!selected}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="audit-dialog workbench-dialog">
        <DialogHeader>
          <DialogTitle>
            {selected ? recordTitle(selected) : "Assurance record"}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? recordSubtitle(selected)
              : "Saved assessment and source history"}
          </DialogDescription>
        </DialogHeader>
        {selected && (
          <AssuranceRecordDetails
            key={selected.id}
            record={selected}
            records={related}
            engagement={engagement}
            person={person}
            initialSection={initialSection}
            linksDisabled={linksDisabled}
            onRecord={onRecord}
            onPaper={onPaper}
            onEvidence={onEvidence}
            review={review}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
