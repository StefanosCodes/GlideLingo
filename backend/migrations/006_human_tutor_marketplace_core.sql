BEGIN;

-- Migrations 004 and 005 are the affiliate/billing predecessors.
-- This migration is operator-run and must never execute during API startup.

CREATE TABLE marketplace_tutor_application (
    application_id uuid PRIMARY KEY,
    actor_ref text NOT NULL UNIQUE
        CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected',
                          'suspended')),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    headline text NOT NULL CHECK (length(headline) BETWEEN 3 AND 80),
    biography text NOT NULL CHECK (length(biography) BETWEEN 20 AND 1000),
    time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
    reviewer_actor_ref text
        CHECK (reviewer_actor_ref IS NULL OR
               reviewer_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    submitted_at timestamptz,
    reviewed_at timestamptz,
    decision_reason text CHECK (
        decision_reason IS NULL OR length(decision_reason) BETWEEN 8 AND 500
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (status = 'draft' AND submitted_at IS NULL AND reviewer_actor_ref IS NULL
         AND reviewed_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'submitted' AND submitted_at IS NOT NULL AND reviewer_actor_ref IS NULL
         AND reviewed_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'under_review' AND submitted_at IS NOT NULL
         AND reviewer_actor_ref IS NOT NULL AND reviewed_at IS NULL
         AND decision_reason IS NULL)
        OR
        (status IN ('approved', 'rejected', 'suspended') AND submitted_at IS NOT NULL
         AND reviewer_actor_ref IS NOT NULL AND reviewed_at IS NOT NULL
         AND decision_reason IS NOT NULL)
    )
);

CREATE INDEX marketplace_tutor_application_review_queue_idx
    ON marketplace_tutor_application (submitted_at, application_id)
    WHERE status IN ('submitted', 'under_review');

CREATE TABLE marketplace_tutor_application_language (
    application_id uuid NOT NULL
        REFERENCES marketplace_tutor_application(application_id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 7),
    language_code text NOT NULL
        CHECK (language_code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
    PRIMARY KEY (application_id, language_code),
    UNIQUE (application_id, position)
);

CREATE TABLE marketplace_tutor_application_specialty (
    application_id uuid NOT NULL
        REFERENCES marketplace_tutor_application(application_id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
    specialty text NOT NULL CHECK (length(specialty) BETWEEN 2 AND 64),
    PRIMARY KEY (application_id, specialty),
    UNIQUE (application_id, position)
);

CREATE TABLE marketplace_tutor_profile (
    tutor_id uuid PRIMARY KEY,
    application_id uuid NOT NULL UNIQUE
        REFERENCES marketplace_tutor_application(application_id),
    actor_ref text NOT NULL UNIQUE
        CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    headline text NOT NULL CHECK (length(headline) BETWEEN 3 AND 80),
    biography text NOT NULL CHECK (length(biography) BETWEEN 20 AND 1000),
    time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    payout_ready boolean NOT NULL DEFAULT false,
    is_published boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_tutor_credential (
    credential_id uuid PRIMARY KEY,
    application_id uuid NOT NULL UNIQUE
        REFERENCES marketplace_tutor_application(application_id),
    tutor_id uuid NOT NULL UNIQUE REFERENCES marketplace_tutor_profile(tutor_id),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    credential_type text NOT NULL
        CHECK (credential_type IN ('certificate', 'degree', 'teaching_license')),
    title text NOT NULL CHECK (length(title) BETWEEN 3 AND 100),
    issuer text NOT NULL CHECK (length(issuer) BETWEEN 2 AND 100),
    verification_status text NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
    verified_by_actor_ref text
        CHECK (verified_by_actor_ref IS NULL OR
               verified_by_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    verification_reason text CHECK (
        verification_reason IS NULL OR length(verification_reason) BETWEEN 8 AND 500
    ),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (verification_status = 'unverified' AND verified_by_actor_ref IS NULL
         AND verification_reason IS NULL AND reviewed_at IS NULL)
        OR
        (verification_status IN ('verified', 'rejected') AND verified_by_actor_ref IS NOT NULL
         AND verification_reason IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE TABLE marketplace_policy_version (
    policy_id uuid PRIMARY KEY,
    policy_type text NOT NULL CHECK (policy_type IN ('commission', 'cancellation')),
    version integer NOT NULL CHECK (version >= 1),
    commission_basis_points integer
        CHECK (commission_basis_points BETWEEN 0 AND 10000),
    cancellation_cutoff_hours integer
        CHECK (cancellation_cutoff_hours BETWEEN 0 AND 168),
    dispute_window_hours integer
        CHECK (dispute_window_hours BETWEEN 1 AND 168),
    effective_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (policy_type, version),
    CHECK (
        (policy_type = 'commission' AND commission_basis_points IS NOT NULL
         AND cancellation_cutoff_hours IS NULL AND dispute_window_hours IS NULL)
        OR
        (policy_type = 'cancellation' AND commission_basis_points IS NULL
         AND cancellation_cutoff_hours IS NOT NULL AND dispute_window_hours IS NOT NULL)
    )
);

CREATE FUNCTION marketplace_reject_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'marketplace policy versions are immutable';
END;
$$;

CREATE TRIGGER marketplace_policy_version_immutable
BEFORE UPDATE OR DELETE ON marketplace_policy_version
FOR EACH ROW EXECUTE FUNCTION marketplace_reject_policy_mutation();

INSERT INTO marketplace_policy_version
  (policy_id, policy_type, version, commission_basis_points, effective_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'commission', 1, 2000,
   '2026-09-04T00:00:00Z');

INSERT INTO marketplace_policy_version
  (policy_id, policy_type, version, cancellation_cutoff_hours, dispute_window_hours,
   effective_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'cancellation', 1, 12, 24,
   '2026-09-04T00:00:00Z');

CREATE TABLE marketplace_tutor_offering (
    offering_id uuid PRIMARY KEY,
    application_id uuid NOT NULL UNIQUE
        REFERENCES marketplace_tutor_application(application_id),
    tutor_id uuid NOT NULL UNIQUE REFERENCES marketplace_tutor_profile(tutor_id),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    title text NOT NULL CHECK (length(title) BETWEEN 3 AND 100),
    duration_minutes integer NOT NULL CHECK (duration_minutes IN (25, 50)),
    amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 500 AND 50000),
    currency text NOT NULL CHECK (currency = 'USD'),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'active')),
    commission_policy_id uuid NOT NULL REFERENCES marketplace_policy_version(policy_id),
    cancellation_policy_id uuid NOT NULL REFERENCES marketplace_policy_version(policy_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION marketplace_set_tutor_publication(
    p_actor_ref text,
    p_expected_profile_version integer,
    p_expected_offering_version integer,
    p_publish boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_application_id uuid;
    v_tutor_id uuid;
    v_offering_id uuid;
    v_payout_ready boolean;
    v_application_status text;
BEGIN
    -- Application status is the first lock in both publication and suspension.
    -- This prevents a publisher from observing approved immediately before a
    -- concurrent suspension commits.
    SELECT application.application_id, application.status
    INTO v_application_id, v_application_status
    FROM marketplace_tutor_application AS application
    JOIN marketplace_tutor_profile AS profile
      ON profile.application_id = application.application_id
    WHERE profile.actor_ref = p_actor_ref
    FOR UPDATE OF application;

    IF v_application_id IS NULL
       OR v_application_status <> 'approved' THEN
        RETURN NULL;
    END IF;

    SELECT profile.tutor_id, offering.offering_id, profile.payout_ready
    INTO v_tutor_id, v_offering_id, v_payout_ready
    FROM marketplace_tutor_profile AS profile
    JOIN marketplace_tutor_offering AS offering ON offering.tutor_id = profile.tutor_id
    WHERE profile.application_id = v_application_id
      AND profile.version = p_expected_profile_version
      AND offering.application_id = v_application_id
      AND offering.version = p_expected_offering_version
    FOR UPDATE OF profile, offering;

    IF v_tutor_id IS NULL OR (p_publish AND NOT v_payout_ready) THEN
        RETURN NULL;
    END IF;

    UPDATE marketplace_tutor_profile
    SET is_published = p_publish, version = version + 1, updated_at = now()
    WHERE tutor_id = v_tutor_id;

    UPDATE marketplace_tutor_offering
    SET state = CASE WHEN p_publish THEN 'active' ELSE 'draft' END,
        version = version + 1,
        updated_at = now()
    WHERE offering_id = v_offering_id;

    RETURN v_application_id;
END;
$$;

CREATE FUNCTION marketplace_make_suspended_tutor_private(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM marketplace_tutor_application
        WHERE application_id = p_application_id AND status = 'suspended'
    ) THEN
        RAISE EXCEPTION 'tutor is not suspended';
    END IF;

    UPDATE marketplace_tutor_profile
    SET is_published = false, version = version + 1, updated_at = now()
    WHERE application_id = p_application_id AND is_published = true;

    UPDATE marketplace_tutor_offering
    SET state = 'draft', version = version + 1, updated_at = now()
    WHERE application_id = p_application_id AND state = 'active';
END;
$$;

CREATE TABLE marketplace_operator_capability (
    actor_ref text NOT NULL
        CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    capability text NOT NULL CHECK (
        capability IN ('review_tutor_applications', 'manage_tutor_status',
                       'verify_tutor_credentials')
    ),
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    PRIMARY KEY (actor_ref, capability),
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE FUNCTION marketplace_validate_application_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'tutor applications must be created as drafts'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.actor_ref IS DISTINCT FROM OLD.actor_ref THEN
        RAISE EXCEPTION 'tutor application identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = OLD.status THEN
        IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
           OR NEW.reviewer_actor_ref IS DISTINCT FROM OLD.reviewer_actor_ref
           OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
           OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
            RAISE EXCEPTION 'review facts may change only with application status'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'application status transitions require one version increment'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'submitted' AND NEW.status = 'under_review'
       AND NEW.actor_ref <> NEW.reviewer_actor_ref
       AND EXISTS (
         SELECT 1 FROM marketplace_operator_capability
         WHERE actor_ref = NEW.reviewer_actor_ref
           AND capability = 'review_tutor_applications'
           AND revoked_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'under_review' AND NEW.status IN ('approved', 'rejected')
       AND NEW.actor_ref <> NEW.reviewer_actor_ref
       AND EXISTS (
         SELECT 1 FROM marketplace_operator_capability
         WHERE actor_ref = NEW.reviewer_actor_ref
           AND capability = 'review_tutor_applications'
           AND revoked_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    IF ((OLD.status = 'approved' AND NEW.status = 'suspended')
        OR (OLD.status = 'suspended' AND NEW.status = 'approved'))
       AND NEW.actor_ref <> NEW.reviewer_actor_ref
       AND EXISTS (
         SELECT 1 FROM marketplace_operator_capability
         WHERE actor_ref = NEW.reviewer_actor_ref
           AND capability = 'manage_tutor_status'
           AND revoked_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid or unauthorized tutor application status transition'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER marketplace_tutor_application_status_guard
BEFORE INSERT OR UPDATE ON marketplace_tutor_application
FOR EACH ROW EXECUTE FUNCTION marketplace_validate_application_status();

CREATE FUNCTION marketplace_validate_tutor_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_application_status text;
    v_application_actor_ref text;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.tutor_id IS DISTINCT FROM OLD.tutor_id
            OR NEW.application_id IS DISTINCT FROM OLD.application_id
            OR NEW.actor_ref IS DISTINCT FROM OLD.actor_ref) THEN
        RAISE EXCEPTION 'tutor profile identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    SELECT status, actor_ref
    INTO v_application_status, v_application_actor_ref
    FROM marketplace_tutor_application
    WHERE application_id = NEW.application_id;

    IF v_application_actor_ref IS DISTINCT FROM NEW.actor_ref THEN
        RAISE EXCEPTION 'tutor profile requires its approved application'
            USING ERRCODE = '23514';
    END IF;

    IF v_application_status = 'suspended' AND TG_OP = 'UPDATE'
       AND NOT NEW.is_published
       AND NEW.headline = OLD.headline
       AND NEW.biography = OLD.biography
       AND NEW.time_zone = OLD.time_zone
       AND NEW.payout_ready = OLD.payout_ready THEN
        RETURN NEW;
    END IF;

    IF v_application_status <> 'approved' THEN
        RAISE EXCEPTION 'tutor profile requires its approved application'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.is_published AND NOT NEW.payout_ready THEN
        RAISE EXCEPTION 'published tutor profile requires payout readiness'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_tutor_profile_eligibility_guard
BEFORE INSERT OR UPDATE ON marketplace_tutor_profile
FOR EACH ROW EXECUTE FUNCTION marketplace_validate_tutor_profile();

CREATE FUNCTION marketplace_validate_tutor_credential()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_application_status text;
    v_tutor_actor_ref text;
BEGIN
    SELECT application.status, profile.actor_ref
    INTO v_application_status, v_tutor_actor_ref
    FROM marketplace_tutor_profile AS profile
    JOIN marketplace_tutor_application AS application
      ON application.application_id = profile.application_id
    WHERE profile.tutor_id = NEW.tutor_id
      AND profile.application_id = NEW.application_id;

    IF v_application_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'tutor credential requires its approved profile'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.verification_status <> 'unverified' THEN
            RAISE EXCEPTION 'tutor credentials must be created unverified'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.credential_id IS DISTINCT FROM OLD.credential_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.tutor_id IS DISTINCT FROM OLD.tutor_id
       OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'credential identity is immutable and updates require one version increment'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.verification_status = 'unverified'
       AND NEW.verification_status = 'unverified' THEN
        RETURN NEW;
    END IF;

    IF OLD.verification_status = 'unverified'
       AND NEW.verification_status IN ('verified', 'rejected')
       AND NEW.credential_type = OLD.credential_type
       AND NEW.title = OLD.title
       AND NEW.issuer = OLD.issuer
       AND NEW.verified_by_actor_ref <> v_tutor_actor_ref
       AND EXISTS (
         SELECT 1 FROM marketplace_operator_capability
         WHERE actor_ref = NEW.verified_by_actor_ref
           AND capability = 'verify_tutor_credentials'
           AND revoked_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid or unauthorized credential transition'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER marketplace_tutor_credential_guard
BEFORE INSERT OR UPDATE ON marketplace_tutor_credential
FOR EACH ROW EXECUTE FUNCTION marketplace_validate_tutor_credential();

CREATE FUNCTION marketplace_validate_tutor_offering()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_application_status text;
    v_payout_ready boolean;
    v_is_published boolean;
BEGIN
    SELECT application.status, profile.payout_ready, profile.is_published
    INTO v_application_status, v_payout_ready, v_is_published
    FROM marketplace_tutor_profile AS profile
    JOIN marketplace_tutor_application AS application
      ON application.application_id = profile.application_id
    JOIN marketplace_policy_version AS commission_policy
      ON commission_policy.policy_id = NEW.commission_policy_id
     AND commission_policy.policy_type = 'commission'
    JOIN marketplace_policy_version AS cancellation_policy
      ON cancellation_policy.policy_id = NEW.cancellation_policy_id
     AND cancellation_policy.policy_type = 'cancellation'
    WHERE profile.tutor_id = NEW.tutor_id
      AND profile.application_id = NEW.application_id;

    IF v_application_status IS NULL THEN
        RAISE EXCEPTION 'tutor offering ownership or policy types are invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.state = 'active'
       AND (v_application_status <> 'approved'
            OR NOT v_payout_ready
            OR NOT v_is_published) THEN
        RAISE EXCEPTION 'active tutor offering requires publication eligibility'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_tutor_offering_eligibility_guard
BEFORE INSERT OR UPDATE ON marketplace_tutor_offering
FOR EACH ROW EXECUTE FUNCTION marketplace_validate_tutor_offering();

CREATE FUNCTION marketplace_force_suspended_tutor_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'suspended' AND OLD.status <> 'suspended' THEN
        PERFORM marketplace_make_suspended_tutor_private(NEW.application_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_suspended_tutor_private_guard
AFTER UPDATE OF status ON marketplace_tutor_application
FOR EACH ROW EXECUTE FUNCTION marketplace_force_suspended_tutor_private();

CREATE TABLE marketplace_audit_event (
    audit_id uuid PRIMARY KEY,
    application_id uuid NOT NULL REFERENCES marketplace_tutor_application(application_id),
    actor_ref text NOT NULL
        CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    action text NOT NULL CHECK (
        action IN ('application_created', 'application_submitted',
                   'application_draft_updated', 'application_review_started',
                   'application_decided', 'application_suspended',
                   'application_reinstated', 'profile_draft_updated',
                   'credential_draft_saved', 'credential_decided',
                   'offering_draft_saved', 'profile_published',
                   'profile_unpublished')
    ),
    from_status text,
    to_status text NOT NULL,
    reason text CHECK (reason IS NULL OR length(reason) BETWEEN 8 AND 500),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_audit_event_application_idx
    ON marketplace_audit_event (application_id, occurred_at, audit_id);

ALTER TABLE marketplace_tutor_application OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_application_language OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_application_specialty OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_profile OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_credential OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_policy_version OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_offering OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_operator_capability OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_audit_event OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_reject_policy_mutation() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_set_tutor_publication(text, integer, integer, boolean)
    OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_make_suspended_tutor_private(uuid) OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_validate_application_status() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_validate_tutor_profile() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_validate_tutor_credential() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_validate_tutor_offering() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_force_suspended_tutor_private() OWNER TO cloudsqlsuperuser;

GRANT SELECT ON marketplace_tutor_application TO glidelingo_app;
GRANT INSERT (application_id, actor_ref, headline, biography, time_zone)
    ON marketplace_tutor_application TO glidelingo_app;
GRANT UPDATE (status, version, headline, biography, time_zone, reviewer_actor_ref,
              submitted_at, reviewed_at, decision_reason, updated_at)
    ON marketplace_tutor_application TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_tutor_application_language TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_tutor_application_specialty TO glidelingo_app;
GRANT SELECT ON marketplace_tutor_profile TO glidelingo_app;
GRANT INSERT (tutor_id, application_id, actor_ref, headline, biography, time_zone)
    ON marketplace_tutor_profile TO glidelingo_app;
GRANT UPDATE (headline, biography, time_zone, version, updated_at)
    ON marketplace_tutor_profile TO glidelingo_app;
GRANT SELECT ON marketplace_tutor_credential TO glidelingo_app;
GRANT INSERT (credential_id, application_id, tutor_id, credential_type, title, issuer)
    ON marketplace_tutor_credential TO glidelingo_app;
GRANT UPDATE (version, credential_type, title, issuer, verification_status,
              verified_by_actor_ref, verification_reason, reviewed_at, updated_at)
    ON marketplace_tutor_credential TO glidelingo_app;
GRANT SELECT ON marketplace_policy_version TO glidelingo_app;
GRANT SELECT ON marketplace_tutor_offering TO glidelingo_app;
GRANT INSERT (offering_id, application_id, tutor_id, title, duration_minutes,
              amount_minor, currency, commission_policy_id, cancellation_policy_id)
    ON marketplace_tutor_offering TO glidelingo_app;
GRANT UPDATE (title, duration_minutes, amount_minor, currency, version, updated_at)
    ON marketplace_tutor_offering TO glidelingo_app;
GRANT SELECT ON marketplace_operator_capability TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_audit_event TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_set_tutor_publication(text, integer, integer, boolean)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_make_suspended_tutor_private(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_set_tutor_publication(text, integer, integer, boolean)
    TO glidelingo_app;
GRANT EXECUTE ON FUNCTION marketplace_make_suspended_tutor_private(uuid)
    TO glidelingo_app;

COMMIT;
