import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  foreignKey,
  index,
} from "drizzle-orm/sqlite-core";
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  version: integer("version").notNull().default(1),
  lastCommandId: text("last_command_id").notNull().default("init"),
});
export const memberships = sqliteTable(
  "memberships",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    clientId: text("client_id"),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);
export const managementEvents = sqliteTable(
  "management_events",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    details: text("details").notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const clients = sqliteTable(
  "clients",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    sector: text("sector").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const engagements = sqliteTable(
  "engagements",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id").notNull(),
    clientId: text("client_id").notNull(),
    title: text("title").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    lastCommandId: text("last_command_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    index("idx_engagements_client").on(t.tenantId, t.clientId),
  ],
);
export const snapshots = sqliteTable(
  "engagement_snapshots",
  {
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.engagementId, t.version] }),
    foreignKey({
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [engagements.tenantId, engagements.id],
    }),
  ],
);
export const events = sqliteTable(
  "audit_events",
  {
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    id: text("id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    previousHash: text("previous_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull(),
    details: text("details").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [engagements.tenantId, engagements.id],
    }),
    index("idx_events_engagement").on(t.tenantId, t.engagementId),
  ],
);
export const assuranceRecords = sqliteTable(
  "assurance_records",
  {
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: text("created_at").notNull(),
    actor: text("actor").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.engagementId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [engagements.tenantId, engagements.id],
    }),
    index("idx_assurance_kind").on(
      t.tenantId,
      t.engagementId,
      t.kind,
      t.createdAt,
    ),
  ],
);
export const engagementAccess = sqliteTable(
  "engagement_access",
  {
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    userId: text("user_id").notNull(),
    active: integer("active").notNull().default(1),
    actor: text("actor").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.engagementId, t.userId] }),
    foreignKey({
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [engagements.tenantId, engagements.id],
    }),
  ],
);
export const accessPolicies = sqliteTable(
  "engagement_access_policies",
  {
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.engagementId] })],
);
export const practiceAdmins = sqliteTable(
  "practice_admins",
  {
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    active: integer("active").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);
export const runnerWorkers = sqliteTable(
  "runner_workers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    imageDigest: text("image_digest").notNull(),
    capabilities: text("capabilities").notNull(),
    active: integer("active").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeen: text("last_seen"),
  },
  (t) => [index("idx_worker_token").on(t.tokenHash)],
);
export const executionJobs = sqliteTable(
  "execution_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    state: text("state").notNull(),
    request: text("request").notNull(),
    requestSha256: text("request_sha256").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    workerId: text("worker_id"),
    attemptId: text("attempt_id"),
    fence: integer("fence").notNull().default(0),
    nonce: text("nonce"),
    leaseUntil: text("lease_until"),
    resultKey: text("result_key"),
    resultSha256: text("result_sha256"),
    error: text("error"),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("idx_jobs_scope_state").on(
      t.tenantId,
      t.engagementId,
      t.state,
      t.createdAt,
    ),
  ],
);
export const executionAttempts = sqliteTable(
  "execution_attempts",
  {
    jobId: text("job_id").notNull(),
    fence: integer("fence").notNull(),
    id: text("id").notNull(),
    workerId: text("worker_id").notNull(),
    state: text("state").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    details: text("details").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.fence] })],
);
export const dossierKeys = sqliteTable(
  "dossier_keys",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    privateKey: text("private_key").notNull(),
    publicKey: text("public_key").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
export const personalPreferences = sqliteTable(
  "personal_preferences",
  {
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);
export const workspaceDrafts = sqliteTable(
  "workspace_drafts",
  {
    tenantId: text("tenant_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    recordId: text("record_id").notNull(),
    baseRevision: text("base_revision").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.engagementId, t.userId, t.kind, t.recordId],
    }),
    foreignKey({
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [engagements.tenantId, engagements.id],
    }),
  ],
);
