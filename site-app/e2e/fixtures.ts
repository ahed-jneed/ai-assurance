// Shared fixtures for the persona suite: one browser context per persona, an
// API client per persona for setup steps that are not the subject of a spec,
// and the ids of the demo practice that `npm run seed:demo` created.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

export { expect };

export type PersonaId =
  | "qa-lead"
  | "qa-auditor"
  | "qa-reviewer"
  | "qa-lead2"
  | "qa-contrib"
  | "qa-viewer"
  | "qa-outsider";
export type Persona = {
  id: PersonaId;
  userId: string;
  email: string;
  name: string;
  role: string | null;
};
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/dev-personas.json", import.meta.url),
    "utf8",
  ),
) as { personas: Persona[] };

export function persona(id: PersonaId): Persona {
  const found = fixture.personas.find((p) => p.id === id);
  if (!found) throw new Error("Unknown persona " + id);
  return found;
}

/**
 * The identity headers the Worker trusts in trusted-headers mode
 * (docs/security/identity.md); scripts/seed-demo.mjs sends the same.
 */
export function identityHeaders(who: Persona): Record<string, string> {
  return {
    "oai-authenticated-user-id": who.userId,
    "oai-authenticated-user-email": who.email,
    "oai-authenticated-user-full-name": encodeURIComponent(who.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

/** The practice provisioned at a persona's first sign-in (lib/tenancy.ts). */
export function ownPractice(who: Persona): string {
  return (
    "tenant-" +
    createHash("sha256").update(who.userId).digest("hex").slice(0, 24)
  );
}

export const DEMO = {
  client: "Acme",
  engagement: "Acme credit scoring model audit",
  paperTemplate: "WP-A10-01",
  request: "Training data lineage and representativeness",
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- read models are untyped JSON here */
export type Workspace = any;

/** A persona's API client: the same calls the workspace UI makes. */
export class Api {
  constructor(
    readonly who: Persona,
    readonly http: APIRequestContext,
    readonly baseURL: string,
  ) {}

  async workspace(tenantId?: string, engagementId?: string) {
    const query = new URLSearchParams();
    if (tenantId) query.set("tenantId", tenantId);
    if (engagementId) query.set("engagementId", engagementId);
    const response = await this.http.get("/api/workspace?" + query);
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as Workspace;
  }

  /** A raw POST, for checks that expect a refusal. */
  post(path: string, body: unknown) {
    return this.http.post(path, {
      data: body,
      headers: { Origin: this.baseURL },
    });
  }

  /** Runs an engagement command at the current version and returns its details. */
  async command(
    tenantId: string,
    engagementId: string,
    op: string,
    data: Record<string, unknown> = {},
  ) {
    const w = await this.workspace(tenantId, engagementId);
    const response = await this.post("/api/workspace", {
      tenantId,
      engagementId,
      expectedVersion: w.engagement.version,
      op,
      data,
    });
    expect(response.status(), `${op}: ${await response.text()}`).toBe(200);
    return (await response.json()).details as Record<string, any>;
  }

  /** Uploads a small evidence file through /api/evidence. */
  async uploadEvidence(
    tenantId: string,
    engagementId: string,
    name: string,
    content: string,
    category = "Governance",
    visibility: "internal" | "client" = "internal",
  ) {
    const w = await this.workspace(tenantId, engagementId);
    const response = await this.http.post("/api/evidence", {
      headers: { Origin: this.baseURL },
      multipart: {
        tenantId,
        engagementId,
        expectedVersion: String(w.engagement.version),
        category,
        handlingBasis: "synthetic",
        visibility,
        file: { name, mimeType: "text/plain", buffer: Buffer.from(content) },
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { artifactId: string; sha256: string };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type Demo = {
  tenantId: string;
  clientId: string;
  engagementId: string;
};

type Fixtures = {
  /** A signed-in page for the persona, in its own browser context. */
  signIn: (id: PersonaId) => Promise<Page>;
  /** An API client for the persona. */
  api: (id: PersonaId) => Promise<Api>;
  demo: Demo;
};

async function newApi(id: PersonaId, baseURL: string) {
  const who = persona(id);
  const http = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: identityHeaders(who),
  });
  return new Api(who, http, baseURL);
}

async function newPersonaPage(browser: Browser, id: PersonaId, url: string) {
  const context = await browser.newContext({
    baseURL: url,
    extraHTTPHeaders: identityHeaders(persona(id)),
    locale: "en-GB",
    timezoneId: "UTC",
  });
  return { context, page: await context.newPage() };
}

export const test = base.extend<Fixtures>({
  signIn: async ({ browser, baseURL }, provide) => {
    const contexts: { close(): Promise<void> }[] = [];
    await provide(async (id) => {
      const { context, page } = await newPersonaPage(browser, id, baseURL!);
      contexts.push(context);
      return page;
    });
    for (const context of contexts) await context.close();
  },
  api: async ({ baseURL }, provide) => {
    const clients: Api[] = [];
    await provide(async (id) => {
      const client = await newApi(id, baseURL!);
      clients.push(client);
      return client;
    });
    for (const client of clients) await client.http.dispose();
  },
  demo: async ({ baseURL }, provide) => {
    const lead = await newApi("qa-lead", baseURL!);
    const tenantId = ownPractice(lead.who);
    const w = await lead.workspace(tenantId);
    const client = w.clients.find(
      (c: { name: string }) => c.name === DEMO.client,
    );
    const engagement = w.engagements.find(
      (e: { title: string; client_id: string }) =>
        e.title === DEMO.engagement && e.client_id === client?.id,
    );
    await lead.http.dispose();
    expect(client, "run the seed project first").toBeTruthy();
    expect(engagement, "run the seed project first").toBeTruthy();
    await provide({
      tenantId,
      clientId: client.id,
      engagementId: engagement.id,
    });
  },
});

/** The workspace URL of a view of the demo engagement. */
export function workspacePath(demo: Demo, view: string) {
  return (
    "/?" +
    new URLSearchParams({
      practice: demo.tenantId,
      engagement: demo.engagementId,
      view,
    })
  );
}

/** The deep link that opens a working paper (lib/workspace-links.ts). */
export function paperPath(demo: Demo, paperId: string) {
  return (
    workspacePath(demo, "Working papers") +
    "&" +
    new URLSearchParams({ kind: "paper", record: paperId })
  );
}

/** Picks an option of a Radix select (components/ui/select.tsx). */
export async function choose(scope: Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label }).click();
  await scope.page().getByRole("option", { name: option, exact: true }).click();
}

/** A suffix that keeps records created by different runs apart. */
export function unique() {
  return Date.now().toString(36);
}
