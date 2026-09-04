BEGIN;

ALTER TABLE marketplace_operator_capability
    DROP CONSTRAINT marketplace_operator_capability_capability_check;
ALTER TABLE marketplace_operator_capability
    ADD CONSTRAINT marketplace_operator_capability_capability_check CHECK (
        capability IN ('review_tutor_applications', 'manage_tutor_status',
                       'verify_tutor_credentials', 'review_message_reports',
                       'manage_bookings', 'moderate_reviews')
    );

CREATE TABLE marketplace_tutor_connect_account (
    tutor_id uuid PRIMARY KEY REFERENCES marketplace_tutor_profile(tutor_id),
    provider_account_id text NOT NULL UNIQUE CHECK (provider_account_id ~ '^acct_[A-Za-z0-9]{8,}$'),
    environment text NOT NULL CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
    details_submitted boolean NOT NULL DEFAULT false,
    charges_enabled boolean NOT NULL DEFAULT false,
    payouts_enabled boolean NOT NULL DEFAULT false,
    safe_requirements_due smallint NOT NULL DEFAULT 0 CHECK (safe_requirements_due BETWEEN 0 AND 100),
    provider_observed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_tutor_meeting_config (
    tutor_id uuid PRIMARY KEY REFERENCES marketplace_tutor_profile(tutor_id),
    approved_meeting_url text NOT NULL CHECK (length(approved_meeting_url) BETWEEN 12 AND 1000),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_booking (
    booking_id uuid PRIMARY KEY,
    learner_actor_ref text NOT NULL CHECK (learner_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id),
    tutor_actor_ref text NOT NULL CHECK (tutor_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    offering_id uuid NOT NULL REFERENCES marketplace_tutor_offering(offering_id),
    client_idempotency_key uuid NOT NULL,
    state text NOT NULL CHECK (state IN (
        'held', 'payment_pending', 'payment_ambiguous', 'payment_failed',
        'confirmed', 'cancelled', 'expired'
    )),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    buffer_before_minutes integer NOT NULL CHECK (buffer_before_minutes BETWEEN 0 AND 120),
    buffer_after_minutes integer NOT NULL CHECK (buffer_after_minutes BETWEEN 0 AND 120),
    hold_expires_at timestamptz NOT NULL,
    amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 500 AND 50000),
    currency text NOT NULL CHECK (currency = 'USD'),
    commission_basis_points integer NOT NULL CHECK (commission_basis_points BETWEEN 0 AND 10000),
    commission_amount_minor integer NOT NULL CHECK (commission_amount_minor >= 0),
    tutor_amount_minor integer NOT NULL CHECK (tutor_amount_minor >= 0),
    commission_policy_id uuid NOT NULL REFERENCES marketplace_policy_version(policy_id),
    cancellation_policy_id uuid NOT NULL REFERENCES marketplace_policy_version(policy_id),
    cancellation_cutoff_hours integer NOT NULL CHECK (cancellation_cutoff_hours BETWEEN 0 AND 168),
    dispute_window_hours integer NOT NULL CHECK (dispute_window_hours BETWEEN 1 AND 168),
    provider_environment text NOT NULL CHECK (provider_environment IN ('SANDBOX', 'PRODUCTION')),
    provider_platform_account_id text NOT NULL CHECK (provider_platform_account_id ~ '^acct_[A-Za-z0-9]{8,}$'),
    provider_checkout_id text UNIQUE CHECK (
        provider_checkout_id IS NULL OR provider_checkout_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,}$'
    ),
    provider_payment_intent_id text UNIQUE CHECK (
        provider_payment_intent_id IS NULL OR provider_payment_intent_id ~ '^pi_[A-Za-z0-9]{8,}$'
    ),
    checkout_url text CHECK (checkout_url IS NULL OR length(checkout_url) BETWEEN 12 AND 2000),
    meeting_url_snapshot text CHECK (meeting_url_snapshot IS NULL OR length(meeting_url_snapshot) BETWEEN 12 AND 1000),
    provider_event_at timestamptz,
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (learner_actor_ref, client_idempotency_key),
    CHECK (learner_actor_ref <> tutor_actor_ref),
    CHECK (starts_at < ends_at),
    CHECK (hold_expires_at > created_at),
    CHECK (amount_minor = commission_amount_minor + tutor_amount_minor),
    CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL)),
    CHECK (provider_checkout_id IS NOT NULL OR state IN ('held', 'payment_ambiguous', 'expired'))
);

CREATE INDEX marketplace_booking_learner_idx
    ON marketplace_booking (learner_actor_ref, starts_at DESC, booking_id);
CREATE INDEX marketplace_booking_tutor_idx
    ON marketplace_booking (tutor_actor_ref, starts_at DESC, booking_id);
CREATE INDEX marketplace_booking_hold_expiry_idx
    ON marketplace_booking (hold_expires_at, booking_id)
    WHERE state IN ('held', 'payment_pending', 'payment_ambiguous');

ALTER TABLE marketplace_conversation
    ADD CONSTRAINT marketplace_conversation_booking_fk
    FOREIGN KEY (booking_id) REFERENCES marketplace_booking(booking_id);

CREATE FUNCTION marketplace_enforce_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NEW.state NOT IN ('held', 'payment_pending', 'payment_ambiguous', 'confirmed') THEN
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tutor_id::text, 1776));
    IF EXISTS (
        SELECT 1 FROM marketplace_booking AS existing
        WHERE existing.tutor_id = NEW.tutor_id
          AND existing.booking_id <> NEW.booking_id
          AND existing.state IN ('held', 'payment_pending', 'payment_ambiguous', 'confirmed')
          AND tstzrange(
                existing.starts_at - make_interval(mins => existing.buffer_before_minutes),
                existing.ends_at + make_interval(mins => existing.buffer_after_minutes),
                '[)'
              )
              && tstzrange(
                NEW.starts_at - make_interval(mins => NEW.buffer_before_minutes),
                NEW.ends_at + make_interval(mins => NEW.buffer_after_minutes),
                '[)'
              )
    ) THEN
        RAISE EXCEPTION 'active marketplace booking ranges may not overlap';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_booking_no_overlap
BEFORE INSERT OR UPDATE OF tutor_id, starts_at, ends_at, state ON marketplace_booking
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_booking_overlap();

CREATE FUNCTION marketplace_enforce_booking_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NEW.learner_actor_ref <> OLD.learner_actor_ref
       OR NEW.tutor_id <> OLD.tutor_id
       OR NEW.tutor_actor_ref <> OLD.tutor_actor_ref
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.buffer_before_minutes <> OLD.buffer_before_minutes
       OR NEW.buffer_after_minutes <> OLD.buffer_after_minutes
       OR NEW.starts_at <> OLD.starts_at
       OR NEW.ends_at <> OLD.ends_at
       OR NEW.amount_minor <> OLD.amount_minor
       OR NEW.currency <> OLD.currency
       OR NEW.commission_basis_points <> OLD.commission_basis_points
       OR NEW.commission_amount_minor <> OLD.commission_amount_minor
       OR NEW.tutor_amount_minor <> OLD.tutor_amount_minor
       OR NEW.commission_policy_id <> OLD.commission_policy_id
       OR NEW.cancellation_policy_id <> OLD.cancellation_policy_id
       OR NEW.cancellation_cutoff_hours <> OLD.cancellation_cutoff_hours
       OR NEW.dispute_window_hours <> OLD.dispute_window_hours
       OR NEW.provider_environment <> OLD.provider_environment
       OR NEW.provider_platform_account_id <> OLD.provider_platform_account_id
       OR NEW.client_idempotency_key <> OLD.client_idempotency_key THEN
        RAISE EXCEPTION 'marketplace booking authority snapshots are immutable';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
        (OLD.state = 'held' AND NEW.state IN ('payment_pending', 'payment_ambiguous', 'expired'))
        OR (OLD.state = 'payment_ambiguous' AND NEW.state = 'payment_pending')
        OR (OLD.state IN ('payment_pending', 'payment_ambiguous')
            AND NEW.state IN ('confirmed', 'payment_failed', 'cancelled', 'expired'))
    ) THEN
        RAISE EXCEPTION 'invalid marketplace booking transition';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_booking_transition_guard
BEFORE UPDATE ON marketplace_booking
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_booking_transition();

CREATE TABLE marketplace_booking_transition_audit (
    audit_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    from_state text,
    to_state text NOT NULL,
    source text NOT NULL CHECK (source IN ('learner', 'tutor', 'provider_webhook', 'reconciliation', 'system', 'operator')),
    reason_code text NOT NULL CHECK (length(reason_code) BETWEEN 2 AND 64),
    actor_ref text CHECK (actor_ref IS NULL OR actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_stripe_webhook_event (
    provider_event_id text PRIMARY KEY CHECK (provider_event_id ~ '^evt_[A-Za-z0-9]{8,}$'),
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 100),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    provider_created_at timestamptz NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('applied', 'duplicate', 'out_of_order', 'ignored')),
    booking_id uuid REFERENCES marketplace_booking(booking_id),
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_payment_reconciliation_job (
    job_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL UNIQUE REFERENCES marketplace_booking(booking_id),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'retryable', 'completed', 'dead')),
    attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 8),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),
    lease_expires_at timestamptz,
    safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) BETWEEN 2 AND 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX marketplace_payment_reconciliation_claim_idx
    ON marketplace_payment_reconciliation_job (available_at, created_at, job_id)
    WHERE status IN ('queued', 'retryable');

CREATE FUNCTION marketplace_set_connect_payout_readiness(
    p_actor_ref text,
    p_ready boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_tutor_id uuid;
BEGIN
    SELECT profile.tutor_id INTO v_tutor_id
    FROM marketplace_tutor_profile AS profile
    JOIN marketplace_tutor_application AS application
      ON application.application_id = profile.application_id
    WHERE profile.actor_ref = p_actor_ref AND application.status = 'approved'
    FOR UPDATE OF profile, application;
    IF v_tutor_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT p_ready THEN
        UPDATE marketplace_tutor_offering
        SET state = 'draft', version = version + 1, updated_at = now()
        WHERE tutor_id = v_tutor_id AND state = 'active';
        UPDATE marketplace_tutor_profile
        SET is_published = false, payout_ready = false,
            version = version + 1, updated_at = now()
        WHERE tutor_id = v_tutor_id;
    ELSE
        UPDATE marketplace_tutor_profile
        SET payout_ready = true, version = version + 1, updated_at = now()
        WHERE tutor_id = v_tutor_id AND payout_ready = false;
    END IF;
    RETURN v_tutor_id;
END;
$$;

ALTER TABLE marketplace_tutor_connect_account OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_meeting_config OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_booking OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_booking_transition_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_stripe_webhook_event OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_payment_reconciliation_job OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_booking_overlap() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_booking_transition() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_set_connect_payout_readiness(text, boolean) OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT, UPDATE ON marketplace_tutor_connect_account TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_tutor_meeting_config TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_booking TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_booking_transition_audit TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_stripe_webhook_event TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_payment_reconciliation_job TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_enforce_booking_overlap() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_enforce_booking_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_set_connect_payout_readiness(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_set_connect_payout_readiness(text, boolean) TO glidelingo_app;

COMMIT;
