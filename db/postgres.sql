-- SUPERSEDED v0 DESIGN (labelled 14 Nov 2026, decision D-13 in docs/product/decisions.md).
-- The platform stays on Cloudflare D1 with the engagement aggregate; the live
-- schema is site-app/db/schema.ts with the migrations in site-app/drizzle/.
-- This file was never deployed, lags the hosted model, and the RLS tests it
-- once claimed were never committed (F-78). Kept for reference only.
--
-- Initial PostgreSQL migration baseline. Apply once to an empty database using
-- a migration owner; never execute on application startup. This is a reference
-- schema, not a deployed production migration/authorization service.
-- Runtime roles must not own objects, be superusers or have BYPASSRLS.
-- Identity/membership provisioning uses a separate, narrowly audited service.
-- API sets verified context using SET LOCAL inside each transaction. Do not
-- expose arbitrary SQL or accept tenant/actor settings from an unverified user.
-- Domain commands additionally enforce workflow/visibility and column rights.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA assurance;
REVOKE ALL ON SCHEMA assurance FROM PUBLIC;
SET LOCAL search_path = assurance, pg_catalog;

CREATE FUNCTION current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('assurance.tenant_id', true), '')::uuid
$$;
CREATE FUNCTION current_actor() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('assurance.actor_id', true), '')::uuid
$$;
CREATE DOMAIN sha256_hex AS text CHECK (VALUE ~ '^[a-f0-9]{64}$');

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  region text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
  retention_policy_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE principal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
  display_name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
CREATE TABLE tenant_membership (
  tenant_id uuid NOT NULL REFERENCES tenant(id), principal_id uuid NOT NULL REFERENCES principal(id),
  role text NOT NULL CHECK(role IN ('member','administrator','owner')),
  status text NOT NULL CHECK(status IN ('active','revoked')), expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,principal_id)
);
CREATE FUNCTION active_tenant_member() RETURNS boolean LANGUAGE sql STABLE
  SET search_path = assurance, pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM tenant_membership tm
    JOIN principal p ON p.id = tm.principal_id
    JOIN tenant t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = current_tenant() AND tm.principal_id = current_actor()
      AND tm.status = 'active' AND (tm.expires_at IS NULL OR tm.expires_at > now())
      AND p.status = 'active' AND t.status = 'active')
$$;

CREATE TABLE client (
  tenant_id uuid NOT NULL REFERENCES tenant(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL, external_ref text, sector text, jurisdiction text,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,external_ref)
);
CREATE TABLE engagement (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), client_id uuid NOT NULL,
  reference text NOT NULL, title text NOT NULL, scope jsonb NOT NULL,
  audit_start date NOT NULL, audit_end date NOT NULL CHECK(audit_end >= audit_start),
  lifecycle text NOT NULL DEFAULT 'planning' CHECK(lifecycle IN ('planning','fieldwork','evidence_evaluation','reporting','signoff','closed','suspended')),
  ruleset_version text NOT NULL, template_pack_version text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1 CHECK(row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,client_id,id), UNIQUE(tenant_id,reference),
  FOREIGN KEY(tenant_id,client_id) REFERENCES client(tenant_id,id)
);
CREATE TABLE engagement_membership (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, principal_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('auditor','lead_auditor','client_viewer','reviewer')),
  status text NOT NULL CHECK(status IN ('active','revoked')), expires_at timestamptz,
  independence_attestation_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,principal_id,role),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE FUNCTION has_engagement_role(e uuid, allowed text[]) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = assurance, pg_catalog AS $$
  SELECT active_tenant_member() AND EXISTS(SELECT 1 FROM engagement_membership em
    WHERE em.tenant_id = current_tenant() AND em.engagement_id = e
      AND em.principal_id = current_actor() AND em.role = ANY(allowed)
      AND em.status = 'active' AND (em.expires_at IS NULL OR em.expires_at > now()))
$$;
CREATE FUNCTION can_read_engagement(e uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = assurance, pg_catalog AS $$
  SELECT has_engagement_role(e, ARRAY['auditor','lead_auditor','reviewer','client_viewer'])
$$;
CREATE FUNCTION can_write_engagement(e uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = assurance, pg_catalog AS $$
  SELECT has_engagement_role(e, ARRAY['auditor','lead_auditor','reviewer'])
$$;
CREATE FUNCTION can_read_internal(e uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = assurance, pg_catalog AS $$ SELECT can_write_engagement(e) $$;

CREATE TABLE independence_attestation (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL, statement jsonb NOT NULL, declared_at timestamptz NOT NULL,
  conflict_state text NOT NULL CHECK(conflict_state IN ('none_declared','safeguards_required','disqualified')),
  approved_by uuid, approved_at timestamptz, PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,approved_by) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK(approved_by IS NULL OR approved_by <> principal_id)
);
ALTER TABLE engagement_membership ADD FOREIGN KEY(tenant_id,engagement_id,independence_attestation_id)
  REFERENCES independence_attestation(tenant_id,engagement_id,id);

CREATE TABLE template_version (
  tenant_id uuid NOT NULL REFERENCES tenant(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL, version text NOT NULL, kind text NOT NULL,
  content jsonb NOT NULL, content_hash sha256_hex NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,code,version)
);
-- Public legal/test catalog rows contain no customer information. Updates create
-- a new version; pin each engagement/run. Only migrations may mutate catalogs.
CREATE TABLE control_catalog_version (
  id text NOT NULL, version text NOT NULL, legal_source_uri text NOT NULL,
  provision text NOT NULL, actor_duty text NOT NULL, effective_from date,
  criteria jsonb NOT NULL, PRIMARY KEY(id,version)
);
CREATE TABLE test_definition_version (
  id text NOT NULL, version text NOT NULL, family text NOT NULL,
  parameter_schema jsonb NOT NULL, applicability jsonb NOT NULL,
  runner_image_digest text NOT NULL, definition_hash sha256_hex NOT NULL, PRIMARY KEY(id,version)
);
CREATE TABLE system_version (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_key text NOT NULL, version text NOT NULL, intended_purpose text NOT NULL,
  actor_roles text[] NOT NULL, intended_population jsonb NOT NULL,
  deployment_context jsonb NOT NULL, system_manifest_hash sha256_hex NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,system_key,version),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id)
);
CREATE TABLE applicability_snapshot (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_version_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), ruleset_version text NOT NULL,
  route text NOT NULL CHECK(route IN ('out_of_scope','prohibited','high_risk','transparency','other_risk','needs_information')),
  answers jsonb NOT NULL, rationale text NOT NULL, duties jsonb NOT NULL,
  legal_references jsonb NOT NULL, assessment_date date NOT NULL,
  prepared_by uuid NOT NULL, reviewed_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,system_version_id,revision),
  FOREIGN KEY(tenant_id,engagement_id,system_version_id) REFERENCES system_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,prepared_by) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,reviewed_by) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by)
);

CREATE TABLE artifact (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL, original_filename text NOT NULL, mime_type text NOT NULL,
  storage_key text NOT NULL, object_version text NOT NULL, sha256 sha256_hex NOT NULL,
  byte_size bigint NOT NULL CHECK(byte_size>=0), classification text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','client_released')),
  submitted_by uuid NOT NULL, received_at timestamptz NOT NULL,
  scanner_status text NOT NULL CHECK(scanner_status IN ('clean','rejected','not_supported')),
  manifest jsonb NOT NULL, manifest_signature text NOT NULL, signing_key_version text NOT NULL,
  retention_policy_version text NOT NULL, retain_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,storage_key,object_version),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,submitted_by) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE custody_event (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL, action text NOT NULL, actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE evidence_request (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  reference text NOT NULL, description text NOT NULL, category text NOT NULL,
  status text NOT NULL CHECK(status IN ('open','submitted','accepted','returned','waived')),
  requested_by uuid NOT NULL, assigned_to uuid, due_at timestamptz,
  visibility text NOT NULL DEFAULT 'client_released' CHECK(visibility IN ('internal','client_released')),
  waiver_reason text, row_version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,reference),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,assigned_to) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK(status<>'waived' OR nullif(waiver_reason,'') IS NOT NULL)
);
CREATE TABLE evidence_submission (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL, artifact_id uuid NOT NULL, submitted_by uuid NOT NULL,
  response text NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,request_id) REFERENCES evidence_request(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,submitted_by) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE model_version (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_version_id uuid NOT NULL, artifact_id uuid NOT NULL, model_key text NOT NULL, version text NOT NULL,
  format text NOT NULL CHECK(format IN ('sklearn','xgboost','lightgbm','onnx','pmml')),
  task text NOT NULL CHECK(task IN ('binary_classification','multiclass_classification','regression','classical_nlp')),
  model_hash sha256_hex NOT NULL, metadata jsonb NOT NULL, adapter_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,model_key,version),
  FOREIGN KEY(tenant_id,engagement_id,system_version_id) REFERENCES system_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id)
);
CREATE TABLE dataset_version (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_version_id uuid NOT NULL, artifact_id uuid NOT NULL, dataset_key text NOT NULL, version text NOT NULL,
  format text NOT NULL CHECK(format IN ('csv','parquet','sql_snapshot')),
  purpose text NOT NULL CHECK(purpose IN ('training','validation','holdout','reference','current','logs')),
  dataset_hash sha256_hex NOT NULL, row_count bigint NOT NULL CHECK(row_count>=0),
  schema_manifest jsonb NOT NULL, source_manifest jsonb NOT NULL, privacy_manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,dataset_key,version),
  FOREIGN KEY(tenant_id,engagement_id,system_version_id) REFERENCES system_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id)
);
CREATE TABLE test_plan_version (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_version_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  plan jsonb NOT NULL, plan_hash sha256_hex NOT NULL, thresholds jsonb NOT NULL,
  threshold_hash sha256_hex NOT NULL, sampling_manifest jsonb NOT NULL,
  approved_by uuid NOT NULL, approved_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,system_version_id,version),
  FOREIGN KEY(tenant_id,engagement_id,system_version_id) REFERENCES system_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,approved_by) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE test_run (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL, dataset_id uuid NOT NULL, reference_dataset_id uuid, plan_id uuid NOT NULL,
  contract_version text NOT NULL DEFAULT '1.0' CHECK(contract_version='1.0'),
  frozen_request jsonb NOT NULL, request_hash sha256_hex NOT NULL, idempotency_key text NOT NULL,
  seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','validating','running','cancelling','cancelled','succeeded','failed')),
  outcome text CHECK(outcome IN ('pass','fail','inconclusive','not_applicable')),
  requested_by uuid NOT NULL, cancellation_requested_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK(fencing_token>=0), lease_owner text, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
  error_code text, error_message text, PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,idempotency_key),
  FOREIGN KEY(tenant_id,engagement_id,model_id) REFERENCES model_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,dataset_id) REFERENCES dataset_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,reference_dataset_id) REFERENCES dataset_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,plan_id) REFERENCES test_plan_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK((state IN ('queued','validating','running','cancelling') AND outcome IS NULL)
    OR (state IN ('cancelled','failed') AND outcome='inconclusive')
    OR (state='succeeded' AND outcome IS NOT NULL)),
  CHECK((state IN ('cancelled','failed','succeeded')) = (completed_at IS NOT NULL))
);
CREATE TABLE test_attempt (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL, attempt_number integer NOT NULL CHECK(attempt_number>0), fencing_token bigint NOT NULL CHECK(fencing_token>0),
  runner_version text NOT NULL, runner_image_digest text NOT NULL, input_hashes jsonb NOT NULL,
  started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL, completion text NOT NULL,
  output_manifest jsonb NOT NULL, output_hash sha256_hex NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,run_id,attempt_number),
  UNIQUE(tenant_id,engagement_id,run_id,fencing_token), UNIQUE(tenant_id,engagement_id,run_id,id),
  FOREIGN KEY(tenant_id,engagement_id,run_id) REFERENCES test_run(tenant_id,engagement_id,id),
  CHECK(completed_at>=started_at)
);
CREATE TABLE test_result (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL, attempt_id uuid NOT NULL, test_id text NOT NULL, test_version text NOT NULL,
  metric_name text NOT NULL, slice_key sha256_hex NOT NULL, metric jsonb NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('pass','fail','inconclusive','not_applicable')),
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,run_id,test_id,metric_name,slice_key),
  FOREIGN KEY(tenant_id,engagement_id,run_id,attempt_id) REFERENCES test_attempt(tenant_id,engagement_id,run_id,id),
  FOREIGN KEY(test_id,test_version) REFERENCES test_definition_version(id,version)
);
CREATE TABLE outbox_event (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
  deduplication_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), lease_owner text, lease_expires_at timestamptz,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,deduplication_key),
  FOREIGN KEY(tenant_id,engagement_id,run_id) REFERENCES test_run(tenant_id,engagement_id,id)
);

CREATE TABLE working_paper (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  reference text NOT NULL, title text NOT NULL, template_id uuid NOT NULL,
  stage text NOT NULL, kind text NOT NULL, draft_content jsonb NOT NULL,
  draft_dirty boolean NOT NULL DEFAULT true,
  current_revision_id uuid, generated_from_run_id uuid,
  visibility text NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','client_released')),
  row_version bigint NOT NULL DEFAULT 1, assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,reference), UNIQUE(tenant_id,engagement_id,generated_from_run_id,template_id),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,template_id) REFERENCES template_version(tenant_id,id),
  FOREIGN KEY(tenant_id,engagement_id,generated_from_run_id) REFERENCES test_run(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,assigned_to) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE paper_revision (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), parent_revision_id uuid,
  content jsonb NOT NULL, content_hash sha256_hex NOT NULL, schema_version text NOT NULL DEFAULT '1.0',
  visibility text NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','client_released')),
  prepared_by uuid NOT NULL, frozen_at timestamptz NOT NULL DEFAULT now(), change_reason text NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,paper_id,revision),
  UNIQUE(tenant_id,engagement_id,paper_id,id),
  FOREIGN KEY(tenant_id,engagement_id,paper_id) REFERENCES working_paper(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,paper_id,parent_revision_id) REFERENCES paper_revision(tenant_id,engagement_id,paper_id,id),
  FOREIGN KEY(tenant_id,prepared_by) REFERENCES tenant_membership(tenant_id,principal_id)
);
ALTER TABLE working_paper ADD FOREIGN KEY(tenant_id,engagement_id,id,current_revision_id)
  REFERENCES paper_revision(tenant_id,engagement_id,paper_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE paper_evidence (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, revision_id uuid NOT NULL, artifact_id uuid NOT NULL,
  evidence_hash sha256_hex NOT NULL, locator text, relevance text NOT NULL, reliability text NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,revision_id,artifact_id),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id)
);
CREATE TABLE paper_run (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, revision_id uuid NOT NULL, run_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,revision_id,run_id),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,run_id) REFERENCES test_run(tenant_id,engagement_id,id)
);
CREATE TABLE review (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL, reviewer_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('approved','changes_required','rejected')),
  rationale text NOT NULL, independence_attestation_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,reviewer_id) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,engagement_id,independence_attestation_id) REFERENCES independence_attestation(tenant_id,engagement_id,id)
);
CREATE TABLE review_comment (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL, section_locator text NOT NULL, body text NOT NULL,
  blocking boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,review_id) REFERENCES review(tenant_id,engagement_id,id)
);
CREATE TABLE comment_resolution (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL, resolved_by uuid NOT NULL, response text NOT NULL,
  accepted_by uuid NOT NULL, accepted_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,comment_id),
  FOREIGN KEY(tenant_id,engagement_id,comment_id) REFERENCES review_comment(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,resolved_by) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,accepted_by) REFERENCES tenant_membership(tenant_id,principal_id), CHECK(resolved_by<>accepted_by)
);
CREATE TABLE signoff (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL, revision_hash sha256_hex NOT NULL,
  signer_id uuid NOT NULL, purpose text NOT NULL CHECK(purpose IN ('reviewer','lead_auditor')),
  review_id uuid NOT NULL, signature text NOT NULL, signing_key_version text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,revision_id,signer_id,purpose),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,signer_id) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,engagement_id,review_id) REFERENCES review(tenant_id,engagement_id,id)
);
CREATE TABLE signoff_revocation (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, signoff_id uuid NOT NULL,
  revoked_by uuid NOT NULL, reason text NOT NULL, revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,signoff_id),
  FOREIGN KEY(tenant_id,engagement_id,signoff_id) REFERENCES signoff(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,revoked_by) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE VIEW effective_signoff WITH (security_invoker=true) AS
  SELECT s.* FROM signoff s JOIN paper_revision r ON (r.tenant_id,r.engagement_id,r.id)=(s.tenant_id,s.engagement_id,s.revision_id)
  JOIN working_paper p ON (p.tenant_id,p.engagement_id,p.id)=(r.tenant_id,r.engagement_id,r.paper_id)
  WHERE p.current_revision_id=s.revision_id AND NOT p.draft_dirty AND s.revision_hash=r.content_hash
    AND NOT EXISTS(SELECT 1 FROM signoff_revocation v WHERE (v.tenant_id,v.engagement_id,v.signoff_id)=(s.tenant_id,s.engagement_id,s.id));

CREATE TABLE control_assessment (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  system_version_id uuid NOT NULL, applicability_id uuid NOT NULL,
  control_id text NOT NULL, control_version text NOT NULL, actor_duty text NOT NULL,
  state text NOT NULL CHECK(state IN ('not_started','evidence_requested','in_progress','ready_for_review','satisfied','partially_satisfied','not_satisfied','not_applicable','unable_to_conclude')),
  rationale text NOT NULL, revision_id uuid, concluded_by uuid, concluded_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,engagement_id,id),
  UNIQUE(tenant_id,engagement_id,system_version_id,control_id,control_version,actor_duty),
  FOREIGN KEY(tenant_id,engagement_id,system_version_id) REFERENCES system_version(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,applicability_id) REFERENCES applicability_snapshot(tenant_id,engagement_id,id),
  FOREIGN KEY(control_id,control_version) REFERENCES control_catalog_version(id,version),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,concluded_by) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK(state NOT IN ('satisfied','partially_satisfied','not_satisfied','not_applicable','unable_to_conclude')
    OR (concluded_by IS NOT NULL AND concluded_at IS NOT NULL AND revision_id IS NOT NULL AND length(rationale)>0))
);
CREATE TABLE finding (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  reference text NOT NULL, title text NOT NULL, condition text NOT NULL, criteria jsonb NOT NULL,
  cause text NOT NULL, consequence text NOT NULL, likelihood integer NOT NULL CHECK(likelihood BETWEEN 1 AND 5),
  impact integer NOT NULL CHECK(impact BETWEEN 1 AND 5), score integer GENERATED ALWAYS AS (likelihood*impact) STORED,
  severity text NOT NULL CHECK(severity IN ('critical','high','medium','low','observation')),
  recommendation text NOT NULL, status text NOT NULL CHECK(status IN ('draft','open','response_received','remediation_planned','remediation_in_progress','ready_for_retest','retest_failed','closed_verified','risk_accepted','disputed','withdrawn')),
  owner_id uuid, due_at timestamptz, management_response text, disposition_reason text,
  source_revision_id uuid, visibility text NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','client_released')),
  row_version bigint NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,reference),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,engagement_id,source_revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  CHECK(status NOT IN ('risk_accepted','withdrawn') OR nullif(disposition_reason,'') IS NOT NULL)
);
CREATE TABLE finding_event (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL, from_state text NOT NULL, to_state text NOT NULL, actor_id uuid NOT NULL,
  reason text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,finding_id) REFERENCES finding(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE remediation (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL, action text NOT NULL, owner_id uuid NOT NULL,
  due_at timestamptz NOT NULL, completed_at timestamptz, evidence_artifact_id uuid,
  status text NOT NULL CHECK(status IN ('planned','in_progress','submitted','rejected','verified')),
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,finding_id) REFERENCES finding(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,engagement_id,evidence_artifact_id) REFERENCES artifact(tenant_id,engagement_id,id)
);
CREATE TABLE retest (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  remediation_id uuid NOT NULL, reviewer_id uuid NOT NULL, run_id uuid, revision_id uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('effective','ineffective','inconclusive')), rationale text NOT NULL,
  completed_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,remediation_id) REFERENCES remediation(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,reviewer_id) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,engagement_id,run_id) REFERENCES test_run(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id)
);
CREATE TABLE report (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK(version>0), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued')),
  visibility text NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','client_released')),
  scope_snapshot jsonb NOT NULL, findings_snapshot jsonb NOT NULL, limitations jsonb NOT NULL,
  applicability_id uuid NOT NULL, report_artifact_id uuid, manifest jsonb NOT NULL,
  manifest_hash sha256_hex NOT NULL, manifest_signature text, signing_key_version text,
  issued_by uuid, issued_at timestamptz, PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,version),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,engagement_id,applicability_id) REFERENCES applicability_snapshot(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,report_artifact_id) REFERENCES artifact(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,issued_by) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK(status<>'issued' OR (report_artifact_id IS NOT NULL AND manifest_signature IS NOT NULL AND signing_key_version IS NOT NULL AND issued_by IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE TABLE report_paper (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, report_id uuid NOT NULL, revision_id uuid NOT NULL,
  revision_hash sha256_hex NOT NULL, PRIMARY KEY(tenant_id,engagement_id,report_id,revision_id),
  FOREIGN KEY(tenant_id,engagement_id,report_id) REFERENCES report(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id)
);
CREATE TABLE report_event (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('released','superseded','withdrawn')),
  successor_report_id uuid, actor_id uuid NOT NULL, reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,report_id) REFERENCES report(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,successor_report_id) REFERENCES report(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK((action='superseded')=(successor_report_id IS NOT NULL)), CHECK(successor_report_id IS NULL OR successor_report_id<>report_id)
);
CREATE TABLE resource_release (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid, revision_id uuid, report_id uuid, released_by uuid NOT NULL,
  reason text NOT NULL, release_projection_hash sha256_hex NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,revision_id) REFERENCES paper_revision(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id,report_id) REFERENCES report(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,released_by) REFERENCES tenant_membership(tenant_id,principal_id),
  CHECK(num_nonnulls(artifact_id,revision_id,report_id)=1)
);
CREATE TABLE release_revocation (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, release_id uuid NOT NULL,
  revoked_by uuid NOT NULL, reason text NOT NULL, revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,release_id),
  FOREIGN KEY(tenant_id,engagement_id,release_id) REFERENCES resource_release(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,revoked_by) REFERENCES tenant_membership(tenant_id,principal_id)
);

CREATE TABLE legal_hold (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid, reason text NOT NULL, authority text NOT NULL, placed_by uuid NOT NULL,
  approved_by uuid NOT NULL, placed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,placed_by) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,approved_by) REFERENCES tenant_membership(tenant_id,principal_id), CHECK(approved_by<>placed_by)
);
CREATE TABLE legal_hold_release (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, hold_id uuid NOT NULL,
  reason text NOT NULL, released_by uuid NOT NULL, approved_by uuid NOT NULL, released_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,hold_id),
  FOREIGN KEY(tenant_id,engagement_id,hold_id) REFERENCES legal_hold(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,released_by) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,approved_by) REFERENCES tenant_membership(tenant_id,principal_id), CHECK(released_by<>approved_by)
);
CREATE TABLE destruction_receipt (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL, former_hash sha256_hex NOT NULL, reason text NOT NULL,
  requested_by uuid NOT NULL, approved_by uuid NOT NULL, destroyed_at timestamptz NOT NULL,
  receipt_signature text NOT NULL, PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,artifact_id),
  FOREIGN KEY(tenant_id,engagement_id,artifact_id) REFERENCES artifact(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_membership(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,approved_by) REFERENCES tenant_membership(tenant_id,principal_id), CHECK(approved_by<>requested_by)
);
CREATE TABLE audit_event (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  sequence bigint NOT NULL CHECK(sequence>0), actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
  request_id text NOT NULL, action text NOT NULL, object_type text NOT NULL, object_id text NOT NULL,
  canonical_payload text NOT NULL, previous_hash sha256_hex, event_hash sha256_hex NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id), UNIQUE(tenant_id,engagement_id,sequence),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_membership(tenant_id,principal_id)
);
CREATE TABLE audit_anchor (
  tenant_id uuid NOT NULL, engagement_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  first_sequence bigint NOT NULL, last_sequence bigint NOT NULL, root_hash sha256_hex NOT NULL,
  external_receipt jsonb NOT NULL, anchored_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,engagement_id,id),
  FOREIGN KEY(tenant_id,engagement_id) REFERENCES engagement(tenant_id,id), CHECK(last_sequence>=first_sequence)
);

-- Integrity guards. Content hashes/signatures use a canonical format defined by
-- the signing service; hash columns alone do not verify the claimed payload.
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only record; create a new version or disposition event'; END $$;
CREATE FUNCTION guard_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.model_id,NEW.dataset_id,NEW.reference_dataset_id,NEW.plan_id,NEW.frozen_request,NEW.request_hash,NEW.seed,NEW.idempotency_key,NEW.requested_by)
    IS DISTINCT FROM (OLD.model_id,OLD.dataset_id,OLD.reference_dataset_id,OLD.plan_id,OLD.frozen_request,OLD.request_hash,OLD.seed,OLD.idempotency_key,OLD.requested_by)
    THEN RAISE EXCEPTION 'run input snapshot is frozen'; END IF;
  IF OLD.state IN ('cancelled','failed','succeeded') THEN RAISE EXCEPTION 'terminal run is immutable'; END IF;
  IF NEW.fencing_token<OLD.fencing_token THEN RAISE EXCEPTION 'fencing token cannot decrease'; END IF;
  IF NEW.state<>OLD.state AND NOT (
    (OLD.state='queued' AND NEW.state IN ('validating','cancelling','failed')) OR
    (OLD.state='validating' AND NEW.state IN ('running','cancelling','failed')) OR
    (OLD.state='running' AND NEW.state IN ('succeeded','failed','cancelling')) OR
    (OLD.state='cancelling' AND NEW.state IN ('cancelled','failed')))
    THEN RAISE EXCEPTION 'invalid run transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_run BEFORE UPDATE ON test_run FOR EACH ROW EXECUTE FUNCTION guard_run_update();

CREATE FUNCTION guard_paper_update() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE old_number integer; new_number integer;
BEGIN
  IF NEW.template_id IS DISTINCT FROM OLD.template_id THEN RAISE EXCEPTION 'template version is fixed; create a new paper'; END IF;
  IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id THEN
    IF NEW.current_revision_id IS NULL THEN RAISE EXCEPTION 'cannot discard frozen revision pointer'; END IF;
    SELECT revision INTO old_number FROM paper_revision WHERE (tenant_id,engagement_id,id)=(OLD.tenant_id,OLD.engagement_id,OLD.current_revision_id);
    SELECT revision INTO new_number FROM paper_revision WHERE (tenant_id,engagement_id,paper_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.id,NEW.current_revision_id);
    IF new_number IS NULL OR new_number<=coalesce(old_number,0) THEN RAISE EXCEPTION 'new frozen revision must advance; rollback requires a new revision'; END IF;
    -- Freeze command verifies canonical content/draft and sets draft_dirty=false.
  ELSE
    IF (NEW.draft_content,NEW.title) IS DISTINCT FROM (OLD.draft_content,OLD.title) THEN NEW.draft_dirty=true; END IF;
    IF OLD.draft_dirty AND NOT NEW.draft_dirty THEN RAISE EXCEPTION 'publish a new frozen revision to clear pending edits'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_paper_update BEFORE UPDATE ON working_paper FOR EACH ROW EXECUTE FUNCTION guard_paper_update();

CREATE FUNCTION guard_review() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE author uuid; current_rev uuid; dirty boolean; att independence_attestation%ROWTYPE;
BEGIN
  SELECT r.prepared_by,p.current_revision_id,p.draft_dirty INTO author,current_rev,dirty FROM paper_revision r
    JOIN working_paper p ON (p.tenant_id,p.engagement_id,p.id)=(r.tenant_id,r.engagement_id,r.paper_id)
    WHERE (r.tenant_id,r.engagement_id,r.id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id) FOR UPDATE OF p;
  IF author=NEW.reviewer_id OR current_rev IS DISTINCT FROM NEW.revision_id OR dirty THEN RAISE EXCEPTION 'review requires current clean revision and independent reviewer'; END IF;
  IF EXISTS(SELECT 1 FROM paper_revision prior JOIN paper_revision target
    ON (prior.tenant_id,prior.engagement_id,prior.paper_id)=(target.tenant_id,target.engagement_id,target.paper_id)
    WHERE (target.tenant_id,target.engagement_id,target.id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id)
      AND prior.prepared_by=NEW.reviewer_id) THEN RAISE EXCEPTION 'a prior preparer of this paper cannot act as independent reviewer'; END IF;
  IF NEW.reviewer_id IS DISTINCT FROM current_actor() OR NOT has_engagement_role(NEW.engagement_id,ARRAY['reviewer']) THEN RAISE EXCEPTION 'reviewer role required'; END IF;
  SELECT * INTO att FROM independence_attestation WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.independence_attestation_id);
  IF NOT FOUND OR att.principal_id<>NEW.reviewer_id OR att.conflict_state='disqualified' OR
    (att.conflict_state='safeguards_required' AND att.approved_by IS NULL) THEN RAISE EXCEPTION 'reviewer independence not approved'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_review BEFORE INSERT ON review FOR EACH ROW EXECUTE FUNCTION guard_review();

CREATE FUNCTION guard_signoff() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE r paper_revision%ROWTYPE; current_rev uuid; dirty boolean; v review%ROWTYPE;
BEGIN
  SELECT * INTO r FROM paper_revision WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id);
  SELECT current_revision_id,draft_dirty INTO current_rev,dirty FROM working_paper WHERE (tenant_id,engagement_id,id)=(r.tenant_id,r.engagement_id,r.paper_id) FOR UPDATE;
  SELECT * INTO v FROM review WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.review_id);
  IF current_rev IS DISTINCT FROM NEW.revision_id OR r.content_hash IS DISTINCT FROM NEW.revision_hash OR dirty THEN RAISE EXCEPTION 'signature must bind current clean revision hash'; END IF;
  IF v.revision_id IS DISTINCT FROM NEW.revision_id OR v.decision IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'approved review required'; END IF;
  IF NEW.signer_id IS DISTINCT FROM current_actor() OR NOT has_engagement_role(NEW.engagement_id,ARRAY[NEW.purpose]) THEN RAISE EXCEPTION 'signer role required'; END IF;
  IF NEW.purpose='reviewer' AND (NEW.signer_id=r.prepared_by OR NEW.signer_id<>v.reviewer_id) THEN RAISE EXCEPTION 'independent approving reviewer required'; END IF;
  IF EXISTS(SELECT 1 FROM review_comment c WHERE (c.tenant_id,c.engagement_id,c.review_id)=(v.tenant_id,v.engagement_id,v.id) AND c.blocking
    AND NOT EXISTS(SELECT 1 FROM comment_resolution cr WHERE (cr.tenant_id,cr.engagement_id,cr.comment_id)=(c.tenant_id,c.engagement_id,c.id))) THEN RAISE EXCEPTION 'unresolved blocking review notes'; END IF;
  IF NEW.purpose='lead_auditor' AND NOT EXISTS(SELECT 1 FROM effective_signoff s
    WHERE (s.tenant_id,s.engagement_id,s.revision_id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id)
    AND s.purpose='reviewer' AND s.signer_id<>NEW.signer_id) THEN RAISE EXCEPTION 'separate reviewer signoff required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_signoff BEFORE INSERT ON signoff FOR EACH ROW EXECUTE FUNCTION guard_signoff();

CREATE FUNCTION guard_revision_attachment() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE parent uuid; actual_hash sha256_hex;
BEGIN
  SELECT paper_id INTO parent FROM paper_revision WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id);
  PERFORM 1 FROM working_paper WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,parent) FOR UPDATE;
  IF EXISTS(SELECT 1 FROM review WHERE (tenant_id,engagement_id,revision_id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id)) OR
     EXISTS(SELECT 1 FROM signoff WHERE (tenant_id,engagement_id,revision_id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id)) THEN RAISE EXCEPTION 'reviewed revision attachments are frozen; publish a new revision'; END IF;
  IF TG_TABLE_NAME='paper_evidence' THEN
    SELECT sha256 INTO actual_hash FROM artifact WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.artifact_id);
    IF NEW.evidence_hash IS DISTINCT FROM actual_hash THEN RAISE EXCEPTION 'paper evidence hash does not match artifact'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_paper_evidence BEFORE INSERT ON paper_evidence FOR EACH ROW EXECUTE FUNCTION guard_revision_attachment();
CREATE TRIGGER guard_paper_run BEFORE INSERT ON paper_run FOR EACH ROW EXECUTE FUNCTION guard_revision_attachment();
CREATE FUNCTION guard_review_comment() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE revision uuid; parent uuid;
BEGIN
  SELECT revision_id INTO revision FROM review WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.review_id);
  SELECT paper_id INTO parent FROM paper_revision WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,revision);
  PERFORM 1 FROM working_paper WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,parent) FOR UPDATE;
  IF EXISTS(SELECT 1 FROM signoff WHERE (tenant_id,engagement_id,revision_id)=(NEW.tenant_id,NEW.engagement_id,revision)) THEN RAISE EXCEPTION 'reopen signed work before adding a review comment'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_review_comment BEFORE INSERT ON review_comment FOR EACH ROW EXECUTE FUNCTION guard_review_comment();

CREATE FUNCTION guard_retest() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM remediation WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.remediation_id);
  IF NEW.reviewer_id=owner OR NEW.reviewer_id IS DISTINCT FROM current_actor() OR NOT has_engagement_role(NEW.engagement_id,ARRAY['reviewer']) THEN RAISE EXCEPTION 'independent remediation retest required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_retest BEFORE INSERT ON retest FOR EACH ROW EXECUTE FUNCTION guard_retest();
CREATE FUNCTION guard_finding_close() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
BEGIN
  IF NEW.status='closed_verified' AND OLD.status<>'closed_verified' THEN
    IF OLD.status<>'ready_for_retest' OR NOT has_engagement_role(NEW.engagement_id,ARRAY['reviewer']) THEN RAISE EXCEPTION 'independent reviewer must close a finding ready for retest'; END IF;
    IF NOT EXISTS(SELECT 1 FROM remediation m WHERE (m.tenant_id,m.engagement_id,m.finding_id)=(NEW.tenant_id,NEW.engagement_id,NEW.id)) THEN RAISE EXCEPTION 'closure requires remediation'; END IF;
    IF EXISTS(SELECT 1 FROM remediation m WHERE (m.tenant_id,m.engagement_id,m.finding_id)=(NEW.tenant_id,NEW.engagement_id,NEW.id)
      AND (m.status<>'verified' OR (SELECT rt.outcome FROM retest rt WHERE (rt.tenant_id,rt.engagement_id,rt.remediation_id)=(m.tenant_id,m.engagement_id,m.id) ORDER BY rt.completed_at DESC,rt.id DESC LIMIT 1) IS DISTINCT FROM 'effective')) THEN RAISE EXCEPTION 'closure requires current effective retest of every remediation'; END IF;
  END IF;
  IF NEW.status IN ('risk_accepted','withdrawn') AND NEW.status<>OLD.status AND NOT has_engagement_role(NEW.engagement_id,ARRAY['lead_auditor']) THEN RAISE EXCEPTION 'lead disposition approval required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_finding_close BEFORE UPDATE ON finding FOR EACH ROW EXECUTE FUNCTION guard_finding_close();

CREATE FUNCTION guard_report() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status='issued') THEN RAISE EXCEPTION 'report cannot be deleted/changed after issue'; END IF;
  IF NEW.status='issued' THEN
    IF NEW.issued_by IS DISTINCT FROM current_actor() OR NOT has_engagement_role(NEW.engagement_id,ARRAY['lead_auditor']) THEN RAISE EXCEPTION 'lead issuance required'; END IF;
    IF NOT EXISTS(SELECT 1 FROM report_paper rp WHERE (rp.tenant_id,rp.engagement_id,rp.report_id)=(NEW.tenant_id,NEW.engagement_id,NEW.id)) THEN RAISE EXCEPTION 'report requires paper snapshot'; END IF;
    IF EXISTS(SELECT 1 FROM report_paper rp WHERE (rp.tenant_id,rp.engagement_id,rp.report_id)=(NEW.tenant_id,NEW.engagement_id,NEW.id)
      AND (NOT EXISTS(SELECT 1 FROM effective_signoff s WHERE (s.tenant_id,s.engagement_id,s.revision_id)=(rp.tenant_id,rp.engagement_id,rp.revision_id) AND s.revision_hash=rp.revision_hash AND s.purpose='reviewer' AND s.signer_id<>NEW.issued_by)
      OR NOT EXISTS(SELECT 1 FROM effective_signoff s WHERE (s.tenant_id,s.engagement_id,s.revision_id)=(rp.tenant_id,rp.engagement_id,rp.revision_id) AND s.revision_hash=rp.revision_hash AND s.purpose='lead_auditor'))) THEN RAISE EXCEPTION 'report contains unapproved or stale revision'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_report BEFORE INSERT OR UPDATE OR DELETE ON report FOR EACH ROW EXECUTE FUNCTION guard_report();
CREATE FUNCTION guard_report_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE report_state text;
BEGIN
  SELECT status INTO report_state FROM report WHERE (tenant_id,engagement_id,id)=(NEW.tenant_id,NEW.engagement_id,NEW.report_id) FOR UPDATE;
  IF report_state<>'draft' THEN RAISE EXCEPTION 'issued report snapshot is frozen'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_report_snapshot BEFORE INSERT ON report_paper FOR EACH ROW EXECUTE FUNCTION guard_report_snapshot();

CREATE FUNCTION has_release(e uuid, resource uuid, kind text) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=assurance,pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM resource_release rr WHERE rr.tenant_id=current_tenant() AND rr.engagement_id=e
    AND CASE kind WHEN 'artifact' THEN rr.artifact_id=resource WHEN 'paper_revision' THEN rr.revision_id=resource WHEN 'report' THEN rr.report_id=resource ELSE false END
    AND NOT EXISTS(SELECT 1 FROM release_revocation rv WHERE (rv.tenant_id,rv.engagement_id,rv.release_id)=(rr.tenant_id,rr.engagement_id,rr.id)))
$$;
CREATE FUNCTION guard_release() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
BEGIN
  IF NEW.released_by IS DISTINCT FROM current_actor() OR NOT has_engagement_role(NEW.engagement_id,ARRAY['lead_auditor']) THEN RAISE EXCEPTION 'lead release approval required'; END IF;
  IF NEW.revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM effective_signoff s WHERE (s.tenant_id,s.engagement_id,s.revision_id)=(NEW.tenant_id,NEW.engagement_id,NEW.revision_id) AND s.purpose='lead_auditor') THEN RAISE EXCEPTION 'only signed paper revisions can be released'; END IF;
  IF NEW.report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM report r WHERE (r.tenant_id,r.engagement_id,r.id)=(NEW.tenant_id,NEW.engagement_id,NEW.report_id) AND r.status='issued') THEN RAISE EXCEPTION 'only issued reports can be released'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_release BEFORE INSERT ON resource_release FOR EACH ROW EXECUTE FUNCTION guard_release();

CREATE FUNCTION guard_audit_chain() RETURNS trigger LANGUAGE plpgsql SET search_path=assurance,pg_catalog AS $$
DECLARE head audit_event%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.engagement_id::text,0));
  SELECT * INTO head FROM audit_event WHERE tenant_id=NEW.tenant_id AND engagement_id=NEW.engagement_id ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence<>coalesce(head.sequence,0)+1 OR NEW.previous_hash IS DISTINCT FROM head.event_hash THEN RAISE EXCEPTION 'audit chain sequence/head mismatch'; END IF;
  IF NEW.event_hash<>encode(public.digest(convert_to(NEW.canonical_payload,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'audit event hash mismatch'; END IF;
  -- Signing/anchor service MUST check that canonical_payload encodes every
  -- displayed column and previous_hash. SQL only verifies the submitted bytes.
  RETURN NEW;
END $$;
CREATE TRIGGER guard_audit_chain BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION guard_audit_chain();

-- Protect tenant/scope keys from changes, even on mutable workflow tables.
CREATE FUNCTION guard_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.engagement_id<>OLD.engagement_id OR (to_jsonb(NEW)->'id') IS DISTINCT FROM (to_jsonb(OLD)->'id') THEN RAISE EXCEPTION 'record identity and scope are immutable'; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['system_version','applicability_snapshot','artifact','custody_event','evidence_request','evidence_submission','model_version','dataset_version','test_plan_version','test_run','test_attempt','test_result','outbox_event','working_paper','paper_revision','paper_evidence','paper_run','review','review_comment','comment_resolution','signoff','signoff_revocation','control_assessment','finding','finding_event','remediation','retest','report','report_paper','report_event','resource_release','release_revocation','legal_hold','legal_hold_release','destruction_receipt','audit_event','audit_anchor','independence_attestation','engagement_membership'] LOOP
    EXECUTE format('CREATE TRIGGER scope_immutable BEFORE UPDATE ON assurance.%I FOR EACH ROW EXECUTE FUNCTION assurance.guard_scope()',n);
  END LOOP;
  FOREACH n IN ARRAY ARRAY['template_version','system_version','applicability_snapshot','artifact','custody_event','evidence_submission','model_version','dataset_version','test_plan_version','test_attempt','test_result','paper_revision','paper_evidence','paper_run','review','review_comment','comment_resolution','signoff','signoff_revocation','finding_event','retest','report_paper','report_event','resource_release','release_revocation','legal_hold','legal_hold_release','destruction_receipt','audit_event','audit_anchor','independence_attestation'] LOOP
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON assurance.%I FOR EACH ROW EXECUTE FUNCTION assurance.reject_mutation()',n);
  END LOOP;
END $$;

-- RLS: membership tables allow the actor to see only their own assignments.
-- Narrow membership-management commands run in the provisioning service; the
-- general API has no insert/update/delete membership grants or policies.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant FOR SELECT USING(id=current_tenant());
ALTER TABLE principal ENABLE ROW LEVEL SECURITY; ALTER TABLE principal FORCE ROW LEVEL SECURITY;
CREATE POLICY principal_self ON principal FOR SELECT USING(id=current_actor());
ALTER TABLE tenant_membership ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_self ON tenant_membership FOR SELECT USING(tenant_id=current_tenant() AND principal_id=current_actor());
ALTER TABLE engagement_membership ENABLE ROW LEVEL SECURITY; ALTER TABLE engagement_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY assignment_self ON engagement_membership FOR SELECT USING(tenant_id=current_tenant() AND principal_id=current_actor());
ALTER TABLE client ENABLE ROW LEVEL SECURITY; ALTER TABLE client FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scope ON client FOR SELECT USING(tenant_id=current_tenant() AND EXISTS(SELECT 1 FROM engagement e WHERE e.tenant_id=client.tenant_id AND e.client_id=client.id AND can_read_engagement(e.id)));
ALTER TABLE engagement ENABLE ROW LEVEL SECURITY; ALTER TABLE engagement FORCE ROW LEVEL SECURITY;
CREATE POLICY engagement_read ON engagement FOR SELECT USING(tenant_id=current_tenant() AND can_read_engagement(id));
CREATE POLICY engagement_update ON engagement FOR UPDATE USING(tenant_id=current_tenant() AND has_engagement_role(id,ARRAY['lead_auditor'])) WITH CHECK(tenant_id=current_tenant() AND has_engagement_role(id,ARRAY['lead_auditor']));
ALTER TABLE template_version ENABLE ROW LEVEL SECURITY; ALTER TABLE template_version FORCE ROW LEVEL SECURITY;
CREATE POLICY template_read ON template_version FOR SELECT USING(tenant_id=current_tenant() AND active_tenant_member());

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['system_version','applicability_snapshot','custody_event','evidence_submission','model_version','dataset_version','test_plan_version','test_run','test_attempt','test_result','outbox_event','paper_evidence','paper_run','review','review_comment','comment_resolution','signoff','signoff_revocation','control_assessment','finding_event','remediation','retest','report_paper','report_event','legal_hold','legal_hold_release','destruction_receipt','audit_event','audit_anchor','independence_attestation'] LOOP
    EXECUTE format('ALTER TABLE assurance.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE assurance.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('CREATE POLICY internal_read ON assurance.%I FOR SELECT USING(tenant_id=assurance.current_tenant() AND assurance.can_read_internal(engagement_id))',n);
    EXECUTE format('CREATE POLICY scoped_insert ON assurance.%I FOR INSERT WITH CHECK(tenant_id=assurance.current_tenant() AND assurance.can_write_engagement(engagement_id))',n);
    EXECUTE format('CREATE POLICY scoped_update ON assurance.%I FOR UPDATE USING(tenant_id=assurance.current_tenant() AND assurance.can_write_engagement(engagement_id)) WITH CHECK(tenant_id=assurance.current_tenant() AND assurance.can_write_engagement(engagement_id))',n);
  END LOOP;
  FOREACH n IN ARRAY ARRAY['artifact','evidence_request','working_paper','paper_revision','finding','report'] LOOP
    EXECUTE format('ALTER TABLE assurance.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE assurance.%I FORCE ROW LEVEL SECURITY',n);
    IF n IN ('artifact','paper_revision','report') THEN
      EXECUTE format('CREATE POLICY released_read ON assurance.%I FOR SELECT USING(tenant_id=assurance.current_tenant() AND (assurance.can_read_internal(engagement_id) OR (assurance.has_release(engagement_id,id,%L) AND assurance.can_read_engagement(engagement_id))))',n,n);
    ELSIF n='working_paper' THEN
      -- Draft content is never client-readable; serve released frozen revisions.
      EXECUTE format('CREATE POLICY internal_read ON assurance.%I FOR SELECT USING(tenant_id=assurance.current_tenant() AND assurance.can_read_internal(engagement_id))',n);
    ELSE
      EXECUTE format('CREATE POLICY released_read ON assurance.%I FOR SELECT USING(tenant_id=assurance.current_tenant() AND (assurance.can_read_internal(engagement_id) OR (visibility=''client_released'' AND assurance.can_read_engagement(engagement_id))))',n);
    END IF;
    EXECUTE format('CREATE POLICY scoped_insert ON assurance.%I FOR INSERT WITH CHECK(tenant_id=assurance.current_tenant() AND assurance.can_write_engagement(engagement_id))',n);
    EXECUTE format('CREATE POLICY scoped_update ON assurance.%I FOR UPDATE USING(tenant_id=assurance.current_tenant() AND assurance.can_write_engagement(engagement_id)) WITH CHECK(tenant_id=assurance.current_tenant() AND assurance.can_write_engagement(engagement_id))',n);
  END LOOP;
END $$;
DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['resource_release','release_revocation'] LOOP
    EXECUTE format('ALTER TABLE assurance.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE assurance.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('CREATE POLICY release_read ON assurance.%I FOR SELECT USING(tenant_id=assurance.current_tenant() AND assurance.can_read_engagement(engagement_id))',n);
    EXECUTE format('CREATE POLICY release_insert ON assurance.%I FOR INSERT WITH CHECK(tenant_id=assurance.current_tenant() AND assurance.has_engagement_role(engagement_id,ARRAY[''lead_auditor'']))',n);
  END LOOP;
END $$;

-- Only issued reports are available to client viewers, regardless of visibility.
CREATE POLICY issued_only ON report AS RESTRICTIVE FOR SELECT
  USING(can_read_internal(engagement_id) OR status='issued');
-- Catalogs are non-sensitive and immutable by runtime grant design.
REVOKE ALL ON ALL TABLES IN SCHEMA assurance FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA assurance FROM PUBLIC;

-- Suggested runtime group role bootstrap, executed separately by DBA:
-- CREATE ROLE assurance_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
-- GRANT USAGE ON SCHEMA assurance TO assurance_api;
-- GRANT EXECUTE ON FUNCTION assurance.current_tenant(), assurance.current_actor(),
--   assurance.active_tenant_member(), assurance.has_engagement_role(uuid,text[]),
--   assurance.can_read_engagement(uuid), assurance.can_write_engagement(uuid),
--   assurance.can_read_internal(uuid), assurance.has_release(uuid,uuid,text) TO assurance_api;
-- GRANT SELECT ON ALL TABLES IN SCHEMA assurance TO assurance_api;
-- Grant INSERT/UPDATE only to command-specific tables/procedures. Never grant
-- DELETE/TRUNCATE, catalog/membership writes, DDL, tenant-context bypass, or
-- signing-key access. Client submissions have a separate audited command.
-- Service identities receive explicit tenant/engagement assignments; a worker
-- cannot obtain cross-tenant SELECT simply because it is a service.

CREATE INDEX engagement_client_idx ON engagement(tenant_id,client_id);
CREATE INDEX membership_actor_idx ON engagement_membership(tenant_id,principal_id,engagement_id);
CREATE INDEX artifact_category_idx ON artifact(tenant_id,engagement_id,category);
CREATE INDEX artifact_retention_idx ON artifact(tenant_id,retain_until);
CREATE INDEX paper_stage_idx ON working_paper(tenant_id,engagement_id,stage);
CREATE INDEX finding_state_due_idx ON finding(tenant_id,engagement_id,status,due_at);
CREATE INDEX evidence_request_due_idx ON evidence_request(tenant_id,engagement_id,status,due_at);
CREATE INDEX run_state_lease_idx ON test_run(tenant_id,state,lease_expires_at);
CREATE INDEX outbox_pending_idx ON outbox_event(available_at) WHERE dispatched_at IS NULL;
CREATE INDEX review_revision_idx ON review(tenant_id,engagement_id,revision_id,reviewed_at);
CREATE INDEX audit_sequence_idx ON audit_event(tenant_id,engagement_id,sequence DESC);
COMMIT;

-- Production command implementations still required (see roadmap):
-- 1. Create tenant/client/engagement + first authorized lead atomically via a
--    narrow identity/provisioning path; do not weaken RLS to bootstrap through API.
-- 2. Freeze revision/evidence/run links as one transaction; require current
--    row_version; hash/sign canonical content. Lock current papers during report
--    issuance so concurrent revision changes cannot race the approval check.
-- 3. Claim/renew/complete run using expected state + fencing token + lease expiry;
--    validate model/dataset/plan system version and signed input hashes. The FK
--    guarantees engagement scope, not semantic population compatibility.
-- 4. Finding close only after current, independent effective retest of every
--    accepted remediation; bind expected state and finding_event atomically.
-- 5. Outbox delivery must not change payload after dispatch. Store result acceptance
--    exactly once and reject stale/cancelled attempts in a transaction.
-- 6. Retention service must verify no active engagement/artifact hold, retention
--    expiry, dual approval and object-store lock before destruction. Keep a
--    minimized tombstone/receipt, not a secretly recoverable raw evidence copy.
-- 7. Validate signatures in KMS-backed application service; never treat these
--    text columns or INTERNAL sha256 as a digital-signature implementation.
