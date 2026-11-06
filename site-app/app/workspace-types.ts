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
  /** Whether the member administers the practice. */
  practice_admin?: boolean;
  /** The engagements the member may open now (live grants only). */
  grants?: { id: string; title: string }[];
  /** Active runner workers the member sponsored. */
  sponsored_workers?: number;
};
/** A pending invitation by email into the practice. */
export type Invitation = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  client_id: string | null;
  engagement_ids: string[];
  invited_by: string;
  created_at: string;
  expires_at: string;
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
    /** Why the engagement cannot be opened now, when its record is damaged. */
    integrity_error?: string;
  }[];
  engagement: Engagement | null;
  /** Why the requested engagement is not open, when it failed to load intact. */
  engagementError?: { engagementId: string; error: string } | null;
  /** The selected engagement's stored size in bytes, for internal roles. */
  metadataBytes?: number | null;
  members: Member[];
  /** Pending invitations, for practice administrators. */
  invitations?: Invitation[];
  people: {
    user_id: string;
    display_name: string;
    role: Role;
    status: string;
    client_id: string | null;
  }[];
  managementVersion: number;
  /**
   * The practice's engagement quality review policy, for internal members:
   * the cooling-off period appointments are checked against, and whether
   * the practice set it (otherwise the default applies).
   */
  qualityReviewPolicy?: { coolingOffDays: number; practiceSet: boolean } | null;
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
