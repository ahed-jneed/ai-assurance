import { describe, expect, it } from "vitest";
import {
  isAuthPath,
  safeReturnPath,
  signInLabel,
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
    ["sign-in route", "/signin-with-chatgpt?return_to=/"],
    ["sign-out route", "/signout-with-chatgpt"],
    ["callback route", "/callback?code=x"],
  ])("falls back to / for a %s", (_, value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});

describe("sign-in and sign-out paths", () => {
  it("returns to the deep link after signing in", () => {
    const path = signInPath("/?view=Findings&engagementId=ENG-1");
    const url = new URL(path, "https://app.invalid");
    expect(url.pathname).toBe("/signin-with-chatgpt");
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
    expect(url.pathname).toBe("/signout-with-chatgpt");
    expect(url.searchParams.get("return_to")).toBe("/");
    expect(signOutPath()).toBe("/signout-with-chatgpt?return_to=%2F");
  });

  it("recognises the reserved routes", () => {
    expect(isAuthPath("/signin-with-chatgpt")).toBe(true);
    expect(isAuthPath("/callback")).toBe(true);
    expect(isAuthPath("/api/workspace")).toBe(false);
  });
});

describe("signInLabel", () => {
  it.each([
    [
      "the Sites build",
      { devServer: false, defaultMode: "sites" },
      "Sign in with ChatGPT",
    ],
    ["the development server", { devServer: true }, "Sign in with ChatGPT"],
    [
      "any other build (Cloudflare Access, trusted-headers or no mode)",
      { devServer: false },
      "Sign in",
    ],
    [
      "a build without the Sites default",
      { devServer: false, defaultMode: undefined },
      "Sign in",
    ],
  ] as const)("labels the sign-in button for %s", (_, build, label) => {
    expect(signInLabel(build)).toBe(label);
  });
});
