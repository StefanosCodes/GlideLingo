BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'glidelingo_marketplace_payment_worker'
    ) THEN
        CREATE ROLE glidelingo_marketplace_payment_worker NOLOGIN;
    END IF;
END
$$;

-- The payment authority inherits the ordinary application's data-plane rights
-- and adds only the narrowly enumerated money/transition permissions below.
-- Runtime login roles are provisioned externally as members of exactly one of
-- these NOLOGIN roles; the ordinary application role cannot assume the payment
-- authority role.
GRANT glidelingo_app TO glidelingo_marketplace_payment_worker;

-- Additive completion migration. Earlier marketplace migrations are immutable because
-- their hashes are recorded in deployed migration ledgers.
ALTER TABLE marketplace_tutor_credential
    DROP CONSTRAINT IF EXISTS marketplace_tutor_credential_application_id_key,
    DROP CONSTRAINT IF EXISTS marketplace_tutor_credential_tutor_id_key;
ALTER TABLE marketplace_tutor_offering
    DROP CONSTRAINT IF EXISTS marketplace_tutor_offering_application_id_key,
    DROP CONSTRAINT IF EXISTS marketplace_tutor_offering_tutor_id_key;
CREATE INDEX marketplace_tutor_credential_owner_idx
    ON marketplace_tutor_credential (tutor_id, credential_id);
CREATE INDEX marketplace_tutor_offering_owner_idx
    ON marketplace_tutor_offering (tutor_id, offering_id);
CREATE INDEX marketplace_tutor_offering_active_idx
    ON marketplace_tutor_offering (tutor_id, duration_minutes, amount_minor, offering_id)
    WHERE state = 'active';

ALTER TABLE marketplace_message_rate_event
    ADD COLUMN target_actor_ref text
    CHECK (target_actor_ref IS NULL OR
           target_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$');
CREATE INDEX marketplace_message_rate_event_target_idx
    ON marketplace_message_rate_event (target_actor_ref, occurred_at DESC)
    WHERE target_actor_ref IS NOT NULL;
CREATE UNIQUE INDEX marketplace_message_report_general_unique_idx
    ON marketplace_message_report (conversation_id, reporter_actor_ref)
    WHERE message_id IS NULL;

ALTER TABLE marketplace_message_notification_job
    ADD COLUMN template text NOT NULL DEFAULT 'new_message'
        CHECK (template IN ('new_message', 'calendar_conflict'));

CREATE TABLE marketplace_message_report_rate_event (
    event_id uuid PRIMARY KEY,
    reporter_actor_ref text NOT NULL
        CHECK (reporter_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    subject_actor_ref text NOT NULL
        CHECK (subject_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketplace_message_report_rate_reporter_idx
    ON marketplace_message_report_rate_event (reporter_actor_ref, occurred_at DESC);
CREATE INDEX marketplace_message_report_rate_subject_idx
    ON marketplace_message_report_rate_event (subject_actor_ref, occurred_at DESC);

ALTER TABLE marketplace_tutor_connect_account
    ADD COLUMN platform_account_id text
    CHECK (platform_account_id IS NULL OR platform_account_id ~ '^acct_[A-Za-z0-9]{8,}$');

CREATE TABLE marketplace_connect_refresh_job (
    job_id uuid PRIMARY KEY,
    tutor_id uuid NOT NULL UNIQUE REFERENCES marketplace_tutor_connect_account(tutor_id)
        ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'leased', 'retryable', 'dead')),
    attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 8),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),
    lease_expires_at timestamptz,
    safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) <= 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX marketplace_connect_refresh_claim_idx
    ON marketplace_connect_refresh_job (available_at, created_at, job_id)
    WHERE status IN ('queued', 'retryable');

CREATE FUNCTION marketplace_set_tutor_publication_v2(
    p_actor_ref text,
    p_expected_profile_version integer,
    p_expected_offerings jsonb,
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
    v_payout_ready boolean;
    v_expected_count integer;
    v_owned_count integer;
    v_matched_count integer;
BEGIN
    IF jsonb_typeof(p_expected_offerings) <> 'array'
       OR jsonb_array_length(p_expected_offerings) NOT BETWEEN 1 AND 20 THEN
        RETURN NULL;
    END IF;
    SELECT application.application_id, profile.tutor_id, profile.payout_ready
      INTO v_application_id, v_tutor_id, v_payout_ready
    FROM marketplace_tutor_application AS application
    JOIN marketplace_tutor_profile AS profile USING (application_id)
    WHERE profile.actor_ref = p_actor_ref
      AND application.status = 'approved'
      AND profile.version = p_expected_profile_version
    FOR UPDATE OF application, profile;
    IF v_tutor_id IS NULL OR (p_publish AND NOT v_payout_ready) THEN RETURN NULL; END IF;

    PERFORM 1 FROM marketplace_tutor_offering
    WHERE tutor_id = v_tutor_id ORDER BY offering_id FOR UPDATE;
    SELECT count(*) INTO v_owned_count FROM marketplace_tutor_offering
    WHERE tutor_id = v_tutor_id;
    SELECT count(*), count(DISTINCT expected.offering_id)
      INTO v_expected_count, v_matched_count
    FROM jsonb_to_recordset(p_expected_offerings)
      AS expected(offering_id uuid, expected_version integer);
    IF v_expected_count <> v_owned_count OR v_matched_count <> v_expected_count THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO v_matched_count
    FROM marketplace_tutor_offering AS offering
    JOIN jsonb_to_recordset(p_expected_offerings)
      AS expected(offering_id uuid, expected_version integer)
      ON expected.offering_id = offering.offering_id
     AND expected.expected_version = offering.version
    WHERE offering.tutor_id = v_tutor_id;
    IF v_matched_count <> v_owned_count THEN RETURN NULL; END IF;

    UPDATE marketplace_tutor_profile
    SET is_published = p_publish, version = version + 1, updated_at = now()
    WHERE tutor_id = v_tutor_id;
    UPDATE marketplace_tutor_offering
    SET state = CASE WHEN p_publish THEN 'active' ELSE 'draft' END,
        version = version + 1, updated_at = now()
    WHERE tutor_id = v_tutor_id;
    RETURN v_application_id;
END;
$$;

CREATE TABLE marketplace_conversation_rate_event (
    event_id uuid PRIMARY KEY,
    learner_actor_ref text NOT NULL
        CHECK (learner_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id),
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketplace_conversation_rate_actor_idx
    ON marketplace_conversation_rate_event (learner_actor_ref, occurred_at DESC);
CREATE INDEX marketplace_conversation_rate_tutor_idx
    ON marketplace_conversation_rate_event (tutor_id, occurred_at DESC);

CREATE TABLE marketplace_booking_transition_operation (
    operation_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    actor_ref text NOT NULL CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    action text NOT NULL CHECK (action IN (
        'reschedule', 'cancel', 'complete', 'learner_no_show', 'tutor_no_show',
        'dispute', 'resolve_refund', 'resolve_release', 'calendar_conflict_refund'
    )),
    request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
    transaction_id bigint NOT NULL DEFAULT txid_current(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (booking_id, operation_id)
);

CREATE TABLE marketplace_booking_review_moderation_audit (
    audit_id uuid PRIMARY KEY,
    review_id uuid NOT NULL REFERENCES marketplace_booking_review(review_id),
    from_state text NOT NULL CHECK (from_state IN ('published', 'hidden')),
    to_state text NOT NULL CHECK (to_state IN ('published', 'hidden')),
    operator_actor_ref text NOT NULL
        CHECK (operator_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 1000),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_reconciliation_recovery_audit (
    audit_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    job_id uuid NOT NULL REFERENCES marketplace_payment_reconciliation_job(job_id),
    operator_actor_ref text NOT NULL
        CHECK (operator_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 1000),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_delivery_recovery_audit (
    audit_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    operator_actor_ref text NOT NULL
        CHECK (operator_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 1000),
    reminder_jobs_requeued integer NOT NULL CHECK (reminder_jobs_requeued >= 0),
    notification_jobs_requeued integer NOT NULL CHECK (notification_jobs_requeued >= 0),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reminder_jobs_requeued + notification_jobs_requeued > 0)
);

CREATE TABLE marketplace_money_recovery_audit (
    audit_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    operator_actor_ref text NOT NULL
        CHECK (operator_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 1000),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_notification_recovery_audit (
    audit_id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES marketplace_conversation(conversation_id),
    operator_actor_ref text NOT NULL
        CHECK (operator_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 1000),
    jobs_requeued integer NOT NULL CHECK (jobs_requeued > 0),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_calendar_booking_conflict (
    conflict_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    cache_generation uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolution_reason text CHECK (
      resolution_reason IS NULL OR resolution_reason IN ('rescheduled', 'inventory_released')
    ),
    CHECK ((resolved_at IS NULL) = (resolution_reason IS NULL))
);
CREATE UNIQUE INDEX marketplace_calendar_booking_conflict_active_idx
    ON marketplace_calendar_booking_conflict (booking_id) WHERE resolved_at IS NULL;

CREATE FUNCTION marketplace_resolve_calendar_booking_conflict()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at) THEN
        UPDATE marketplace_calendar_booking_conflict
        SET resolved_at = transaction_timestamp(), resolution_reason = 'rescheduled'
        WHERE booking_id = NEW.booking_id AND resolved_at IS NULL;
    ELSIF NEW.state NOT IN ('held', 'payment_pending', 'payment_ambiguous', 'confirmed') THEN
        UPDATE marketplace_calendar_booking_conflict
        SET resolved_at = transaction_timestamp(), resolution_reason = 'inventory_released'
        WHERE booking_id = NEW.booking_id AND resolved_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER marketplace_calendar_booking_conflict_resolution
AFTER UPDATE ON marketplace_booking
FOR EACH ROW EXECUTE FUNCTION marketplace_resolve_calendar_booking_conflict();

CREATE FUNCTION marketplace_enforce_money_operation_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (NEW.booking_id, NEW.kind, NEW.amount_minor, NEW.currency,
        NEW.idempotency_key, NEW.created_at)
       IS DISTINCT FROM
       (OLD.booking_id, OLD.kind, OLD.amount_minor, OLD.currency,
        OLD.idempotency_key, OLD.created_at)
       OR (OLD.provider_operation_id IS NOT NULL
           AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id) THEN
        RAISE EXCEPTION 'marketplace money operation authority is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER marketplace_money_operation_mutation_guard
BEFORE UPDATE ON marketplace_money_operation
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_money_operation_mutation();

CREATE OR REPLACE FUNCTION marketplace_enforce_booking_review()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM marketplace_booking
        WHERE booking_id = NEW.booking_id
          AND learner_actor_ref = NEW.learner_actor_ref
          AND tutor_id = NEW.tutor_id
          AND state = 'completed'
          AND dispute_deadline_at < now()
          AND money_state IN ('charged', 'transfer_pending', 'transfer_ambiguous', 'transferred')
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'review is not eligible for this booking'; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION marketplace_enforce_review_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (NEW.booking_id, NEW.learner_actor_ref, NEW.tutor_id, NEW.rating, NEW.body, NEW.created_at)
       IS DISTINCT FROM
       (OLD.booking_id, OLD.learner_actor_ref, OLD.tutor_id, OLD.rating, OLD.body, OLD.created_at)
    THEN RAISE EXCEPTION 'marketplace review content is immutable'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER marketplace_booking_review_mutation_guard
BEFORE UPDATE ON marketplace_booking_review
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_review_mutation();

CREATE OR REPLACE FUNCTION marketplace_enforce_booking_transition()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.learner_actor_ref <> OLD.learner_actor_ref
       OR NEW.tutor_id <> OLD.tutor_id
       OR NEW.tutor_actor_ref <> OLD.tutor_actor_ref
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.buffer_before_minutes <> OLD.buffer_before_minutes
       OR NEW.buffer_after_minutes <> OLD.buffer_after_minutes
       OR NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency
       OR NEW.commission_basis_points <> OLD.commission_basis_points
       OR NEW.commission_amount_minor <> OLD.commission_amount_minor
       OR NEW.tutor_amount_minor <> OLD.tutor_amount_minor
       OR NEW.commission_policy_id <> OLD.commission_policy_id
       OR NEW.cancellation_policy_id <> OLD.cancellation_policy_id
       OR NEW.cancellation_cutoff_hours <> OLD.cancellation_cutoff_hours
       OR NEW.dispute_window_hours <> OLD.dispute_window_hours
       OR NEW.provider_environment <> OLD.provider_environment
       OR NEW.provider_platform_account_id <> OLD.provider_platform_account_id
       OR NEW.client_idempotency_key <> OLD.client_idempotency_key
       OR NEW.hold_expires_at <> OLD.hold_expires_at
       OR NEW.meeting_url_snapshot IS DISTINCT FROM OLD.meeting_url_snapshot
       OR (OLD.provider_checkout_id IS NOT NULL
           AND NEW.provider_checkout_id IS DISTINCT FROM OLD.provider_checkout_id)
       OR (OLD.provider_payment_intent_id IS NOT NULL
           AND NEW.provider_payment_intent_id IS DISTINCT FROM OLD.provider_payment_intent_id)
       OR (OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
        RAISE EXCEPTION 'marketplace booking authority snapshots are immutable';
    END IF;
    IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       AND NOT (OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
                AND NEW.state = 'confirmed') THEN
        RAISE EXCEPTION 'marketplace confirmation evidence is invalid';
    END IF;
    IF NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.dispute_deadline_at IS DISTINCT FROM OLD.dispute_deadline_at THEN
        IF NOT (OLD.state = 'confirmed'
                AND NEW.state IN ('completed', 'learner_no_show')
                AND NEW.completed_at = NEW.updated_at
                AND NEW.dispute_deadline_at = NEW.completed_at
                    + make_interval(hours => NEW.dispute_window_hours)) THEN
            RAISE EXCEPTION 'marketplace dispute window evidence is invalid';
        END IF;
    END IF;
    IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancelled_by_role IS DISTINCT FROM OLD.cancelled_by_role THEN
        IF NOT (NEW.state = 'cancelled' AND NEW.cancelled_at = NEW.updated_at
                AND NEW.cancelled_by_role IS NOT NULL) THEN
            RAISE EXCEPTION 'marketplace cancellation evidence is invalid';
        END IF;
    END IF;
    IF NEW.no_show_role IS DISTINCT FROM OLD.no_show_role
       AND NOT ((NEW.state = 'learner_no_show' AND NEW.no_show_role = 'learner')
                OR (NEW.state = 'tutor_no_show' AND NEW.no_show_role = 'tutor')) THEN
        RAISE EXCEPTION 'marketplace no-show evidence is invalid';
    END IF;
    IF NEW.money_state IS DISTINCT FROM OLD.money_state THEN
        IF NEW.money_state = 'charged' AND NOT EXISTS (
            SELECT 1 FROM marketplace_money_ledger
            WHERE booking_id = NEW.booking_id AND kind = 'charge'
              AND amount_minor = NEW.amount_minor AND currency = NEW.currency
        ) THEN RAISE EXCEPTION 'charged state requires conserved ledger evidence';
        ELSIF NEW.money_state IN ('refund_pending', 'transfer_pending', 'reversal_pending')
          AND NOT EXISTS (
            SELECT 1 FROM marketplace_money_operation
            WHERE booking_id = NEW.booking_id
              AND kind = split_part(NEW.money_state, '_', 1)
              AND state IN ('queued', 'retryable', 'leased')
          ) THEN RAISE EXCEPTION 'pending money state requires a durable operation';
        ELSIF NEW.money_state IN ('refund_ambiguous', 'transfer_ambiguous', 'reversal_ambiguous')
          AND NOT EXISTS (
            SELECT 1 FROM marketplace_money_operation
            WHERE booking_id = NEW.booking_id
              AND kind = split_part(NEW.money_state, '_', 1)
              AND state IN ('ambiguous', 'dead')
          ) THEN RAISE EXCEPTION 'ambiguous money state requires operation evidence';
        ELSIF NEW.money_state IN ('refunded', 'transferred', 'reversed')
          AND NOT EXISTS (
            SELECT 1 FROM marketplace_money_ledger
            WHERE booking_id = NEW.booking_id
              AND kind = CASE NEW.money_state
                WHEN 'refunded' THEN 'refund'
                WHEN 'transferred' THEN 'transfer'
                ELSE 'reversal' END
          ) THEN RAISE EXCEPTION 'terminal money state requires conserved ledger evidence';
        END IF;
    END IF;
    IF (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at)
       AND NOT (OLD.state = 'confirmed' AND NEW.state = 'confirmed'
                AND NEW.schedule_version = OLD.schedule_version + 1) THEN
        RAISE EXCEPTION 'marketplace booking schedule changes require a revision';
    END IF;
    IF (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at)
       AND NOT EXISTS (
           SELECT 1 FROM marketplace_booking_transition_operation
           WHERE booking_id = NEW.booking_id AND action = 'reschedule'
             AND transaction_id = txid_current()
       ) THEN
        RAISE EXCEPTION 'marketplace schedule change requires current operation evidence';
    END IF;
    IF NEW.state <> OLD.state
       AND OLD.state IN ('confirmed', 'completed', 'learner_no_show', 'disputed')
       AND NOT EXISTS (
           SELECT 1 FROM marketplace_booking_transition_operation
           WHERE booking_id = NEW.booking_id
             AND transaction_id = txid_current()
             AND action = CASE
               WHEN OLD.state = 'confirmed' AND NEW.state = 'completed' THEN 'complete'
               WHEN OLD.state = 'confirmed' AND NEW.state = 'learner_no_show'
                 THEN 'learner_no_show'
               WHEN OLD.state = 'confirmed' AND NEW.state = 'tutor_no_show'
                 THEN 'tutor_no_show'
               WHEN OLD.state = 'confirmed' AND NEW.state = 'cancelled'
                 THEN action
               WHEN OLD.state IN ('completed', 'learner_no_show') AND NEW.state = 'disputed'
                 THEN 'dispute'
               WHEN OLD.state = 'disputed' AND NEW.state = 'resolved_refund'
                 THEN 'resolve_refund'
               WHEN OLD.state = 'disputed' AND NEW.state = 'resolved_release'
                 THEN 'resolve_release'
               ELSE NULL
             END
             AND (
               OLD.state <> 'confirmed' OR NEW.state <> 'cancelled'
               OR action IN ('cancel', 'calendar_conflict_refund')
             )
       ) THEN
        RAISE EXCEPTION 'marketplace lifecycle transition requires current operation evidence';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
        (OLD.state = 'held' AND NEW.state IN ('payment_pending', 'payment_ambiguous', 'expired'))
        OR (OLD.state = 'payment_ambiguous' AND NEW.state = 'payment_pending')
        OR (OLD.state IN ('payment_pending', 'payment_ambiguous')
            AND NEW.state IN ('confirmed', 'payment_failed', 'cancelled', 'expired'))
        OR (OLD.state = 'confirmed'
            AND NEW.state IN ('completed', 'cancelled', 'learner_no_show', 'tutor_no_show'))
        OR (OLD.state IN ('completed', 'learner_no_show')
            AND NEW.state IN ('disputed', 'resolved_release'))
        OR (OLD.state = 'disputed' AND NEW.state IN ('resolved_refund', 'resolved_release'))
    ) THEN RAISE EXCEPTION 'invalid marketplace booking transition'; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION marketplace_confirm_booking_payment(
    p_booking_id uuid,
    p_checkout_id text,
    p_payment_intent_id text,
    p_event_at timestamptz,
    p_environment text,
    p_platform_account_id text,
    p_amount_minor integer,
    p_currency text
)
RETURNS SETOF marketplace_booking LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_booking marketplace_booking%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM marketplace_booking
    WHERE booking_id = p_booking_id FOR UPDATE;
    IF v_booking.booking_id IS NULL
       OR v_booking.state NOT IN ('payment_pending', 'payment_ambiguous')
       OR v_booking.provider_environment <> p_environment
       OR v_booking.provider_platform_account_id <> p_platform_account_id
       OR v_booking.amount_minor <> p_amount_minor
       OR v_booking.currency <> p_currency
       OR p_payment_intent_id IS NULL
       OR (v_booking.provider_checkout_id IS NOT NULL
           AND v_booking.provider_checkout_id <> p_checkout_id)
       OR (v_booking.provider_payment_intent_id IS NOT NULL
           AND v_booking.provider_payment_intent_id <> p_payment_intent_id)
       OR p_event_at >= v_booking.hold_expires_at THEN
        RETURN;
    END IF;
    INSERT INTO marketplace_money_ledger
      (entry_id, booking_id, operation_id, kind, amount_minor, currency)
    VALUES (gen_random_uuid(), p_booking_id, NULL, 'charge', p_amount_minor, p_currency)
    ON CONFLICT (booking_id) WHERE kind = 'charge' DO NOTHING;
    RETURN QUERY
      UPDATE marketplace_booking
      SET state = 'confirmed',
          provider_checkout_id = coalesce(provider_checkout_id, p_checkout_id),
          provider_payment_intent_id = coalesce(
            provider_payment_intent_id, p_payment_intent_id),
          provider_event_at = p_event_at, confirmed_at = p_event_at,
          money_state = 'charged', checkout_url = NULL, updated_at = now()
      WHERE booking_id = p_booking_id
      RETURNING *;
END;
$$;

CREATE FUNCTION marketplace_queue_booking_money(
    p_booking_id uuid,
    p_kind text,
    p_available_at timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_booking marketplace_booking%ROWTYPE;
    v_action text;
    v_actor text;
    v_operation_id uuid;
    v_amount integer;
BEGIN
    SELECT * INTO v_booking FROM marketplace_booking
    WHERE booking_id = p_booking_id FOR UPDATE;
    SELECT action, actor_ref INTO v_action, v_actor
    FROM marketplace_booking_transition_operation
    WHERE booking_id = p_booking_id AND transaction_id = txid_current()
    ORDER BY created_at DESC LIMIT 1;
    IF v_booking.booking_id IS NULL OR v_action IS NULL
       OR p_kind NOT IN ('refund', 'transfer', 'reversal')
       OR NOT (
         (p_kind = 'refund' AND v_action IN (
           'cancel', 'tutor_no_show', 'resolve_refund', 'calendar_conflict_refund'))
         OR (p_kind = 'transfer' AND v_action IN (
           'cancel', 'complete', 'learner_no_show', 'resolve_release'))
         OR (p_kind = 'reversal' AND v_action IN ('dispute', 'resolve_refund'))
       )
       OR (v_action = 'cancel' AND p_kind = 'refund'
           AND v_actor = v_booking.learner_actor_ref
           AND v_booking.starts_at - transaction_timestamp()
               < make_interval(hours => v_booking.cancellation_cutoff_hours))
       OR (v_action = 'cancel' AND p_kind = 'transfer'
           AND (v_actor <> v_booking.learner_actor_ref
                OR v_booking.starts_at - transaction_timestamp()
                   >= make_interval(hours => v_booking.cancellation_cutoff_hours))) THEN
        RAISE EXCEPTION 'money operation lacks authorized lifecycle evidence';
    END IF;
    v_amount := CASE WHEN p_kind = 'refund' THEN v_booking.amount_minor
                     ELSE v_booking.tutor_amount_minor END;
    INSERT INTO marketplace_money_operation
      (operation_id, booking_id, kind, amount_minor, currency,
       idempotency_key, available_at)
    VALUES (gen_random_uuid(), p_booking_id, p_kind, v_amount, v_booking.currency,
            'booking:' || p_booking_id::text || ':' || p_kind, p_available_at)
    ON CONFLICT (booking_id, kind) DO UPDATE
    SET state = 'queued', available_at = excluded.available_at,
        safe_failure_code = NULL, updated_at = now()
    WHERE marketplace_money_operation.state = 'cancelled'
    RETURNING operation_id INTO v_operation_id;
    RETURN v_operation_id;
END;
$$;

CREATE FUNCTION marketplace_purge_bounded_events(p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_deleted integer := 0; v_count integer;
BEGIN
    IF p_limit NOT BETWEEN 1 AND 10000 THEN RETURN 0; END IF;
    WITH victims AS (
      SELECT event_id FROM marketplace_message_rate_event
      WHERE occurred_at < transaction_timestamp() - interval '30 days' ORDER BY occurred_at LIMIT p_limit
    ) DELETE FROM marketplace_message_rate_event WHERE event_id IN (SELECT event_id FROM victims);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted + v_count;
    WITH victims AS (
      SELECT event_id FROM marketplace_conversation_rate_event
      WHERE occurred_at < transaction_timestamp() - interval '30 days' ORDER BY occurred_at LIMIT p_limit
    ) DELETE FROM marketplace_conversation_rate_event WHERE event_id IN (SELECT event_id FROM victims);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted + v_count;
    WITH victims AS (
      SELECT event_id FROM marketplace_message_report_rate_event
      WHERE occurred_at < transaction_timestamp() - interval '30 days' ORDER BY occurred_at LIMIT p_limit
    ) DELETE FROM marketplace_message_report_rate_event WHERE event_id IN (SELECT event_id FROM victims);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted + v_count;
    WITH victims AS (
      SELECT state_hash FROM marketplace_calendar_oauth_state
      WHERE expires_at < transaction_timestamp() - interval '1 day' ORDER BY expires_at LIMIT p_limit
    ) DELETE FROM marketplace_calendar_oauth_state WHERE state_hash IN (SELECT state_hash FROM victims);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_deleted := v_deleted + v_count;
    WITH victims AS (
      SELECT provider_event_id FROM marketplace_stripe_webhook_event
      WHERE received_at < transaction_timestamp() - interval '90 days' ORDER BY received_at LIMIT p_limit
    ) DELETE FROM marketplace_stripe_webhook_event
      WHERE provider_event_id IN (SELECT provider_event_id FROM victims);
    GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_deleted + v_count;
END;
$$;

ALTER TABLE marketplace_conversation_rate_event OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_connect_refresh_job OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message_report_rate_event OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_booking_transition_operation OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_booking_review_moderation_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_reconciliation_recovery_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_delivery_recovery_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_money_recovery_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_notification_recovery_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_calendar_booking_conflict OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_set_tutor_publication_v2(text, integer, jsonb, boolean)
    OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_money_operation_mutation() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_review_mutation() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_booking_transition() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_confirm_booking_payment(uuid, text, text, timestamptz,
    text, text, integer, text) OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_queue_booking_money(uuid, text, timestamptz)
    OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_resolve_calendar_booking_conflict() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_purge_bounded_events(integer) OWNER TO cloudsqlsuperuser;

REVOKE DELETE ON marketplace_message_rate_event FROM glidelingo_app;
GRANT SELECT, INSERT ON marketplace_conversation_rate_event TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_connect_refresh_job TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_message_report_rate_event TO glidelingo_app;
GRANT SELECT ON marketplace_booking_transition_operation TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_booking_transition_operation
    TO glidelingo_marketplace_payment_worker;
GRANT SELECT, INSERT ON marketplace_booking_review_moderation_audit TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_reconciliation_recovery_audit TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_delivery_recovery_audit TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_money_recovery_audit TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_notification_recovery_audit TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_calendar_booking_conflict TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_set_tutor_publication(text, integer, integer, boolean)
    FROM glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_set_tutor_publication_v2(text, integer, jsonb, boolean)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_set_tutor_publication_v2(text, integer, jsonb, boolean)
    TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_enforce_money_operation_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_enforce_review_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_resolve_calendar_booking_conflict() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_purge_bounded_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_purge_bounded_events(integer)
    TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_confirm_booking_payment(uuid, text, text, timestamptz,
    text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_confirm_booking_payment(uuid, text, text, timestamptz,
    text, text, integer, text) FROM glidelingo_app;
GRANT EXECUTE ON FUNCTION marketplace_confirm_booking_payment(uuid, text, text, timestamptz,
    text, text, integer, text) TO glidelingo_marketplace_payment_worker;
REVOKE ALL ON FUNCTION marketplace_queue_booking_money(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_queue_booking_money(uuid, text, timestamptz)
    TO glidelingo_app;

REVOKE INSERT ON marketplace_money_operation FROM glidelingo_app;
REVOKE INSERT ON marketplace_money_ledger FROM glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_money_operation
    TO glidelingo_marketplace_payment_worker;
GRANT SELECT, INSERT ON marketplace_money_ledger
    TO glidelingo_marketplace_payment_worker;

REVOKE UPDATE ON marketplace_money_operation FROM glidelingo_app;
GRANT UPDATE (state, provider_operation_id, attempt, available_at, lease_owner,
              lease_expires_at, safe_failure_code, updated_at)
    ON marketplace_money_operation TO glidelingo_app;
REVOKE UPDATE ON marketplace_booking FROM glidelingo_app;
GRANT UPDATE (state, starts_at, ends_at, provider_checkout_id,
              provider_payment_intent_id, provider_event_at,
              checkout_url, schedule_version, money_state, completed_at,
              dispute_deadline_at, cancelled_at, cancelled_by_role,
              no_show_role, resolution_reason, updated_at)
    ON marketplace_booking TO glidelingo_app;
REVOKE UPDATE ON marketplace_booking_review FROM glidelingo_app;
GRANT UPDATE (moderation_state, moderation_reason, moderated_by_actor_ref, moderated_at)
    ON marketplace_booking_review TO glidelingo_app;

COMMIT;
