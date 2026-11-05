import { useState } from "react";

export type SheetRecord = { title: string; value: unknown };

/** The record open in the record sheet beside the current view. */
export function useRecordSheet() {
  const [detail, setDetail] = useState<SheetRecord | null>(null),
    [detailExpanded, setDetailExpanded] = useState(false);
  function viewDetail(title: string, value: unknown) {
    setDetailExpanded(false);
    setDetail({ title, value });
  }
  return { detail, setDetail, detailExpanded, setDetailExpanded, viewDetail };
}
export type RecordSheetState = ReturnType<typeof useRecordSheet>;
