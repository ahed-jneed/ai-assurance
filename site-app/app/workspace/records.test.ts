import { describe, expect, it } from "vitest";
import type { Engagement } from "@/lib/domain";
import type { WorkspaceData } from "../workspace-types";
import {
  findRecord,
  isSheetRecordKind,
  liveRecord,
  nameResolver,
  recordKind,
  recordTitle,
  reportTitle,
} from "./records";

const artifact = {
    id: "a1",
    name: "scores.csv",
    category: "Dataset",
    sha256: "ab",
  },
  request = { id: "q1", subject: "Model card", responsibleParty: "Client" },
  finding = { id: "f1", title: "Missing log", riskScore: 9, condition: "c" },
  report = {
    id: "r1",
    kind: "final",
    createdAt: "2026-11-05T10:00:00Z",
    snapshot: {},
  },
  model = { id: "m1", name: "Scorer v2", format: "Prediction file" },
  run = { id: "u1", suite: "fairness" };
const engagement = {
  id: "e1",
  artifacts: [artifact],
  evidenceRequests: [request],
  findings: [finding],
  reports: [report],
  models: [model],
  runs: [run],
  papers: [{ id: "p1", title: "Data governance" }],
} as unknown as Engagement;

describe("recordKind", () => {
  it("recognises each sheet record by its distinguishing field", () => {
    expect(recordKind(artifact)).toBe("evidence");
    expect(recordKind(request)).toBe("request");
    expect(recordKind(finding)).toBe("finding");
    expect(recordKind(report)).toBe("report");
    expect(recordKind(run)).toBe("run");
    expect(recordKind(model)).toBe("model");
  });

  it("gives templates and audit events no link kind", () => {
    expect(recordKind({ id: "T-1", title: "Template", stage: "Plan" })).toBe(
      "",
    );
    expect(recordKind({ id: "ev1", action: "createPaper", hash: "h" })).toBe(
      "",
    );
  });

  it("checks evidence before the other kinds", () => {
    // An artifact also has a name; evidence wins over model-like shapes.
    expect(recordKind({ ...artifact, format: "csv" })).toBe("evidence");
  });
});

describe("findRecord", () => {
  it("looks up every link kind in the engagement", () => {
    expect(findRecord(engagement, "evidence", "a1")).toBe(artifact);
    expect(findRecord(engagement, "request", "q1")).toBe(request);
    expect(findRecord(engagement, "finding", "f1")).toBe(finding);
    expect(findRecord(engagement, "report", "r1")).toBe(report);
    expect(findRecord(engagement, "model", "m1")).toBe(model);
    expect(findRecord(engagement, "run", "u1")).toBe(run);
  });

  it("finds nothing for other kinds or unknown ids", () => {
    expect(findRecord(engagement, "paper", "p1")).toBeUndefined();
    expect(findRecord(engagement, "", "a1")).toBeUndefined();
    expect(findRecord(engagement, "finding", "missing")).toBeUndefined();
    expect(
      findRecord(
        { ...engagement, evidenceRequests: undefined },
        "request",
        "q1",
      ),
    ).toBeUndefined();
  });

  it("knows which kinds open in the sheet", () => {
    expect(isSheetRecordKind("run")).toBe(true);
    expect(isSheetRecordKind("template")).toBe(false);
    expect(isSheetRecordKind("paper")).toBe(false);
  });
});

describe("record titles", () => {
  const day = new Date(report.createdAt).toLocaleDateString();

  it("titles reports by kind and capture date", () => {
    expect(reportTitle({ kind: "final", createdAt: report.createdAt })).toBe(
      "Final report · " + day,
    );
    expect(reportTitle({ kind: "draft", createdAt: report.createdAt })).toBe(
      "Draft report · " + day,
    );
  });

  it("titles linked records by their own name", () => {
    expect(recordTitle(report as never)).toBe("Final report · " + day);
    expect(recordTitle(finding as never)).toBe("Missing log");
    expect(recordTitle(artifact as never)).toBe("scores.csv");
    expect(recordTitle(request as never)).toBe("Model card");
    expect(recordTitle(run as never)).toBe("Diagnostic run");
    expect(recordTitle({ id: "x" } as never)).toBe("Audit record");
  });
});

describe("liveRecord", () => {
  it("re-reads findings and requests from the current engagement", () => {
    const saved = { ...finding, title: "Saved title" };
    expect(
      liveRecord(finding, { ...engagement, findings: [saved] } as Engagement),
    ).toBe(saved);
    const answered = { ...request, subject: "Answered" };
    expect(
      liveRecord(request, {
        ...engagement,
        evidenceRequests: [answered],
      } as Engagement),
    ).toBe(answered);
  });

  it("keeps the opened record when it is gone or of another kind", () => {
    expect(
      liveRecord(finding, { ...engagement, findings: [] } as Engagement),
    ).toBe(finding);
    expect(liveRecord(report, engagement)).toBe(report);
    expect(liveRecord(finding, null)).toBe(finding);
    expect(liveRecord(undefined, engagement)).toBeUndefined();
  });
});

describe("nameResolver", () => {
  const data = {
    identity: { id: "me", name: "Seedy", role: "Lead Auditor" },
    people: [{ user_id: "u2", display_name: "Reviewer Rae" }],
    engagement,
  } as unknown as WorkspaceData;

  it("names people, the signed-in user, artifacts, models and papers", () => {
    const resolve = nameResolver(data);
    expect(resolve("u2")).toBe("Reviewer Rae");
    expect(resolve("me")).toBe("Seedy");
    expect(resolve("a1")).toBe("scores.csv");
    expect(resolve("m1")).toBe("Scorer v2");
    expect(resolve("p1")).toBe("Data governance");
  });

  it("falls back to the id", () => {
    expect(nameResolver(data)("unknown")).toBe("unknown");
    expect(nameResolver(null)("u2")).toBe("u2");
  });
});
