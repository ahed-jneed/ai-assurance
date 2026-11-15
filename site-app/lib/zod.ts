import { z, ZodError } from "zod";

/**
 * The app's zod. Import `z` from here, never from "zod" directly: this module
 * keeps the default validation messages the API has always answered with
 * (zod 3's English texts, such as "Required" or "String must contain at most
 * 300 character(s)"), which clients and tests rely on. Messages a schema sets
 * itself still win over these defaults.
 */
type RawIssue = z.core.$ZodRawIssue;

const joinValues = (values: readonly unknown[], separator = " | ") =>
  values
    .map((v) => (typeof v === "string" ? `'${v}'` : String(v)))
    .join(separator);

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

/** zod 3's name for the type of a received value. */
function parsedType(value: unknown): string {
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "number":
      return Number.isNaN(value) ? "nan" : "number";
    case "object":
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      if (value instanceof Map) return "map";
      if (value instanceof Set) return "set";
      if (value instanceof Date) return "date";
      if (
        typeof (value as { then?: unknown }).then === "function" &&
        typeof (value as { catch?: unknown }).catch === "function"
      )
        return "promise";
      return "object";
    default:
      return typeof value;
  }
}

const bound = (value: unknown) =>
  typeof value === "bigint" ? value.toString() : String(value);

function tooSmall(iss: Extract<RawIssue, { code: "too_small" }>) {
  const { origin, minimum, inclusive, exact } = iss;
  if (origin === "array")
    return `Array must contain ${exact ? "exactly" : inclusive ? "at least" : "more than"} ${bound(minimum)} element(s)`;
  if (origin === "string")
    return `String must contain ${exact ? "exactly" : inclusive ? "at least" : "over"} ${bound(minimum)} character(s)`;
  if (origin === "number" || origin === "int" || origin === "bigint")
    return `Number must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${bound(minimum)}`;
  if (origin === "date")
    return `Date must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(minimum))}`;
  return "Invalid input";
}

function tooBig(iss: Extract<RawIssue, { code: "too_big" }>) {
  const { origin, maximum, inclusive, exact } = iss;
  if (origin === "array")
    return `Array must contain ${exact ? "exactly" : inclusive ? "at most" : "less than"} ${bound(maximum)} element(s)`;
  if (origin === "string")
    return `String must contain ${exact ? "exactly" : inclusive ? "at most" : "under"} ${bound(maximum)} character(s)`;
  if (origin === "number" || origin === "int")
    return `Number must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${bound(maximum)}`;
  if (origin === "bigint")
    return `BigInt must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${bound(maximum)}`;
  if (origin === "date")
    return `Date must be ${exact ? "exactly" : inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(maximum))}`;
  return "Invalid input";
}

/** zod 3's default English message for an issue, or undefined for zod 4's. */
export function zod3Message(iss: RawIssue): string | undefined {
  switch (iss.code) {
    case "invalid_type": {
      if (iss.input === undefined) return "Required";
      const received = parsedType(iss.input);
      if (iss.expected === "int")
        return `Expected integer, received ${received === "number" ? "float" : received}`;
      return `Expected ${iss.expected}, received ${received}`;
    }
    case "invalid_value":
      if (iss.inst instanceof z.ZodLiteral && iss.values.length === 1)
        return `Invalid literal value, expected ${stringify(iss.values[0])}`;
      return `Invalid enum value. Expected ${joinValues(iss.values)}, received '${String(iss.input)}'`;
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${joinValues(iss.keys, ", ")}`;
    case "invalid_union":
      if ("note" in iss && iss.note === "No matching discriminator") {
        const options = (iss as { options?: unknown[] }).options ?? [];
        return `Invalid discriminator value. Expected ${joinValues(options)}`;
      }
      return "Invalid input";
    case "invalid_format":
      switch (iss.format) {
        case "regex":
          return "Invalid";
        case "starts_with":
          return `Invalid input: must start with "${(iss as { prefix?: string }).prefix}"`;
        case "ends_with":
          return `Invalid input: must end with "${(iss as { suffix?: string }).suffix}"`;
        case "includes":
          return `Invalid input: must include "${(iss as { includes?: string }).includes}"`;
        default:
          return `Invalid ${iss.format}`;
      }
    case "too_small":
      return tooSmall(iss);
    case "too_big":
      return tooBig(iss);
    case "not_multiple_of":
      return `Number must be a multiple of ${bound(iss.divisor)}`;
    case "invalid_key":
    case "invalid_element":
      // zod 3 reported the key's or element's own issue.
      return iss.issues[0]?.message;
    case "custom":
      return "Invalid input";
    default:
      return undefined;
  }
}

z.config({ customError: zod3Message });

export { z, ZodError };
