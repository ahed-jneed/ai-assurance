import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkResearch,
  libraryBand,
  loadInputs,
  loadValidator,
  mutations,
} from "../../schemas/validate-art50-research.mjs";

// The Art 50 research check of schemas/validate-art50-research.mjs (CI runs
// it too, #120): schema 1.1.0, references, catalogue links and the
// statistical criteria against the threshold library (A50-ED-40).
const validate = loadValidator();
const local = (file: string) => fileURLToPath(new URL(file, import.meta.url));

describe("Art 50 research check", () => {
  it("accepts the canonical research file", () => {
    expect(checkResearch({ ...loadInputs(), validate })).toEqual([]);
  });

  it("accepts it against the copies the Site imports", () => {
    const inputs = loadInputs({
      library: local("./threshold-library.json"),
      catalog: local("./catalog.json"),
    });
    expect(checkResearch({ ...inputs, validate })).toEqual([]);
  });

  it.each(mutations as [string, (r: Record<string, unknown>) => void][])(
    "rejects research with %s",
    (_, mutate) => {
      const inputs = loadInputs();
      const research = structuredClone(inputs.research);
      mutate(research);
      expect(checkResearch({ ...inputs, research, validate })).not.toEqual([]);
    },
  );

  it("derives a declared-rate band from the declared value and tolerance", () => {
    expect(
      libraryBand({ band: "lower" }, { declaredValue: 0.97, tolerance: 0.02 }),
    ).toEqual({ lower: 0.95 });
    expect(
      libraryBand(
        { band: "upper" },
        { declaredValue: 0.005, tolerance: 0.005 },
      ),
    ).toEqual({ upper: 0.01 });
    expect(libraryBand({ band: "lower" }, { lower: 0.98 })).toEqual({
      lower: 0.98,
    });
  });
});
