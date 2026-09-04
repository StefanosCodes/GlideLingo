-- Migration numbers 004 and 005 are reserved by the in-flight affiliate/billing stack.
-- This migration is operator-run and must never execute during API startup.
BEGIN;

CREATE TABLE marketplace_tutor_application (
    application_id uuid PRIMARY KEY,
    actor_ref text NOT NULL UNIQUE
        CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    status text NOT NULL
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
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
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
SET search_path FROM CURRENT
AS $$
DECLARE
    v_application_id uuid;
    v_tutor_id uuid;
    v_offering_id uuid;
    v_payout_ready boolean;
    v_application_status text;
BEGIN
    SELECT profile.application_id, profile.tutor_id, offering.offering_id,
           profile.payout_ready, application.status
    INTO v_application_id, v_tutor_id, v_offering_id, v_payout_ready,
         v_application_status
    FROM marketplace_tutor_profile AS profile
    JOIN marketplace_tutor_application AS application
      ON application.application_id = profile.application_id
    JOIN marketplace_tutor_offering AS offering ON offering.tutor_id = profile.tutor_id
    WHERE profile.actor_ref = p_actor_ref
      AND profile.version = p_expected_profile_version
      AND offering.version = p_expected_offering_version
    FOR UPDATE OF profile, offering;

    IF v_application_id IS NULL
       OR v_application_status <> 'approved'
       OR (p_publish AND NOT v_payout_ready) THEN
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
SET search_path FROM CURRENT
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

GRANT SELECT, INSERT, UPDATE ON marketplace_tutor_application TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_tutor_application_language TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_tutor_application_specialty TO glidelingo_app;
GRANT SELECT ON marketplace_tutor_profile TO glidelingo_app;
GRANT INSERT (tutor_id, application_id, actor_ref, headline, biography, time_zone)
    ON marketplace_tutor_profile TO glidelingo_app;
GRANT UPDATE (headline, biography, time_zone, version, updated_at)
    ON marketplace_tutor_profile TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_tutor_credential TO glidelingo_app;
GRANT SELECT ON marketplace_policy_version TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_tutor_offering TO glidelingo_app;
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
