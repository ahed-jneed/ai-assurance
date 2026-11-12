// Read-only tools the workspace registers with navigator.modelContext (the
// WebMCP proposal) when the browser provides it.
import { useEffect, useRef } from "react";
import { finalReportGates } from "@/lib/domain";
import { packFeatures, type WorkspaceData } from "../workspace-types";
import { managementNavigation, navigation } from "./modules";

const modules = [...managementNavigation, ...navigation].map(
  ([label]) => label,
);

export function useModelContextTools(
  getData: () => WorkspaceData | null,
  navigate: (module: string) => string,
) {
  const navigateRef = useRef(navigate);
  // eslint-disable-next-line react-hooks/refs -- latest-function ref read by the navigation tool registered with navigator.modelContext; writing it during render is the current behaviour
  navigateRef.current = navigate;
  useEffect(() => {
    const registry = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => void;
        };
      }
    ).modelContext;
    if (!registry?.registerTool) return;
    const controller = new AbortController();
    const tools = [
      {
        name: "read_audit_workspace",
        title: "Read engagement status",
        description:
          "Read the selected engagement and its review blockers. Does not change audit data.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input: unknown) {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw Error("No input fields accepted");
          const current = getData();
          if (!current?.engagement) throw Error("No engagement selected");
          return {
            engagementId: current.engagement.id,
            title: current.engagement.title,
            stage: current.engagement.stage,
            role: current.identity.role,
            blockers: finalReportGates(
              current.engagement,
              undefined,
              packFeatures(current),
            ).map((g) => g.message),
          };
        },
      },
      {
        name: "navigate_audit_workspace",
        title: "Open audit module",
        description:
          "Navigate to one audit module without changing audit records.",
        inputSchema: {
          type: "object",
          properties: {
            module: {
              type: "string",
              enum: [...modules],
            },
          },
          required: ["module"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input: unknown) {
          const value = input as { module?: string };
          if (
            !value ||
            Object.keys(value).length !== 1 ||
            !modules.some((label) => label === value.module)
          )
            throw Error("Unknown audit module");
          return {
            module: value.module,
            status: navigateRef.current(value.module!),
          };
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          registry.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {}
    return () => controller.abort();
  }, [getData]);
}
