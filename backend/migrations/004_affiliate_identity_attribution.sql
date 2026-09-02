BEGIN;

CREATE TABLE affiliate_principal (
    principal_ref text PRIMARY KEY CHECK (principal_ref ~ '^affusr_v1_[A-Za-z0-9_-]{43}$'),
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE affiliate_creator (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    status text NOT NULL CHECK (status IN ('pending', 'active', 'paused', 'suspended', 'terminated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_program (
    id uuid PRIMARY KEY,
    program_key text NOT NULL UNIQUE CHECK (program_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'retired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_program_version (
    id uuid PRIMARY KEY,
    program_id uuid NOT NULL REFERENCES affiliate_program(id),
    version integer NOT NULL CHECK (version > 0),
    status text NOT NULL CHECK (status IN ('draft', 'published')),
    policy_document jsonb NOT NULL CHECK (jsonb_typeof(policy_document) = 'object'),
    policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
    effective_from timestamptz,
    effective_until timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (program_id, version),
    CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
    CHECK (
      (status = 'draft' AND published_at IS NULL)
      OR (
        status = 'published'
        AND published_at IS NOT NULL
        AND effective_from IS NOT NULL
        AND policy_document ?& ARRAY[
          'customer_offer', 'attribution', 'commission', 'transfer', 'external_payout'
        ]
      )
    )
);

CREATE FUNCTION affiliate_guard_program_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published affiliate program versions are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'published' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.program_id::text, 0));
    IF EXISTS (
      SELECT 1
      FROM public.affiliate_program_version AS existing
      WHERE existing.program_id = NEW.program_id
        AND existing.id <> NEW.id
        AND existing.status = 'published'
        AND tstzrange(existing.effective_from, existing.effective_until, '[)')
            && tstzrange(NEW.effective_from, NEW.effective_until, '[)')
    ) THEN
      RAISE EXCEPTION 'published affiliate program version intervals cannot overlap';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_program_version_guard
BEFORE INSERT OR UPDATE OR DELETE ON affiliate_program_version
FOR EACH ROW EXECUTE FUNCTION affiliate_guard_program_version();

CREATE TABLE affiliate_campaign (
    id uuid PRIMARY KEY,
    program_version_id uuid NOT NULL REFERENCES affiliate_program_version(id),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'ended')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE affiliate_link (
    id uuid PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES affiliate_creator(id),
    campaign_id uuid NOT NULL REFERENCES affiliate_campaign(id),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    destination_key text NOT NULL CHECK (destination_key ~ '^[a-z0-9]+([._/-][a-z0-9]+)*$'),
    status text NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_link_active_creator_idx
    ON affiliate_link (creator_id, campaign_id)
    WHERE status = 'active';

CREATE TABLE affiliate_code (
    id uuid PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES affiliate_creator(id),
    campaign_id uuid NOT NULL REFERENCES affiliate_campaign(id),
    code text NOT NULL CHECK (length(code) BETWEEN 3 AND 64),
    provider_code_ref text CHECK (provider_code_ref IS NULL OR length(provider_code_ref) <= 255),
    status text NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliate_code_case_insensitive_unique_idx ON affiliate_code (lower(code));

CREATE TABLE affiliate_principal_membership (
    id uuid PRIMARY KEY,
    principal_ref text NOT NULL REFERENCES affiliate_principal(principal_ref),
    creator_id uuid NOT NULL REFERENCES affiliate_creator(id),
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'analyst')),
    status text NOT NULL CHECK (status IN ('active', 'revoked')),
    granted_by_principal_ref text NOT NULL REFERENCES affiliate_principal(principal_ref),
    grant_reason text NOT NULL CHECK (length(grant_reason) BETWEEN 3 AND 500),
    valid_from timestamptz NOT NULL,
    valid_until timestamptz,
    revoked_at timestamptz,
    revoked_by_principal_ref text REFERENCES affiliate_principal(principal_ref),
    revoke_reason text CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (
      (status = 'active' AND revoked_at IS NULL AND revoked_by_principal_ref IS NULL
       AND revoke_reason IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_principal_ref IS NOT NULL
       AND revoke_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX affiliate_principal_membership_active_unique_idx
    ON affiliate_principal_membership (principal_ref, creator_id)
    WHERE status = 'active' AND revoked_at IS NULL;
CREATE INDEX affiliate_principal_membership_authorization_idx
    ON affiliate_principal_membership (principal_ref, creator_id, valid_from, valid_until)
    WHERE status = 'active' AND revoked_at IS NULL;

CREATE TABLE affiliate_staff_membership (
    id uuid PRIMARY KEY,
    principal_ref text NOT NULL REFERENCES affiliate_principal(principal_ref),
    capability text NOT NULL CHECK (capability IN (
      'membership_admin', 'creator_manage', 'program_manage', 'attribution_correct',
      'finance_review', 'transfer_prepare', 'transfer_approve', 'transfer_execute', 'audit_read'
    )),
    scope_kind text NOT NULL CHECK (scope_kind IN ('platform', 'program', 'creator')),
    scope_id uuid,
    status text NOT NULL CHECK (status IN ('active', 'revoked')),
    granted_by_principal_ref text NOT NULL REFERENCES affiliate_principal(principal_ref),
    grant_reason text NOT NULL CHECK (length(grant_reason) BETWEEN 3 AND 500),
    valid_from timestamptz NOT NULL,
    valid_until timestamptz,
    revoked_at timestamptz,
    revoked_by_principal_ref text REFERENCES affiliate_principal(principal_ref),
    revoke_reason text CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (scope_kind = 'platform' AND scope_id IS NULL)
      OR (scope_kind IN ('program', 'creator') AND scope_id IS NOT NULL)
    ),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (
      (status = 'active' AND revoked_at IS NULL AND revoked_by_principal_ref IS NULL
       AND revoke_reason IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_principal_ref IS NOT NULL
       AND revoke_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX affiliate_staff_membership_active_unique_idx
    ON affiliate_staff_membership (
      principal_ref, capability, scope_kind, COALESCE(scope_id, uuid '00000000-0000-0000-0000-000000000000')
    )
    WHERE status = 'active' AND revoked_at IS NULL;
CREATE INDEX affiliate_staff_membership_authorization_idx
    ON affiliate_staff_membership (
      principal_ref, capability, scope_kind, scope_id, valid_from, valid_until
    )
    WHERE status = 'active' AND revoked_at IS NULL;

CREATE TABLE affiliate_click (
    id uuid PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES affiliate_creator(id),
    campaign_id uuid NOT NULL REFERENCES affiliate_campaign(id),
    program_version_id uuid NOT NULL REFERENCES affiliate_program_version(id),
    link_id uuid NOT NULL REFERENCES affiliate_link(id),
    clicked_at timestamptz NOT NULL,
    anonymous_expires_at timestamptz NOT NULL,
    UNIQUE (id, creator_id, campaign_id, program_version_id, link_id),
    CHECK (anonymous_expires_at = clicked_at + interval '15 minutes')
);

CREATE INDEX affiliate_click_expiry_idx ON affiliate_click (anonymous_expires_at);

CREATE TABLE affiliate_handoff (
    id uuid PRIMARY KEY,
    click_id uuid NOT NULL UNIQUE REFERENCES affiliate_click(id),
    token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    consumed_by_principal_ref text REFERENCES affiliate_principal(principal_ref),
    CHECK (expires_at = issued_at + interval '15 minutes'),
    CHECK (
      (consumed_at IS NULL AND consumed_by_principal_ref IS NULL)
      OR (consumed_at IS NOT NULL AND consumed_by_principal_ref IS NOT NULL)
    ),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE INDEX affiliate_handoff_expiry_idx
    ON affiliate_handoff (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE affiliate_attribution (
    id uuid PRIMARY KEY,
    principal_ref text NOT NULL REFERENCES affiliate_principal(principal_ref),
    creator_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    program_version_id uuid NOT NULL,
    link_id uuid NOT NULL,
    click_id uuid NOT NULL,
    state text NOT NULL CHECK (state IN ('bound', 'replaced', 'locked', 'corrected')),
    bound_at timestamptz NOT NULL,
    replaced_at timestamptz,
    locked_at timestamptz,
    lock_reference text CHECK (lock_reference IS NULL OR length(lock_reference) BETWEEN 1 AND 255),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (click_id, creator_id, campaign_id, program_version_id, link_id)
      REFERENCES affiliate_click (id, creator_id, campaign_id, program_version_id, link_id),
    CHECK ((state = 'replaced') = (replaced_at IS NOT NULL)),
    CHECK ((locked_at IS NULL AND lock_reference IS NULL) OR
           (locked_at IS NOT NULL AND lock_reference IS NOT NULL)),
    CHECK (state NOT IN ('locked', 'corrected') OR locked_at IS NOT NULL)
);

CREATE UNIQUE INDEX affiliate_attribution_current_principal_unique_idx
    ON affiliate_attribution (principal_ref)
    WHERE state IN ('bound', 'locked', 'corrected');

CREATE FUNCTION affiliate_guard_locked_attribution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'locked affiliate attribution evidence is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL AND (
    NEW.principal_ref IS DISTINCT FROM OLD.principal_ref
    OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
    OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.program_version_id IS DISTINCT FROM OLD.program_version_id
    OR NEW.link_id IS DISTINCT FROM OLD.link_id
    OR NEW.click_id IS DISTINCT FROM OLD.click_id
    OR NEW.bound_at IS DISTINCT FROM OLD.bound_at
    OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
    OR NEW.lock_reference IS DISTINCT FROM OLD.lock_reference
  ) THEN
    RAISE EXCEPTION 'locked affiliate attribution evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_attribution_lock_guard
BEFORE UPDATE OR DELETE ON affiliate_attribution
FOR EACH ROW EXECUTE FUNCTION affiliate_guard_locked_attribution();

CREATE TABLE affiliate_audit_event (
    id uuid PRIMARY KEY,
    actor_principal_ref text NOT NULL REFERENCES affiliate_principal(principal_ref),
    action text NOT NULL CHECK (length(action) BETWEEN 3 AND 100),
    outcome text NOT NULL CHECK (outcome IN ('succeeded', 'denied')),
    scope_kind text NOT NULL CHECK (
      scope_kind IN ('platform', 'program', 'creator', 'principal', 'membership')
    ),
    scope_ref text CHECK (scope_ref IS NULL OR length(scope_ref) <= 255),
    reason text CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 500),
    details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    occurred_at timestamptz NOT NULL
);

CREATE INDEX affiliate_audit_event_actor_time_idx
    ON affiliate_audit_event (actor_principal_ref, occurred_at DESC);
CREATE INDEX affiliate_audit_event_scope_time_idx
    ON affiliate_audit_event (scope_kind, scope_ref, occurred_at DESC);

ALTER TABLE affiliate_principal OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_creator OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_program OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_program_version OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_campaign OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_link OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_code OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_principal_membership OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_staff_membership OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_click OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_handoff OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_attribution OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_audit_event OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_program_version() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_locked_attribution() OWNER TO cloudsqlsuperuser;

REVOKE ALL ON affiliate_principal, affiliate_creator, affiliate_program,
    affiliate_program_version, affiliate_campaign, affiliate_link, affiliate_code,
    affiliate_principal_membership, affiliate_staff_membership, affiliate_click,
    affiliate_handoff, affiliate_attribution, affiliate_audit_event FROM glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_program_version() FROM PUBLIC, glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_locked_attribution() FROM PUBLIC, glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON affiliate_principal TO glidelingo_app;
GRANT SELECT ON affiliate_creator, affiliate_program, affiliate_program_version,
    affiliate_campaign, affiliate_link, affiliate_code TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON affiliate_principal_membership,
    affiliate_staff_membership TO glidelingo_app;
GRANT SELECT, INSERT ON affiliate_click TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON affiliate_handoff TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON affiliate_attribution TO glidelingo_app;
GRANT INSERT ON affiliate_audit_event TO glidelingo_app;

COMMIT;
