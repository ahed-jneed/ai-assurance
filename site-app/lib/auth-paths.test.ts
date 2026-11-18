import { describe, expect, it } from "vitest";
import {
  isAuthPath,
  safeReturnPath,
  signInPath,
  signOutPath,
} from "@/lib/auth-paths";

describe("safeReturnPath", () => {
  it("keeps a same-origin path with its query and fragment", () => {
    expect(
      safeReturnPath("/?tenantId=t-1&engagementId=ENG-1&view=Findings#f-2"),
    ).toBe("/?tenantId=t-1&engagementId=ENG-1&view=Findings#f-2");
    expect(safeReturnPath("/report?reportId=R-1")).toBe("/report?reportId=R-1");
  });

  it.each([
    ["absolute URL", "https://evil.example/"],
    ["protocol-relative URL", "//evil.example/path"],
    ["backslash host", "/\\evil.example/path"],
    ["tab-split host", "/\t/evil.example"],
    ["relative path", "dashboard"],
    ["javascript URL", "javascript:alert(1)"],
    ["empty", ""],
    ["missing", null],
    ["sign-in route", "/auth/sign-in?return_to=/"],
    ["sign-out route", "/auth/sign-out"],
  ])("falls back to / for a %s", (_, value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});

describe("sign-in and sign-out paths", () => {
  it("returns to the deep link after signing in", () => {
    const path = signInPath("/?view=Findings&engagementId=ENG-1");
    const url = new URL(path, "https://app.invalid");
    expect(url.pathname).toBe("/auth/sign-in");
    expect(url.searchParams.get("return_to")).toBe(
      "/?view=Findings&engagementId=ENG-1",
    );
    expect(url.searchParams.has("as")).toBe(false);
  });

  it("names a development persona", () => {
    const url = new URL(signInPath("/", "qa-reviewer"), "https://app.invalid");
    expect(url.searchParams.get("as")).toBe("qa-reviewer");
    expect(url.searchParams.get("return_to")).toBe("/");
    expect(() => signInPath("/", "QA reviewer&x=1")).toThrow();
  });

  it("never returns to another origin", () => {
    const url = new URL(signOutPath("//evil.example"), "https://app.invalid");
    expect(url.pathname).toBe("/auth/sign-out");
    expect(url.searchParams.get("return_to")).toBe("/");
    expect(signOutPath()).toBe("/auth/sign-out?return_to=%2F");
  });

  it("recognises the reserved routes", () => {
    expect(isAuthPath("/auth/sign-in")).toBe(true);
    expect(isAuthPath("/auth/sign-out")).toBe(true);
    expect(isAuthPath("/callback")).toBe(false);
    expect(isAuthPath("/api/workspace")).toBe(false);
  });
});
