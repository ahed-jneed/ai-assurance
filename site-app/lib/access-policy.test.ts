import { describe, expect, it } from "vitest";
import { selfSignupAllowed, tenantQuotas } from "./access-policy";

// Both helpers take the Worker variables as their last argument, so these
// tests pass plain objects and never read the real environment.

describe("selfSignupAllowed", () => {
  describe("when SELF_SIGNUP is unset or empty", () => {
    it("allows sign-up on the development server", () => {
      expect(selfSignupAllowed("a@example.com", { IDENTITY_MODE: "dev" })).toBe(
        true,
      );
      expect(
        selfSignupAllowed("a@example.com", {
          IDENTITY_MODE: "dev",
          SELF_SIGNUP: "",
        }),
      ).toBe(true);
    });

    it("refuses sign-up when the mode is unset or anything else", () => {
      expect(selfSignupAllowed("a@example.com", {})).toBe(false);
      expect(selfSignupAllowed("a@example.com", { SELF_SIGNUP: "" })).toBe(
        false,
      );
      expect(
        selfSignupAllowed("a@example.com", {
          IDENTITY_MODE: "trusted-headers",
        }),
      ).toBe(false);
      expect(
        selfSignupAllowed("a@example.com", {
          IDENTITY_MODE: "cloudflare-access",
        }),
      ).toBe(false);
    });
  });

  it.each(["open", "OPEN", " Open "])("%j allows everyone", (setting) => {
    expect(selfSignupAllowed("a@example.com", { SELF_SIGNUP: setting })).toBe(
      true,
    );
  });

  it.each(["off", "OFF", " Off "])(
    "%j refuses everyone, on the development server too",
    (setting) => {
      expect(
        selfSignupAllowed("a@example.com", {
          IDENTITY_MODE: "dev",
          SELF_SIGNUP: setting,
        }),
      ).toBe(false);
    },
  );

  it("allows a listed full address and refuses another", () => {
    const config = { SELF_SIGNUP: "owner@example.com,second@example.com" };
    expect(selfSignupAllowed("owner@example.com", config)).toBe(true);
    expect(selfSignupAllowed("second@example.com", config)).toBe(true);
    expect(selfSignupAllowed("other@example.com", config)).toBe(false);
  });

  it("allows any address at a listed @domain", () => {
    const config = { SELF_SIGNUP: "@example.com" };
    expect(selfSignupAllowed("anyone@example.com", config)).toBe(true);
    expect(selfSignupAllowed("anyone@example.org", config)).toBe(false);
  });

  it("compares the address without regard to letter case or spaces", () => {
    const config = { SELF_SIGNUP: "Owner@Example.com,@Example.org" };
    expect(selfSignupAllowed("  OWNER@example.COM ", config)).toBe(true);
    expect(selfSignupAllowed(" Someone@EXAMPLE.ORG", config)).toBe(true);
  });

  it("reads a mixed list with spaces and empty entries", () => {
    const config = { SELF_SIGNUP: "a@example.com, ,@example.org" };
    expect(selfSignupAllowed("a@example.com", config)).toBe(true);
    expect(selfSignupAllowed("b@example.org", config)).toBe(true);
    expect(selfSignupAllowed("b@example.com", config)).toBe(false);
  });

  it("refuses a look-alike domain", () => {
    const config = { SELF_SIGNUP: "@example.com" };
    expect(selfSignupAllowed("someone@notexample.com", config)).toBe(false);
  });

  it("does not allow a longer address that merely ends with a listed one", () => {
    const config = { SELF_SIGNUP: "owner@example.com" };
    expect(selfSignupAllowed("notowner@example.com", config)).toBe(false);
    expect(selfSignupAllowed("x.owner@example.com", config)).toBe(false);
  });
});

describe("tenantQuotas", () => {
  it("uses the defaults when nothing is set", () => {
    expect(tenantQuotas({})).toEqual({ engagements: 200, savesPerHour: 1000 });
  });

  it("uses valid positive whole numbers", () => {
    expect(
      tenantQuotas({
        TENANT_MAX_ENGAGEMENTS: "5",
        TENANT_MAX_SAVES_PER_HOUR: "50",
      }),
    ).toEqual({ engagements: 5, savesPerHour: 50 });
  });

  it.each(["0", "-3", "2.5", "", "many"])(
    "falls back to the defaults for %j",
    (value) => {
      expect(
        tenantQuotas({
          TENANT_MAX_ENGAGEMENTS: value,
          TENANT_MAX_SAVES_PER_HOUR: value,
        }),
      ).toEqual({ engagements: 200, savesPerHour: 1000 });
    },
  );

  it("falls back for each setting on its own", () => {
    expect(
      tenantQuotas({
        TENANT_MAX_ENGAGEMENTS: "5",
        TENANT_MAX_SAVES_PER_HOUR: "many",
      }),
    ).toEqual({ engagements: 5, savesPerHour: 1000 });
    expect(
      tenantQuotas({
        TENANT_MAX_ENGAGEMENTS: "0",
        TENANT_MAX_SAVES_PER_HOUR: "50",
      }),
    ).toEqual({ engagements: 200, savesPerHour: 50 });
  });
});
