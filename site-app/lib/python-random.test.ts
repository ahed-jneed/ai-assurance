import { describe, expect, it } from "vitest";
import { PythonRandom } from "./python-random";

// Reference values printed by CPython 3.11: random.Random(seed).randrange(n)
// and getrandbits(32). The cluster bootstrap of section 5.11 depends on the
// two runners drawing the same clusters from the same seed.
describe("PythonRandom", () => {
  it("reproduces random.Random(1729).randrange(40)", () => {
    const rng = new PythonRandom(1729);
    expect(Array.from({ length: 12 }, () => rng.randrange(40))).toEqual([
      2, 26, 32, 29, 10, 3, 11, 18, 33, 23, 18, 13,
    ]);
  });

  it("reproduces getrandbits(32) for seed 0", () => {
    const rng = new PythonRandom(0);
    expect([
      rng.getrandbits(32),
      rng.getrandbits(32),
      rng.getrandbits(32),
    ]).toEqual([3626764237, 1654615998, 3255389356]);
  });

  it("seeds from every 32-bit word of a large seed and from |seed|", () => {
    const big = new PythonRandom(2 ** 40 + 5);
    expect(Array.from({ length: 5 }, () => big.randrange(1000003))).toEqual([
      528881, 542031, 281652, 696042, 970757,
    ]);
    const negative = new PythonRandom(-7);
    expect([negative.randrange(1), negative.randrange(1)]).toEqual([0, 0]);
    expect(Array.from({ length: 6 }, () => negative.randrange(7))).toEqual([
      3, 5, 0, 0, 6, 4,
    ]);
  });
});
