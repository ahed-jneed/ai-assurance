// How seed:demo (scripts/seed-demo.mjs) identifies a persona and how it tells
// you to sign in as one afterwards. The development server signs a persona in
// through /signin-with-chatgpt?as=<id>; a built Worker in trusted-headers mode
// (npm start, docs/security/identity.md) has no such route and trusts the
// oai-authenticated-user-* headers instead, so the seed prints those (#220).

/**
 * The trusted-headers identity of a persona from fixtures/dev-personas.json:
 * the headers seed:demo sends, and the ones to send yourself afterwards.
 * @param {{ userId: string, email: string, name: string }} who
 * @returns {Record<string, string>}
 */
export function personaHeaders(who) {
  return {
    "oai-authenticated-user-id": who.userId,
    "oai-authenticated-user-email": who.email,
    "oai-authenticated-user-full-name": encodeURIComponent(who.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

/**
 * The lines seed:demo prints to sign in as each persona on `base`.
 * @param {{
 *   base: string,
 *   personas: { id: string, userId: string, email: string, name: string, role?: string | null }[],
 *   trustedHeaders: boolean,
 *   deepLink: string,
 * }} options `deepLink` is the workspace path a persona with a role opens.
 * @returns {string[]}
 */
export function signInInstructions({
  base,
  personas,
  trustedHeaders,
  deepLink,
}) {
  const label = (who) =>
    `  ${who.id.padEnd(12)} ${(who.role ?? "none").padEnd(28)} `;
  if (!trustedHeaders)
    return [
      "Sign in as a persona (loopback development server):",
      ...personas.map(
        (who) =>
          label(who) +
          `${base}/signin-with-chatgpt?${new URLSearchParams({
            as: who.id,
            return_to: who.role ? deepLink : "/",
          })}`,
      ),
    ];
  const curl = (who) =>
    "curl " +
    Object.entries(personaHeaders(who))
      .slice(0, 2)
      .map(([name, value]) => `-H "${name}: ${value}" `)
      .join("") +
    `"${base}/api/workspace"`;
  return [
    "Sign in as a persona (built Worker in trusted-headers mode):",
    "  /signin-with-chatgpt is a development-server route and does not work here.",
    "  Send the persona's oai-authenticated-user-id and -email headers with every",
    "  request (a browser needs a header-setting extension), for example",
    `  ${curl(personas[0])}`,
    `  and open ${base}${deepLink} for the seeded engagement.`,
    ...personas.map(
      (who) =>
        label(who) +
        `oai-authenticated-user-id: ${who.userId}; oai-authenticated-user-email: ${who.email}`,
    ),
  ];
}

/**
 * What to do when a request of seed:demo is refused (#226 item 7): a built
 * Worker in trusted-headers mode that answers 403 "no practice membership"
 * does not let the personas provision their practices, so the seed names the
 * SELF_SIGNUP setting to start it with. Null when there is nothing to add.
 * @param {{ status: number, error: string, trustedHeaders: boolean, email: string }} refusal
 *   `email` is the address of the persona that was refused.
 * @returns {string | null}
 */
export function refusalHint({ status, error, trustedHeaders, email }) {
  if (
    !trustedHeaders ||
    status !== 403 ||
    !/no practice membership/.test(error)
  )
    return null;
  const domain = email.slice(email.lastIndexOf("@"));
  return `Start the Worker with --var SELF_SIGNUP:open (or --var SELF_SIGNUP:${domain}, the persona domain) so the personas may provision their practices, then run seed:demo again.`;
}
