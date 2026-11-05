import type { Engagement, Role } from "@/lib/domain";
export type CatalogItem = {
  id: string;
  title: string;
  kind: string;
  stage: string;
  folder: string;
  objective: string;
  procedures: { id: string; text: string }[];
  regulatoryRefs: string[];
  evidenceRequired: string[];
  automationMode: string;
};
export type Client = { id: string; name: string; sector: string };
export type Member = {
  user_id: string;
  display_name: string;
  role: Role;
  client_id: string | null;
  status: "active" | "revoked";
};
export type WorkspaceData = {
  identity: { id: string; name: string; role: Role; practiceAdmin?: boolean };
  tenantId: string;
  memberships: { tenant_id: string; name: string; role: Role }[];
  clients: Client[];
  engagements: {
    id: string;
    title: string;
    client_id: string;
    stage: string;
    due_date: string;
  }[];
  engagement: Engagement | null;
  members: Member[];
  people: {
    user_id: string;
    display_name: string;
    role: Role;
    status: string;
    client_id: string | null;
  }[];
  managementVersion: number;
  managementEvents: {
    id: string;
    action: string;
    actor: string;
    created_at: string;
    hash: string;
    details: string;
  }[];
  events: {
    id: string;
    action: string;
    created_at: string;
    actor: string;
    hash: string;
    previous_hash: string;
    details: string;
  }[];
  catalog: {
    methodologyVersion?: string;
    items: CatalogItem[];
    /** The rule pack (lib/rule-pack.ts asRulePack); empty without one. */
    regulatorySnapshot: Record<string, unknown>;
  } | null;
};
