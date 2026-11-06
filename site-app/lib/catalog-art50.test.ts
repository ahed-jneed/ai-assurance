import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import catalog from "./catalog.json";
import { templateCriterion, type CriteriaTemplate } from "./catalog-criteria";
import { freshEngagement } from "./factories";
import obligations from "./obligation-subitems.json";
import { seedWorkflow } from "./workflow-seed";
import {
  approveScope,
  artifact,
  command,
  planSave,
  procedureOf,
  structuredEngagement,
  workflowOf,
} from "./workflow/test-fixtures";

// The Art 50 working papers (#78; research A50-ED-20 to A50-ED-25): their
// steps, evidence and criteria come from the procedures of the Art 50
// research, and every new engagement's program carries them.
type ResearchStep = {
  id: string;
  description: string;
  method: string;
  evidenceItemIds: string[];
  samplingRuleId: string | null;
  onlyIf?: { fact: string; op: string; value: unknown }[];
};
type Research = {
  procedures: {
    id: string;
    title: string;
    catalogItemId: string;
    testSteps: ResearchStep[];
    passCriteria: string[];
    failCriteria: string[];
    inconclusiveCriteria: string[];
    legalReview: { itemIds: string[] };
  }[];
  evidenceItems: { id: string; title: string }[];
  sampling: { rules: { id: string }[] };
};
const research: Research = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../docs/research/art50-transparency-2026-11.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
type Item = (typeof catalog.items)[number] & CriteriaTemplate;
const items = catalog.items as Item[];
const item = (id: string) => items.find((i) => i.id === id)!;
const art50Papers = {
  "WP-XC-07": ["A50-P-00", "A50-P-01", "A50-P-03", "A50-P-05"],
  "WP-XC-10": ["A50-P-02A", "A50-P-02B", "A50-P-02D"],
  "WP-XC-11": ["A50-P-04A", "A50-P-04B"],
  "WP-XC-12": ["A50-P-02C", "A50-P-02E", "A50-P-02F"],
};

describe("the methodology catalogue", () => {
  it("has unique item and step ids, each step numbered under its item", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items)
      i.procedures.forEach((p, n) =>
        expect(p.id, i.id).toBe(i.id + "-P" + String(n + 1).padStart(2, "0")),
      );
  });

  it("keeps every working paper within the 30 steps an execution records", () => {
    for (const i of items.filter((i) => i.kind === "working_paper"))
      expect(i.procedures.length, i.id).toBeLessThanOrEqual(30);
  });
});

describe("the Art 50 working papers", () => {
  it("place every Art 50 research procedure in the paper the research names", () => {
    for (const p of research.procedures)
      expect(
        art50Papers[p.catalogItemId as keyof typeof art50Papers],
        p.id,
      ).toContain(p.id);
    expect(Object.values(art50Papers).flat().sort()).toEqual(
      research.procedures.map((p) => p.id).sort(),
    );
  });

  it("take their steps, in order, from the research procedures (29, 21, 15 and 17 steps)", () => {
    const counts: Record<string, number> = {};
    for (const [id, procedureIds] of Object.entries(art50Papers)) {
      const paper = item(id);
      const steps = procedureIds.flatMap(
        (pid) => research.procedures.find((p) => p.id === pid)!.testSteps,
      );
      counts[id] = paper.procedures.length;
      expect(paper.procedures).toHaveLength(steps.length);
      paper.procedures.forEach((p, n) => {
        const s = steps[n];
        expect(p.text.startsWith(s.id + " (" + s.method), p.id).toBe(true);
        expect(p.text, p.id).toContain(s.description);
        for (const ev of s.evidenceItemIds) expect(p.text, p.id).toContain(ev);
        if (s.samplingRuleId)
          expect(p.text, p.id).toContain("sampling " + s.samplingRuleId);
        // A conditional step says when it is performed and how to record a skip.
        expect(p.text.includes("Perform only where"), p.id).toBe(!!s.onlyIf);
      });
      expect(
        paper.researchProcedures?.procedures.map((p) => p.procedureId),
      ).toEqual(procedureIds);
      expect(
        paper.researchProcedures?.procedures.reduce((n, p) => n + p.steps, 0),
      ).toBe(steps.length);
    }
    expect(counts).toEqual({
      "WP-XC-07": 29,
      "WP-XC-10": 21,
      "WP-XC-11": 15,
      "WP-XC-12": 17,
    });
  });

  it("require the evidence the steps use and carry each procedure's pass, fail and inconclusive criteria", () => {
    const titles = new Map(research.evidenceItems.map((e) => [e.id, e.title]));
    for (const [id, procedureIds] of Object.entries(art50Papers)) {
      const paper = item(id);
      const used = new Set(
        procedureIds.flatMap((pid) =>
          research.procedures
            .find((p) => p.id === pid)!
            .testSteps.flatMap((s) => s.evidenceItemIds),
        ),
      );
      expect(paper.evidenceRequired).toEqual(
        [...used].map((ev) => titles.get(ev) + " (" + ev + ")"),
      );
      for (const c of paper.researchProcedures!.procedures) {
        const r = research.procedures.find((p) => p.id === c.procedureId)!;
        expect(c).toMatchObject({
          title: r.title,
          pass: r.passCriteria,
          fail: r.failCriteria,
          inconclusive: r.inconclusiveCriteria,
          legalReviewItemIds: r.legalReview.itemIds,
        });
        // The obligation items the procedure tests.
        expect(c.items).toEqual(
          obligations.items
            .filter((i) =>
              (i as { procedureIds?: string[] }).procedureIds?.includes(
                c.procedureId,
              ),
            )
            .map((i) => i.code),
        );
      }
      expect(paper).toMatchObject({
        kind: "working_paper",
        stage: "Fieldwork",
        automationMode: "hybrid",
      });
    }
    expect(item("WP-XC-07").regulatoryRefs).toEqual(["Art.50", "Art.111"]);
    expect(item("WP-XC-11").regulatoryRefs).toEqual(["Art.50", "Art.3"]);
  });

  it("test claimed exceptions per item and Art 50(5) only while an Art 50(1) to (4) item remains", () => {
    expect(item("WP-XC-07").objective).toMatch(/never excludes the item/);
    expect(item("WP-XC-07").objective).toMatch(
      /A50-P-05 is performed only while at least one Art 50\(1\) to \(4\) item remains/,
    );
    expect(item("WP-XC-11").objective).toMatch(/text by text/);
    const p05 = item("WP-XC-07").researchProcedures!.procedures.find(
      (p) => p.procedureId === "A50-P-05",
    )!;
    expect(p05.items).toEqual(["AIA-50-5"]);
  });

  it("update WP-PL-03, MEM-CL-01 and WP-PL-06 for Art 50 work", () => {
    expect(
      item("WP-PL-03").procedures.find((p) => p.id === "WP-PL-03-P03")?.text,
    ).toBe(
      "Record the Art 50 facts and exceptions per operator role; an unknown fact keeps Art 50 applicability pending.",
    );
    const memo = item("MEM-CL-01").procedures.at(-1)!;
    expect(memo.id).toBe("MEM-CL-01-P04");
    for (const lr of ["LR-A50-06", "LR-A50-03", "LR-A50-09"])
      expect(memo.text).toContain(lr);
    const sampling = item("WP-PL-06").procedures.at(-1)!;
    expect(sampling.id).toBe("WP-PL-06-P05");
    for (const r of research.sampling.rules)
      expect(sampling.text).toContain(r.id);
  });
});

describe("the Art 50 papers in a new engagement", () => {
  const ids = ["WP-XC-07", "WP-XC-10", "WP-XC-11", "WP-XC-12"];

  it("seed each paper into the program with its steps, evidence and criteria", () => {
    const w = seedWorkflow("lead", "2026-11-06T09:00:00.000Z");
    for (const id of ids) {
      const p = w.procedures.find((x) => x.templateId === id)!;
      expect(p, id).toBeDefined();
      expect(p).toMatchObject({
        id: "PROC-" + id,
        title: item(id).title,
        stage: "Fieldwork",
        selected: false,
        applicability: "pending",
        sourceVersion: catalog.regulatorySnapshot.celex,
      });
      expect(p.instructions).toEqual(item(id).procedures);
      expect(p.expectedEvidence).toEqual(item(id).evidenceRequired);
      expect(p.criterion).toBe(templateCriterion(item(id)));
      for (const c of item(id).researchProcedures!.procedures)
        for (const pass of c.pass) expect(p.criterion).toContain(pass);
      // The plan form accepts criteria of up to 8000 characters.
      expect(p.criterion.length, id).toBeLessThanOrEqual(8000);
    }
    // Other papers keep their references as the starting criterion.
    expect(
      w.procedures.find((x) => x.templateId === "WP-A10-01")?.criterion,
    ).toBe(item("WP-A10-01").regulatoryRefs.join("; "));
  });

  it("add the papers to a legacy engagement's working papers with the same criteria", () => {
    const e = freshEngagement("CL-1", "Chatbot audit", "user-lead");
    for (const id of ids) {
      const paper = e.papers.find((q) => q.templateId === id)!;
      expect(paper, id).toBeDefined();
      expect(paper.required).toBe(true);
      expect(paper.body.criteria).toBe(templateCriterion(item(id)));
      expect(paper.plannedGuidance?.split("\n")).toHaveLength(
        item(id).procedures.length,
      );
    }
  });

  it("execute the 29-step WP-XC-07 with conditional steps recorded as not performed", async () => {
    const e = structuredEngagement({ artifacts: [artifact()] });
    const id = "PROC-WP-XC-07";
    await approveScope(e);
    await command(
      e,
      "scopeProgramCandidates",
      {
        procedureIds: workflowOf(e).procedures.map((p) => p.id),
        selected: false,
        applicability: "not_applicable",
        rationale: "Outside the agreed engagement scope",
        periodAnalysis: "Not relevant to the audit period",
      },
      "auditor",
    );
    await command(
      e,
      "saveProcedurePlan",
      planSave(
        e,
        {
          rationale: "AIA-50-1 and AIA-50-5 are candidates for the provider",
          criterion: procedureOf(e, id).criterion,
          sourceVersion: catalog.regulatorySnapshot.celex,
          periodAnalysis: "Art 50 applies from 2 August 2026",
          population: "Every channel, locale and entry point",
          sampling: "SR-A50-01 and SR-A50-05",
        },
        id,
      ),
      "auditor",
    );
    await command(e, "submitProgram", {}, "auditor");
    await command(
      e,
      "approveProgram",
      { revision: workflowOf(e).program.revision, reason: "Program agreed" },
      "reviewer",
    );
    const instructions = procedureOf(e, id).instructions;
    expect(instructions).toHaveLength(29);
    const steps = instructions.map((i) =>
      i.text.includes("Perform only where") || i.text.startsWith("A50-P-03")
        ? {
            id: i.id,
            state: "not_performed",
            notes: "Not applicable: the classification answers no",
          }
        : { id: i.id, state: "performed", notes: "" },
    );
    await command(
      e,
      "recordProcedureExecution",
      {
        procedureId: id,
        performed: "Walked through every channel and ran the probes",
        steps,
        sampling: "All 12 channel and locale combinations; 189 probes",
        results: "Notices present at first interaction",
        limitations: "",
        evidenceIds: ["evidence"],
        runIds: [],
      },
      "auditor",
    );
    expect(procedureOf(e, id).execution?.steps).toHaveLength(29);
  });
});
