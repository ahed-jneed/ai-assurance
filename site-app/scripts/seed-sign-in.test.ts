// The sign-in instructions seed:demo prints (#220): dev-server persona links
// for the development server, and for a built Worker in trusted-headers mode
// the headers to send, since /signin-with-chatgpt does not exist there.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { personaHeaders, signInInstructions } from "./seed-sign-in.mjs";

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
      "http://127.0.0.1:5173/signin-with-chatgpt?" +
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
    expect(text).not.toContain("signin-with-chatgpt?");
    expect(text).toMatch(/does not work here/);
    for (const who of personas) {
      const line = lines.find((l) => l.startsWith("  " + who.id + " "));
      expect(line).toContain("oai-authenticated-user-id: " + who.userId);
      expect(line).toContain("oai-authenticated-user-email: " + who.email);
    }
    expect(text).toContain(
      `curl -H "oai-authenticated-user-id: ${personas[0].userId}" -H "oai-authenticated-user-email: ${personas[0].email}" "http://127.0.0.1:8787/api/workspace"`,
    );
    expect(text).toContain("http://127.0.0.1:8787" + deepLink);
  });

  it("prints the same identity headers the seed sends", () => {
    const sent = personaHeaders(personas[0]);
    expect(sent["oai-authenticated-user-id"]).toBe(personas[0].userId);
    expect(sent["oai-authenticated-user-email"]).toBe(personas[0].email);
  });
});
