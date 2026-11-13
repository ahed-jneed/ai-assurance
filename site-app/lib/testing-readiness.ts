import type { Engagement, Role } from "./domain";
import type { AssuranceRecord } from "./assurance-core";
import { undeclaredColumns } from "./special-category";
export type ExecutionSelection = {
  procedureId: string;
  systemId: string;
  mode:
    | "saved_predictions"
    | "provided_predictions"
    | "auditor_model"
    | "client_local";
  predictionId: string;
  securityReviewId: string;
  predictionOutput: string;
  datasetCardRecordId: string;
};
export function testingReadiness(
  e: Engagement,
  records: AssuranceRecord[],
  workers: { active: number; capabilities: string }[],
  role: Role,
  s: ExecutionSelection,
) {
  const p = e.workflow?.procedures.find((p) => p.id === s.procedureId),
    model = e.models.find((m) => m.id === p?.modelId),
    data = e.artifacts.find((a) => a.id === p?.datasetId),
    profile = e.evaluationProfiles?.find((r) => r.id === p?.profileId),
    system = records.find((r) => r.id === s.systemId && r.kind === "system"),
    lineage = records.find(
      (r) => r.id === s.predictionId && r.kind === "prediction",
    ),
    card = records.find(
      (r) => r.id === s.datasetCardRecordId && r.kind === "dataset",
    ),
    hosted = s.mode === "saved_predictions",
    native = s.mode === "auditor_model";
  const checks = [
    {
      label: "Approved scope and current program",
      done:
        e.workflow?.brief?.status === "approved" &&
        e.workflow.program.status === "approved",
    },
    {
      label: "Selected procedure with exact model, dataset and protocol",
      done:
        !!p?.selected &&
        ["applicable", "readiness"].includes(p.applicability) &&
        !!model &&
        !!data &&
        !!profile,
    },
    {
      label: "Matching model task and supported evaluation suite",
      done:
        !!model &&
        !!profile &&
        model.task === profile.task &&
        profile.suite.every((t) =>
          [
            "performance",
            "regression",
            "demographic_parity",
            "disparate_impact",
            "equalized_odds",
          ].includes(t),
        ),
    },
    {
      label: "Accepted dataset bytes and immutable card",
      done:
        !!data &&
        data.status === "accepted" &&
        !!card &&
        card.body.artifactId === data.id &&
        card.body.artifactSha256 === data.sha256,
    },
  ];
  // A client-held pin has no bytes on the platform (#102).
  if (data?.custody === "client") {
    checks.push({
      label: "Client-held dataset runs only in client-local mode",
      done: s.mode === "client_local",
    });
    // The pin's declared header holds the mapped columns (#134).
    if (data.clientPin?.columns)
      checks.push({
        label: "Mapped columns are in the client's declared header",
        done: !!profile && !undeclaredColumns(data, profile).length,
      });
  }
  if (hosted)
    checks.push({
      label: "Interactive saved predictions within the 1 MB limit",
      done:
        !!model &&
        model.format === "Prediction file" &&
        model.status === "registered" &&
        model.artifactId === data?.id &&
        !!data?.name.toLowerCase().endsWith(".csv") &&
        data.size <= 1024 * 1024,
    });
  else {
    checks.push(
      {
        label: "System revision contains this exact model pin",
        done:
          !!system &&
          !!model &&
          system.body.modelPins?.some(
            (pin: { id: string; sha256: string }) =>
              pin.id === model.id && pin.sha256 === model.sourceSha256,
          ),
      },
      {
        label: "External data within the 100 MB limit",
        done: !!data && data.size <= 100 * 1024 * 1024,
      },
    );
    if (native)
      checks.push(
        {
          label: "Lead authorization and accepted security review",
          done:
            role === "Lead Auditor" &&
            e.artifacts.some(
              (a) =>
                a.id === s.securityReviewId &&
                a.category === "Security" &&
                a.status === "accepted",
            ),
        },
        {
          label: "Portable adapter and complete numeric input contract",
          done:
            !!model &&
            ["ONNX", "XGBoost", "LightGBM", "PMML"].includes(model.format) &&
            !!system &&
            !system.body.pipelineArtifactId &&
            system.body.features?.length > 0 &&
            system.body.features.every(
              (f: { type: string; nullable: boolean }) =>
                ["number", "integer"].includes(f.type) && !f.nullable,
            ),
        },
        {
          label: "Named prediction output for ONNX / PMML",
          done:
            !!model &&
            (!["ONNX", "PMML"].includes(model.format) ||
              !!s.predictionOutput.trim()),
        },
      );
    else
      checks.push({
        label: "Declared lineage matches these system and dataset pins",
        done:
          !!lineage &&
          lineage.body.modelId === model?.id &&
          lineage.body.systemId === system?.id &&
          lineage.body.datasetId === data?.id &&
          lineage.body.datasetSha256 === data?.sha256,
      });
  }
  const format = native
      ? model?.format
      : data?.custody === "client"
        ? "client_local"
        : "provided_predictions",
    workerReady = workers.some((w) => {
      try {
        return w.active && JSON.parse(w.capabilities).includes(format);
      } catch {
        return false;
      }
    });
  return {
    checks,
    ready: checks.every((c) => c.done),
    workerReady,
    p,
    model,
    data,
    profile,
  };
}
