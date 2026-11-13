"use client";

import { ArrowUpRight, ClipboardCheck, Clock3, FileCheck2 } from "lucide-react";
import type { Engagement, Role } from "@/lib/domain";
import {
  evidenceRequestCounts,
  localEvidenceDay,
} from "@/lib/evidence-presentation";
import { canSee } from "@/lib/permissions";

export function EvidenceReviewQueue({
  engagement,
  role,
  tab,
  filter,
  onSelect,
}: {
  engagement: Engagement;
  role: Role;
  tab: string;
  filter: string;
  onSelect: (tab: "files" | "requests", filter: string) => void;
}) {
  const counts = evidenceRequestCounts(
    engagement.evidenceRequests ?? [],
    localEvidenceDay(),
  );
  const requests = canSee(role, "evidenceRequests");
  const items = [
    {
      tab: "files" as const,
      filter: "unverified",
      label: "Awaiting acceptance",
      count: engagement.artifacts.filter((a) => a.status === "unverified")
        .length,
      icon: FileCheck2,
    },
    ...(requests
      ? [
          {
            tab: "requests" as const,
            filter: "submitted",
            label: "Needs assessment",
            count: counts.submitted,
            icon: ClipboardCheck,
          },
          {
            tab: "requests" as const,
            filter: "open",
            label: "Outstanding requests",
            count: counts.open,
            icon: Clock3,
          },
          {
            tab: "requests" as const,
            filter: "overdue",
            label: "Deadline passed",
            count: counts.overdue,
            icon: Clock3,
          },
        ]
      : []),
  ];
  if (!requests) return null;
  return (
    <nav className="evidence-review-queue" aria-label="Evidence review queues">
      {items.map(({ icon: Icon, ...item }) => (
        <button
          key={item.tab + item.filter}
          type="button"
          aria-pressed={tab === item.tab && filter === item.filter}
          onClick={() => onSelect(item.tab, item.filter)}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{item.label}</span>
          <strong>{item.count}</strong>
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}
