import { describe, expect, it } from "vitest";
import { freshEngagement } from "@/lib/factories";
import type { WorkspaceData } from "../workspace-types";
import { applySaved } from "./use-workspace-data";

const engagement = freshEngagement("CL-1", "Model risk audit", "lead");
const other = freshEngagement("CL-1", "Claims audit", "lead");
const data = {
  engagement,
  engagements: [
    {
      id: engagement.id,
      title: engagement.title,
      client_id: "CL-1",
      stage: engagement.stage,
      due_date: engagement.dueDate,
    },
    {
      id: other.id,
      title: other.title,
      client_id: "CL-1",
      stage: other.stage,
      due_date: other.dueDate,
    },
  ],
  events: [],
  metadataBytes: 100,
} as unknown as WorkspaceData;

describe("applySaved", () => {
  it("applies a saved engagement, its directory row, audit trail and size", () => {
    const saved = {
      ...engagement,
      title: "Renamed audit",
      stage: "Fieldwork",
      dueDate: "2026-12-31",
      version: engagement.version + 1,
    } as typeof engagement;
    const events = [
      { id: "EV-1", action: "setStage" },
    ] as unknown as WorkspaceData["events"];
    const next = applySaved(data, saved, events, 250);
    expect(next.engagement).toBe(saved);
    expect(next.engagements[0]).toMatchObject({
      title: "Renamed audit",
      stage: "Fieldwork",
      due_date: "2026-12-31",
    });
    expect(next.engagements[1]).toBe(data.engagements[1]);
    expect(next.events).toBe(events);
    expect(next.metadataBytes).toBe(250);
  });

  it("keeps the trail it was not given", () => {
    const next = applySaved(data, engagement);
    expect(next.events).toBe(data.events);
    expect(next.metadataBytes).toBe(100);
  });
});
