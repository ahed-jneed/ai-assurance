// The sign-in instructions seed:demo prints (#220): dev-server persona links
// for the development server, and for a built Worker in trusted-headers mode
// the headers to send, since /auth/sign-in does not exist there.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  personaHeaders,
  refusalHint,
  signInInstructions,
} from "./seed-sign-in.mjs";

const { personas } = JSON.parse(
  readFileSync(
    new URL("../fixtures/dev-personas.json", import.meta.url),
    "utf8",
  ),
) as {
  personas: {
    id: string;
    userId: string;
    email: string;
    name: string;
    role?: string | null;
  }[];
};
const deepLink = "/?view=Overview&practice=t-1&engagement=ENG-1";

describe("seed:demo sign-in instructions", () => {
  it("prints a dev-server persona link per persona in dev mode", () => {
    const lines = signInInstructions({
      base: "http://127.0.0.1:5173",
      personas,
      trustedHeaders: false,
      deepLink,
    });
    expect(lines[0]).toMatch(/loopback development server/);
    expect(lines).toHaveLength(personas.length + 1);
    expect(lines[1]).toContain(
      "http://127.0.0.1:5173/auth/sign-in?" +
        new URLSearchParams({ as: personas[0].id, return_to: deepLink }),
    );
  });

  it("prints the headers to send, not dev-server links, in trusted-headers mode", () => {
    const lines = signInInstructions({
      base: "http://127.0.0.1:8787",
      personas,
      trustedHeaders: true,
      deepLink,
    });
    const text = lines.join("\n");
    // The only mention of the dev route says it does not work here.
    expect(text).not.toContain("/auth/sign-in?");
    expect(text).toMatch(/does not work here/);
    for (const who of personas) {
      const line = lines.find((l) => l.startsWith("  " + who.id + " "));
      expect(line).toContain("x-assurance-user-id: " + who.userId);
      expect(line).toContain("x-assurance-user-email: " + who.email);
    }
    expect(text).toContain(
      `curl -H "x-assurance-user-id: ${personas[0].userId}" -H "x-assurance-user-email: ${personas[0].email}" "http://127.0.0.1:8787/api/workspace"`,
    );
    expect(text).toContain("http://127.0.0.1:8787" + deepLink);
  });

  it("names SELF_SIGNUP when a trusted-headers Worker has no membership for the persona", () => {
    const refusal = {
      status: 403,
      error:
        "You have no practice membership or pending invitation. Ask a practice administrator to invite qa-lead@personas.test.",
      trustedHeaders: true,
      email: "qa-lead@personas.test",
    };
    expect(refusalHint(refusal)).toBe(
      "Start the Worker with --var SELF_SIGNUP:open (or --var SELF_SIGNUP:@personas.test, the persona domain) so the personas may provision their practices, then run seed:demo again.",
    );
    // Other refusals, and the dev server's persona sign-in, add nothing.
    expect(refusalHint({ ...refusal, trustedHeaders: false })).toBeNull();
    expect(refusalHint({ ...refusal, status: 409 })).toBeNull();
    expect(refusalHint({ ...refusal, error: "Forbidden" })).toBeNull();
  });

  it("prints the same identity headers the seed sends", () => {
    const sent = personaHeaders(personas[0]);
    expect(sent["x-assurance-user-id"]).toBe(personas[0].userId);
    expect(sent["x-assurance-user-email"]).toBe(personas[0].email);
  });
});
