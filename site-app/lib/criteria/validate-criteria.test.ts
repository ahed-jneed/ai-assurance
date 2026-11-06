// The criteria validator (schemas/validate-criteria.mjs, CI runs it too):
// the schema with its rejected mutations, integrity rules 1 to 12 each
// against a failing fixture, rule 13 against base indexes, the JCS digest and
// the pre-deploy legacy check (docs/design/criteria-model.md sections 6.5,
// 11.4, 14 and 16, tests 1 to 3 and 5).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baseIndex,
  canonicalize,
  checkCriteria,
  checkHistory,
  checkMethodologyDrift,
  digest,
  legacyCheck,
  loadValidator,
  readCriteria,
} from "../../../schemas/validate-criteria.mjs";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const validate = loadValidator();
const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(
      new URL(`../../../schemas/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );
const aiActSample = fixture("criteria-pack.eu-ai-act-amended.sample.json");
const newPack = fixture("criteria-pack.en18286-iso42001.sample.json");

/** The ids of the section 12 sample, which #28 also uses for its drafts. */
const sampleIds = new Set<string>(
  newPack.documents.map((d: Json) => d.id as string),
);
/**
 * The committed criteria plus the section 12 documents as drafts. The
 * committed #28 drafts share the sample's ids, so they are left out here:
 * the rule cases mutate the sample, and the committed drafts have their own
 * test below.
 */
function criteria() {
  const { index, documents } = readCriteria();
  const copy = structuredClone(index) as Json;
  copy.documents = copy.documents.filter((e: Json) => !sampleIds.has(e.id));
  const docs = new Map<string, Json>(
    [...documents]
      .filter(([k]) => copy.documents.some((e: Json) => e.path === k))
      .map(([k, v]) => [k, structuredClone(v)]),
  );
  newPack.index.documents.forEach((entry: Json, i: number) => {
    copy.documents.push(structuredClone(entry));
    docs.set(entry.path, structuredClone(newPack.documents[i]));
  });
  return { index: copy, documents: docs };
}
const doc = (c: ReturnType<typeof criteria>, path: string) =>
  c.documents.get(path)!;
const P1 = "packs/eu-ai-act-amended/2026.11.2.json";
const F1 = "frameworks/eu-ai-act/02024R1689-20260727/2026.11.2.json";
const NP = "packs/en18286-iso42001/2027.1.0.json";
const ISO = "frameworks/iso-iec-42001/2023/2027.1.0.json";
const EN = "frameworks/en-18286/2026/2027.1.0.json";
const XEN = "crosswalks/en-18286-to-eu-ai-act/2027.1.0.json";
const XISO = "crosswalks/iso-iec-42001-to-eu-ai-act/2027.1.0.json";
const entry = (c: ReturnType<typeof criteria>, path: string) =>
  c.index.documents.find((e: Json) => e.path === path);
/** Releases a draft entry with the methodology owner's approval and its digest. */
function release(c: ReturnType<typeof criteria>, path: string) {
  const e = entry(c, path);
  e.status = "released";
  e.releasedAt = "2027-01-15";
  e.approvals = [{ role: "methodology_owner", by: "Owner", at: "2027-01-15" }];
  e.sha256 = digest(doc(c, path));
}
const errors = (c: ReturnType<typeof criteria>) =>
  checkCriteria({ ...c, validate }).errors as string[];

describe("criteria schema", () => {
  it("accepts the committed documents, the index and both fixtures", () => {
    const { index, documents } = readCriteria();
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
    for (const [path, d] of documents)
      expect(validate(d), path + JSON.stringify(validate.errors)).toBe(true);
    expect(validate(aiActSample), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(newPack), JSON.stringify(validate.errors)).toBe(true);
  });

  const fw = () => structuredClone(newPack.documents[1]) as Json;
  const pack = () => structuredClone(aiActSample.documents[1]) as Json;
  const cw = () => structuredClone(newPack.documents[4]) as Json;
  const idx = () => structuredClone(aiActSample.index) as Json;
  const documentMutations: [string, () => Json][] = [
    [
      "a migrated superset_of link",
      () => {
        const p = pack();
        p.controlObjectives[0].addresses[0].relationship = "superset_of";
        return p;
      },
    ],
    [
      "text under paraphrased_titles",
      () => {
        const f = fw();
        f.requirements[1].text = "Clause text";
        return f;
      },
    ],
    [
      "an 81-character title under paraphrased_titles",
      () => {
        const f = fw();
        f.requirements[1].title = "x".repeat(81);
        return f;
      },
    ],
    [
      "a title under identifiers_only",
      () => {
        const f = fw();
        f.licence.textPolicy = "identifiers_only";
        return f;
      },
    ],
    [
      "an audit programme without reporting",
      () => {
        const p = pack();
        delete p.reporting;
        return p;
      },
    ],
    [
      "an audit programme without a primary set",
      () => {
        const p = pack();
        p.criteria[0].role = "supporting";
        return p;
      },
    ],
    [
      "an unknown feature",
      () => {
        const p = pack();
        p.features.soc2 = true;
        return p;
      },
    ],
    [
      "a feature that is not a boolean",
      () => {
        const p = pack();
        p.features.annexIvIndex = "yes";
        return p;
      },
    ],
    [
      "compat.obligations without order",
      () => {
        const f = structuredClone(aiActSample.documents[0]) as Json;
        delete f.compat.obligations.order;
        return f;
      },
    ],
    [
      "the first draft's methodologyVersions map",
      () => {
        const p = pack();
        p.methodologyVersions = { "2026.10.1": "2026.10.1" };
        return p;
      },
    ],
    [
      "a working paper without objectives",
      () => {
        const p = pack();
        p.items[0].objectiveIds = [];
        return p;
      },
    ],
    [
      "a working paper with 31 steps",
      () => {
        const p = pack();
        p.items[0].procedures = Array.from({ length: 31 }, (_, i) => ({
          id: `WP-A09-01-P${i + 10}`,
          text: "Step",
        }));
        return p;
      },
    ],
    [
      "an item without evidence",
      () => {
        const p = pack();
        p.items[0].evidenceRequired = [];
        return p;
      },
    ],
    [
      "an http source",
      () => {
        const f = fw();
        f.sources[0].url = "http://www.iso.org/standard/42001";
        return f;
      },
    ],
    [
      "a verified fact without a check date",
      () => {
        const f = fw();
        delete f.defaultProvenance.checkedAt;
        return f;
      },
    ],
    [
      "exhaustive on a requirement",
      () => {
        const f = fw();
        f.requirements[1].exhaustive = true;
        return f;
      },
    ],
    [
      "replacedBy without deprecated",
      () => {
        const f = fw();
        f.requirements[1].replacedBy = ["8.2"];
        return f;
      },
    ],
    [
      "a bad requirement id",
      () => {
        const f = fw();
        f.requirements[1].id = "6 1 2";
        return f;
      },
    ],
    [
      "a bad requirement reference",
      () => {
        const p = pack();
        p.controlObjectives[0].addresses[0].requirement = "AIA-ART-9";
        return p;
      },
    ],
    [
      "an unknown relationship",
      () => {
        const c = cw();
        c.entries[0].relationship = "equivalent_to";
        return c;
      },
    ],
    [
      "an unknown rationale",
      () => {
        const c = cw();
        c.entries[0].rationale = "intuitive";
        return c;
      },
    ],
    [
      "a crosswalk without a use case",
      () => {
        const c = cw();
        delete c.useCase;
        return c;
      },
    ],
    [
      "a crosswalk-only pack with items",
      () => {
        const p = pack();
        p.kind = "crosswalk_only";
        p.crosswalks = [{ id: "x-to-y", version: "2027.1.0" }];
        return p;
      },
    ],
    [
      "a bad data version",
      () => {
        const p = pack();
        p.version = "2026.13.1";
        return p;
      },
    ],
  ];
  const indexMutations: [string, () => Json][] = [
    [
      "a released entry without approvals",
      () => {
        const i = idx();
        delete i.documents[1].approvals;
        return i;
      },
    ],
    [
      "a released entry without a digest",
      () => {
        const i = idx();
        delete i.documents[1].sha256;
        return i;
      },
    ],
    [
      "a released entry without releasedAt",
      () => {
        const i = idx();
        delete i.documents[1].releasedAt;
        return i;
      },
    ],
    [
      "two approvals in one role",
      () => {
        const i = idx();
        i.documents[1].approvals.push({
          role: "methodology_owner",
          by: "Other",
          at: "2026-12-01",
        });
        return i;
      },
    ],
    [
      "an unknown role",
      () => {
        const i = idx();
        i.documents[1].approvals[0].role = "auditor";
        return i;
      },
    ],
    [
      "the first draft's approvedBy field",
      () => {
        const i = idx();
        i.documents[1].approvedBy = "Owner";
        return i;
      },
    ],
    [
      "legalReview completed without a legal reviewer",
      () => {
        const i = idx();
        i.documents[0].legalReview = "completed";
        return i;
      },
    ],
    [
      "legalReview pending with a legal reviewer",
      () => {
        const i = idx();
        i.documents[0].approvals.push({
          role: "legal_reviewer",
          by: "Counsel",
          at: "2026-12-02",
        });
        return i;
      },
    ],
    [
      "legalReview on a pack entry",
      () => {
        const i = idx();
        i.documents[1].legalReview = "pending";
        return i;
      },
    ],
    [
      "an unknown legalReview value",
      () => {
        const i = idx();
        i.documents[0].legalReview = "waived";
        return i;
      },
    ],
    [
      "edition on a pack entry",
      () => {
        const i = idx();
        i.documents[1].edition = "2026";
        return i;
      },
    ],
    [
      "a framework entry without an edition",
      () => {
        const i = idx();
        delete i.documents[0].edition;
        return i;
      },
    ],
    [
      "selectable on a framework entry",
      () => {
        const i = idx();
        i.documents[0].selectable = true;
        return i;
      },
    ],
    [
      "a withdrawn entry without a reason",
      () => {
        const i = idx();
        i.documents[1].status = "withdrawn";
        i.documents[1].withdrawnAt = "2026-12-05";
        return i;
      },
    ],
    [
      "an unknown status",
      () => {
        const i = idx();
        i.documents[1].status = "retired";
        return i;
      },
    ],
    [
      "a legacy stamp key with a space",
      () => {
        const i = idx();
        i.legacy.stamps["rule pack"] = "2026.10.1";
        return i;
      },
    ],
    [
      "a legacy stamp value that is not a version",
      () => {
        const i = idx();
        i.legacy.stamps["2026.11.1"] = "latest";
        return i;
      },
    ],
    [
      "an index without legacy",
      () => {
        const i = idx();
        delete i.legacy;
        return i;
      },
    ],
  ];
  it.each([...documentMutations, ...indexMutations])("rejects %s", (_, make) =>
    expect(validate(make())).toBe(false),
  );
});

describe("criteria integrity rules", () => {
  it("passes the committed documents with the section 12 drafts", () => {
    const c = criteria();
    expect(checkCriteria({ ...c, validate })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  const cases: [string, string, (c: ReturnType<typeof criteria>) => void][] = [
    [
      "rule 1",
      "duplicate requirement id",
      (c) => {
        doc(c, ISO).requirements[2].id = "6.1.2";
      },
    ],
    [
      "rule 1",
      "duplicate alias",
      (c) => {
        doc(c, ISO).requirements[1].aliases = ["A"];
        doc(c, ISO).requirements[2].aliases = ["A"];
      },
    ],
    [
      "rule 2",
      "not a group of this document",
      (c) => {
        doc(c, ISO).requirements[1].parent = "8.2";
      },
    ],
    [
      "rule 2",
      "form a cycle",
      (c) => {
        const r = doc(c, ISO).requirements;
        r[0].parent = "8";
        r[3].parent = "6";
      },
    ],
    [
      "rule 2",
      "has no children",
      (c) => {
        doc(c, ISO).requirements[4].parent = "6";
      },
    ],
    [
      "rule 3",
      "replaced by",
      (c) => {
        Object.assign(doc(c, ISO).requirements[2], {
          deprecated: true,
          replacedBy: ["9.9"],
        });
      },
    ],
    [
      "rule 4",
      "two criteria sets for framework",
      (c) => {
        doc(c, NP).criteria.push({
          framework: "en-18286",
          edition: "2026",
          version: "2027.1.0",
          role: "supporting",
        });
      },
    ],
    [
      "rule 4",
      "is not an indexed framework",
      (c) => {
        doc(c, NP).criteria[0].version = "2027.2.0";
      },
    ],
    [
      "rule 4",
      "include",
      (c) => {
        doc(c, NP).criteria[1].include = ["7"];
      },
    ],
    [
      "rule 5",
      "not in the pack's criteria sets",
      (c) => {
        doc(c, NP).controlObjectives[0].addresses[0].requirement =
          "iso-iec-42001:9.9";
      },
    ],
    [
      "rule 5",
      "informative node",
      (c) => {
        doc(c, ISO).requirements[1].type = "informative";
      },
    ],
    [
      "rule 5",
      "twice with rationale",
      (c) => {
        const a = doc(c, NP).controlObjectives[0].addresses;
        a.push({ ...a[0], relationship: "intersects_with" });
      },
    ],
    [
      "rule 6",
      "duplicate item id",
      (c) => {
        doc(c, NP).items[1].id = "AIMS-S2-01";
      },
    ],
    [
      "rule 6",
      "duplicate step id",
      (c) => {
        doc(c, NP).items[0].procedures[1].id = "AIMS-S2-01-P01";
      },
    ],
    [
      "rule 6",
      "unknown objective",
      (c) => {
        doc(c, NP).items[0].objectiveIds = ["CO-NONE"];
      },
    ],
    [
      "rule 6",
      "is used by no item",
      (c) => {
        doc(c, NP).controlObjectives.push({
          ...doc(c, NP).controlObjectives[0],
          id: "CO-UNUSED",
        });
      },
    ],
    [
      "rule 6",
      "unknown phase",
      (c) => {
        doc(c, NP).items[0].phase = "stage-3";
      },
    ],
    [
      "rule 7",
      "no primary framework lists as an alias",
      (c) => {
        doc(c, NP).items[0].regulatoryRefs = ["Art.9"];
      },
    ],
    [
      "rule 8",
      "role limitationMemo",
      (c) => {
        doc(c, NP).roles.limitationMemo = "MEM-XX-01";
      },
    ],
    [
      "rule 8",
      "annexIvIndex needs",
      (c) => {
        doc(c, NP).features = { annexIvIndex: true };
      },
    ],
    [
      "rule 8",
      "AI Act features need an eu-ai-act criteria set",
      (c) => {
        doc(c, NP).features = { aiActClassification: true };
      },
    ],
    [
      "rule 8",
      "needs compat.obligations",
      (c) => {
        delete doc(c, F1).compat;
      },
    ],
    [
      "rule 9",
      "is not in iso-iec-42001",
      (c) => {
        doc(c, XISO).entries[0].sources = ["6.1.3"];
      },
    ],
    [
      "rule 9",
      "target AIA-99-9",
      (c) => {
        doc(c, XISO).entries[0].target = "AIA-99-9";
      },
    ],
    [
      "rule 9",
      "duplicate entry id",
      (c) => {
        doc(c, XISO).entries[1].id = "X1";
      },
    ],
    [
      "rule 10",
      "legal review is not completed",
      (c) => {
        doc(c, EN).licence.status = "confirmed";
        release(c, EN);
        release(c, XEN);
      },
    ],
    [
      "rule 10",
      "only with the methodology owner's and a legal reviewer's",
      (c) => {
        doc(c, EN).licence.status = "confirmed";
        release(c, EN);
        doc(c, XEN).entries[0].legalEffect.provenance.legalReview = "completed";
        release(c, XEN);
      },
    ],
    [
      "rule 12a",
      "is listed but missing",
      (c) => {
        c.documents.delete(XISO);
      },
    ],
    [
      "rule 12a",
      "is not listed in index.json",
      (c) => {
        c.index.documents = c.index.documents.filter(
          (e: Json) => e.path !== XISO,
        );
      },
    ],
    [
      "rule 12a",
      "does not match the document",
      (c) => {
        doc(c, ISO).version = "2027.1.1";
      },
    ],
    [
      "rule 12a",
      "versions must increase",
      (c) => {
        c.index.documents.push({ ...entry(c, ISO) });
      },
    ],
    [
      "rule 12a",
      "only audit programmes are selectable",
      (c) => {
        doc(c, NP).kind = "crosswalk_only";
        doc(c, NP).items = [];
        doc(c, NP).controlObjectives = [];
        doc(c, NP).crosswalks = [
          { id: "iso-iec-42001-to-eu-ai-act", version: "2027.1.0" },
        ];
      },
    ],
    [
      "rule 12b",
      "is not the JCS digest",
      (c) => {
        doc(c, P1).title = "Changed";
      },
    ],
    [
      "rule 12b",
      "unconfirmed licence cannot be released",
      (c) => {
        release(c, ISO);
      },
    ],
    [
      "rule 12b",
      "references a draft",
      (c) => {
        doc(c, ISO).licence.status = "confirmed";
        release(c, ISO);
        release(c, NP);
      },
    ],
    [
      "rule 12b",
      "defaults.pack",
      (c) => {
        c.index.defaults.pack = { id: "en18286-iso42001", version: "2027.1.0" };
      },
    ],
    [
      "rule 12b",
      "legacy: eu-ai-act-amended 2027.1.0",
      (c) => {
        c.index.legacy.stamps["2027.1.0"] = "2027.1.0";
      },
    ],
    [
      "rule 12b",
      "legacy: en18286-iso42001",
      (c) => {
        c.index.legacy.packId = "en18286-iso42001";
      },
    ],
    [
      "rule 12b",
      "records legalReview",
      (c) => {
        delete entry(c, F1).legalReview;
      },
    ],
    [
      "rule 12b",
      "needs the methodology owner's approval",
      (c) => {
        entry(c, F1).approvals = [
          { role: "legal_reviewer", by: "Counsel", at: "2026-11-06" },
        ];
        entry(c, F1).legalReview = "completed";
      },
    ],
    [
      "rule 12b",
      "two different people",
      (c) => {
        entry(c, F1).approvals.push({
          role: "legal_reviewer",
          by: " AHED-JNEED (methodology owner, by merging #27) ",
          at: "2026-11-07",
        });
        entry(c, F1).legalReview = "completed";
      },
    ],
    [
      "rule 12b",
      "only legislation frameworks record legalReview",
      (c) => {
        doc(c, ISO).licence.status = "confirmed";
        release(c, ISO);
        entry(c, ISO).legalReview = "pending";
      },
    ],
    [
      "rule 12b",
      "legal reviewer's approval belongs only",
      (c) => {
        entry(c, P1).approvals.push({
          role: "legal_reviewer",
          by: "Counsel",
          at: "2026-11-07",
        });
      },
    ],
    [
      "rule 12b",
      "same person, crosswalk with a legal effect",
      (c) => {
        doc(c, EN).licence.status = "confirmed";
        release(c, EN);
        doc(c, XEN).entries[0].legalEffect.provenance.legalReview = "completed";
        release(c, XEN);
        entry(c, XEN).approvals.push({
          role: "legal_reviewer",
          by: "owner",
          at: "2027-01-15",
        });
      },
    ],
  ];
  it.each(cases)("%s rejects: %s", (rule, message, mutate) => {
    const c = criteria();
    mutate(c);
    const found = errors(c);
    expect(found.join("\n")).toContain(
      message === "same person, crosswalk with a legal effect"
        ? "two different people"
        : message,
    );
    expect(found.some((e) => e.startsWith(rule.replace("rule", "rule")))).toBe(
      true,
    );
  });

  it("rule 3: a released id stays in later released data versions", () => {
    const c = criteria();
    const later = structuredClone(doc(c, F1));
    later.version = "2026.11.3";
    later.requirements = later.requirements.filter(
      (r: Json) => r.id !== "AIA-9-1",
    );
    later.compat.obligations.order = later.compat.obligations.order.filter(
      (code: string) => code !== "AIA-9-1",
    );
    const path = "frameworks/eu-ai-act/02024R1689-20260727/2026.11.3.json";
    c.documents.set(path, later);
    c.index.documents.splice(1, 0, {
      ...entry(c, F1),
      version: "2026.11.3",
      path,
      sha256: digest(later),
    });
    expect(errors(c).join("\n")).toContain(
      "rule 3: eu-ai-act@02024R1689-20260727: AIA-9-1 of 2026.11.2 is missing from 2026.11.3",
    );
  });

  it("rule 10: a draft legal effect is allowed", () => {
    expect(errors(criteria())).toEqual([]);
  });

  it("rule 11: reports an upstream change as a warning only", () => {
    const c = criteria();
    doc(c, NP).items[1].title = "Changed memo";
    const result = checkCriteria({ ...c, validate });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toContain("upstream changed for MEM-EX-01");
  });

  it("releases the section 12 pack once its licences are confirmed", () => {
    const c = criteria();
    for (const path of [EN, ISO]) {
      doc(c, path).licence.status = "confirmed";
      release(c, path);
    }
    release(c, NP);
    release(c, XISO);
    doc(c, XEN).entries[0].legalEffect.provenance.legalReview = "completed";
    release(c, XEN);
    entry(c, XEN).approvals.push({
      role: "legal_reviewer",
      by: "Counsel",
      at: "2027-01-16",
    });
    expect(errors(c)).toEqual([]);
  });
});

describe("rule 13: index history", () => {
  const current = () => structuredClone(readCriteria().index) as Json;
  const fwEntry = (i: Json) => i.documents[0];
  const packEntry = (i: Json) => i.documents[1];
  it("passes against a base without an index and against itself", () => {
    expect(checkHistory(null, current())).toEqual([]);
    expect(checkHistory(current(), current())).toEqual([]);
  });
  it("accepts an added stamp and a completed legal review", () => {
    const next = current();
    next.legacy.stamps["2026.12.1"] = "2026.11.2";
    fwEntry(next).approvals.push({
      role: "legal_reviewer",
      by: "Counsel",
      at: "2026-12-01",
    });
    fwEntry(next).legalReview = "completed";
    expect(checkHistory(current(), next)).toEqual([]);
  });
  const rejected: [string, (i: Json) => void, Json?][] = [
    ["a released entry removed", (i) => i.documents.splice(1, 1)],
    ["a changed digest", (i) => (packEntry(i).sha256 = "0".repeat(64))],
    [
      "a changed approval",
      (i) => (packEntry(i).approvals[0].at = "2026-11-07"),
    ],
    ["a changed release date", (i) => (packEntry(i).releasedAt = "2026-11-07")],
    [
      "a legal reviewer's approval appended to a pack",
      (i) =>
        packEntry(i).approvals.push({
          role: "legal_reviewer",
          by: "Counsel",
          at: "2026-12-01",
        }),
    ],
    [
      "a legal reviewer's approval inserted before the existing one",
      (i) => {
        fwEntry(i).approvals.unshift({
          role: "legal_reviewer",
          by: "Counsel",
          at: "2026-12-01",
        });
        fwEntry(i).legalReview = "completed";
      },
    ],
    [
      "a legal reviewer's approval dated before the release",
      (i) => {
        fwEntry(i).approvals.push({
          role: "legal_reviewer",
          by: "Counsel",
          at: "2026-11-01",
        });
        fwEntry(i).legalReview = "completed";
      },
    ],
    [
      "an approval appended without legalReview completed",
      (i) =>
        fwEntry(i).approvals.push({
          role: "legal_reviewer",
          by: "Counsel",
          at: "2026-12-01",
        }),
    ],
    [
      "legalReview completed without an approval",
      (i) => (fwEntry(i).legalReview = "completed"),
    ],
    ["a released entry back in draft", (i) => (packEntry(i).status = "draft")],
    [
      "a changed fallbackVersion",
      (i) => (i.legacy.fallbackVersion = "2026.11.3"),
    ],
    [
      "a changed stamps entry",
      (i) => (i.legacy.stamps["2026.11.1"] = "2026.11.3"),
    ],
    ["a removed stamps entry", (i) => delete i.legacy.stamps["2026.11.1"]],
  ];
  it.each(rejected)("rejects %s", (_, mutate) => {
    const next = current();
    mutate(next);
    expect(checkHistory(current(), next).length).toBeGreaterThan(0);
  });
  it("rejects a withdrawn entry back in released and completed back to pending", () => {
    const base = current();
    packEntry(base).status = "withdrawn";
    expect(checkHistory(base, current())).not.toEqual([]);
    const completed = current();
    fwEntry(completed).approvals.push({
      role: "legal_reviewer",
      by: "Counsel",
      at: "2026-12-01",
    });
    fwEntry(completed).legalReview = "completed";
    expect(checkHistory(completed, current())).not.toEqual([]);
  });
  it("fails closed on a base commit that is not present", () => {
    expect(() => baseIndex("0123456789abcdef0123456789abcdef01234567")).toThrow(
      /cannot be resolved/,
    );
  });
  // The main commit #27 branched from predates templates/criteria; a
  // shallow CI checkout may not have it.
  const before = "f6d2a8e";
  it.skipIf(
    spawnSync("git", ["cat-file", "-e", before + "^{commit}"]).status !== 0,
  )("reads a present base without an index as empty", () => {
    expect(baseIndex(before)).toBeNull();
  });
});

describe("JCS digests", () => {
  it("sorts keys and ignores whitespace and line endings", () => {
    const a = JSON.parse('{"b":[1,2.5,"x"],"a":{"d":null,"c":true}}');
    const b = JSON.parse(
      '{\r\n  "a": { "c": true, "d": null },\r\n  "b": [1, 2.50, "x"]\r\n}',
    );
    expect(canonicalize(a)).toBe('{"a":{"c":true,"d":null},"b":[1,2.5,"x"]}');
    expect(digest(a)).toBe(digest(b));
  });
  it("uses ECMAScript number and string forms", () => {
    expect(canonicalize([1e21, 0.000001, -0, "é\u0007"])).toBe(
      '[1e+21,0.000001,0,"é\\u0007"]',
    );
  });
  it("matches the digests in the index and the design's sample", () => {
    const { index, documents } = readCriteria();
    for (const e of index.documents.filter((e: Json) => e.status !== "draft"))
      expect(digest(documents.get(e.path))).toBe(e.sha256);
    expect(digest(aiActSample.documents[0])).toBe(
      aiActSample.index.documents[0].sha256,
    );
    expect(digest(aiActSample.documents[1])).toBe(
      aiActSample.index.documents[1].sha256,
    );
  });
});

describe("pre-deploy legacy check", () => {
  const c = readCriteria();
  it("resolves stamps and template ids", () => {
    const output = [
      {
        results: [
          { stamp: null, template: "WP-A09-01", engagements: 3 },
          { stamp: "2026.11.1", template: "MEM-EX-01", engagements: 1 },
          { stamp: "2026.11.2", template: "WP-XC-12", engagements: 2 },
        ],
      },
    ];
    expect(legacyCheck(c, output)).toEqual({ rows: 3, errors: [] });
  });
  it("rejects an unknown stamp and an unknown template", () => {
    const result = legacyCheck(c, [
      {
        results: [
          { stamp: "2026.12.9", template: "WP-A09-01" },
          { stamp: null, template: "WP-OLD-99" },
        ],
      },
    ]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Unknown rule-pack stamp");
  });
});

describe("methodology drift", () => {
  it("passes for the committed catalogue and obligation file", async () => {
    expect(await checkMethodologyDrift(readCriteria())).toEqual([]);
  });
  it("fails when the catalogue changes without a new pack version", async () => {
    const catalog = JSON.parse(
      readFileSync(
        new URL("../../../templates/catalog.json", import.meta.url),
        "utf8",
      ),
    );
    catalog.items[0].title = "Edited";
    const found = await checkMethodologyDrift(readCriteria(), { catalog });
    expect(found.join()).toContain("templates/catalog.json differs");
  });
});
