import { describe, expect, it } from "vitest";
import { z } from "./zod";

const message = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues.map((i) => i.message);

// The API answers with these texts (zod 3's defaults); clients and tests
// match them, so the zod 4 upgrade keeps them.
describe("the app's default zod messages", () => {
  it("keeps zod 3's texts for the common issues", () => {
    expect(message(z.object({ a: z.string() }), {})).toEqual(["Required"]);
    expect(message(z.string(), 1)).toEqual([
      "Expected string, received number",
    ]);
    expect(message(z.number().int(), 1.5)).toEqual([
      "Expected integer, received float",
    ]);
    expect(message(z.literal("1.0"), "2.0")).toEqual([
      'Invalid literal value, expected "1.0"',
    ]);
    expect(message(z.enum(["a", "b"]), "c")).toEqual([
      "Invalid enum value. Expected 'a' | 'b', received 'c'",
    ]);
    expect(message(z.object({}).strict(), { x: 1, y: 2 })).toEqual([
      "Unrecognized key(s) in object: 'x', 'y'",
    ]);
    expect(message(z.string().min(1), "")).toEqual([
      "String must contain at least 1 character(s)",
    ]);
    expect(message(z.string().max(2), "abc")).toEqual([
      "String must contain at most 2 character(s)",
    ]);
    expect(message(z.array(z.string()).max(1), ["a", "b"])).toEqual([
      "Array must contain at most 1 element(s)",
    ]);
    expect(message(z.number().positive(), 0)).toEqual([
      "Number must be greater than 0",
    ]);
    expect(message(z.number().max(5), 6)).toEqual([
      "Number must be less than or equal to 5",
    ]);
    expect(message(z.string().regex(/^a$/), "b")).toEqual(["Invalid"]);
    expect(message(z.string().email(), "x")).toEqual(["Invalid email"]);
    expect(
      message(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("a") }),
          z.object({ kind: z.literal("b") }),
        ]),
        { kind: "c" },
      ),
    ).toEqual(["Invalid discriminator value. Expected 'a' | 'b'"]);
  });

  it("leaves a schema's own message in place", () => {
    expect(message(z.string().min(1, "Enter a name"), "")).toEqual([
      "Enter a name",
    ]);
    expect(message(z.enum(["a"], { error: "Choose a" }), undefined)).toEqual([
      "Choose a",
    ]);
  });
});
