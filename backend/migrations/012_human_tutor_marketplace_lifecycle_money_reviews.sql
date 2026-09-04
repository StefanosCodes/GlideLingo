BEGIN;

ALTER TABLE marketplace_booking
    DROP CONSTRAINT marketplace_booking_state_check;
DO $$
DECLARE
    v_constraint text;
BEGIN
    SELECT constraint_name INTO v_constraint
    FROM information_schema.check_constraints AS checks
    JOIN information_schema.table_constraints AS constraints
      USING (constraint_catalog, constraint_schema, constraint_name)
    WHERE constraints.table_schema = current_schema()
      AND constraints.table_name = 'marketplace_booking'
      AND checks.check_clause LIKE '%confirmed_at IS NOT NULL%';
    IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE marketplace_booking DROP CONSTRAINT %I', v_constraint);
    END IF;
END;
$$;
ALTER TABLE marketplace_booking
    ADD CONSTRAINT marketplace_booking_state_check CHECK (state IN (
        'held', 'payment_pending', 'payment_ambiguous', 'payment_failed', 'confirmed',
        'completed', 'cancelled', 'learner_no_show', 'tutor_no_show', 'disputed',
        'resolved_refund', 'resolved_release', 'expired'
    ));
ALTER TABLE marketplace_booking
    ADD COLUMN schedule_version integer NOT NULL DEFAULT 1 CHECK (schedule_version >= 1),
    ADD COLUMN money_state text CHECK (money_state IN (
        'charged', 'refund_pending', 'refund_ambiguous', 'refunded',
        'transfer_pending', 'transfer_ambiguous', 'transferred',
        'reversal_pending', 'reversal_ambiguous', 'reversed'
    )),
    ADD COLUMN completed_at timestamptz,
    ADD COLUMN dispute_deadline_at timestamptz,
    ADD COLUMN cancelled_at timestamptz,
    ADD COLUMN cancelled_by_role text CHECK (cancelled_by_role IN ('learner', 'tutor', 'operator')),
    ADD COLUMN no_show_role text CHECK (no_show_role IN ('learner', 'tutor')),
    ADD COLUMN resolution_reason text CHECK (
        resolution_reason IS NULL OR length(resolution_reason) BETWEEN 8 AND 1000
    ),
    ADD CONSTRAINT marketplace_booking_completion_check CHECK (
        (completed_at IS NULL AND dispute_deadline_at IS NULL)
        OR (completed_at IS NOT NULL AND dispute_deadline_at > completed_at)
    );

UPDATE marketplace_booking SET money_state = 'charged' WHERE state = 'confirmed';

ALTER TABLE marketplace_booking
    ADD CONSTRAINT marketplace_booking_money_presence_check CHECK (
        (state IN ('confirmed', 'completed', 'cancelled', 'learner_no_show',
                   'tutor_no_show', 'disputed', 'resolved_refund', 'resolved_release'))
        = (money_state IS NOT NULL)
    ),
    ADD CONSTRAINT marketplace_booking_confirmed_at_check CHECK (
        (state IN ('confirmed', 'completed', 'cancelled', 'learner_no_show',
                   'tutor_no_show', 'disputed', 'resolved_refund', 'resolved_release'))
        = (confirmed_at IS NOT NULL)
    );

CREATE TABLE marketplace_booking_schedule_revision (
    revision_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    version integer NOT NULL CHECK (version >= 2),
    prior_starts_at timestamptz NOT NULL,
    prior_ends_at timestamptz NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    actor_ref text NOT NULL CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (booking_id, version),
    CHECK (starts_at < ends_at)
);

CREATE TABLE marketplace_money_operation (
    operation_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    kind text NOT NULL CHECK (kind IN ('refund', 'transfer', 'reversal')),
    state text NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'leased', 'retryable', 'ambiguous', 'completed', 'dead', 'cancelled'
    )),
    amount_minor integer NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL CHECK (currency = 'USD'),
    provider_operation_id text UNIQUE CHECK (
        provider_operation_id IS NULL OR provider_operation_id ~ '^(re|tr|trr)_[A-Za-z0-9]{8,}$'
    ),
    idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 12 AND 200),
    attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 8),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),
    lease_expires_at timestamptz,
    safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) BETWEEN 2 AND 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (booking_id, kind),
    CHECK ((state = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX marketplace_money_operation_claim_idx
    ON marketplace_money_operation (available_at, created_at, operation_id)
    WHERE state IN ('queued', 'retryable');

CREATE TABLE marketplace_money_ledger (
    entry_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    operation_id uuid UNIQUE REFERENCES marketplace_money_operation(operation_id),
    kind text NOT NULL CHECK (kind IN ('charge', 'refund', 'transfer', 'reversal')),
    amount_minor integer NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL CHECK (currency = 'USD'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'charge') = (operation_id IS NULL))
);

CREATE UNIQUE INDEX marketplace_money_ledger_charge_idx
    ON marketplace_money_ledger (booking_id) WHERE kind = 'charge';

INSERT INTO marketplace_money_ledger (entry_id, booking_id, kind, amount_minor, currency)
SELECT gen_random_uuid(), booking_id, 'charge', amount_minor, currency
FROM marketplace_booking WHERE money_state IS NOT NULL;

CREATE TABLE marketplace_booking_reminder_job (
    job_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    kind text NOT NULL CHECK (kind IN ('lesson_reminder', 'completion_prompt')),
    state text NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'leased', 'retryable', 'completed', 'dead', 'cancelled'
    )),
    available_at timestamptz NOT NULL,
    lease_owner text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),
    lease_expires_at timestamptz,
    attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 8),
    safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) BETWEEN 2 AND 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (booking_id, kind),
    CHECK ((state = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX marketplace_booking_reminder_claim_idx
    ON marketplace_booking_reminder_job (available_at, created_at, job_id)
    WHERE state IN ('queued', 'retryable');

CREATE TABLE marketplace_booking_review (
    review_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL UNIQUE REFERENCES marketplace_booking(booking_id),
    learner_actor_ref text NOT NULL CHECK (learner_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id),
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body text CHECK (body IS NULL OR length(body) BETWEEN 8 AND 1000),
    moderation_state text NOT NULL DEFAULT 'published' CHECK (
        moderation_state IN ('published', 'hidden')
    ),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION marketplace_enforce_money_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_booking marketplace_booking%ROWTYPE;
    v_charged bigint;
    v_refunded bigint;
    v_transferred bigint;
    v_reversed bigint;
BEGIN
    SELECT * INTO v_booking FROM marketplace_booking
    WHERE booking_id = NEW.booking_id FOR UPDATE;
    SELECT coalesce(sum(amount_minor) FILTER (WHERE kind = 'charge'), 0),
           coalesce(sum(amount_minor) FILTER (WHERE kind = 'refund'), 0),
           coalesce(sum(amount_minor) FILTER (WHERE kind = 'transfer'), 0),
           coalesce(sum(amount_minor) FILTER (WHERE kind = 'reversal'), 0)
      INTO v_charged, v_refunded, v_transferred, v_reversed
    FROM marketplace_money_ledger WHERE booking_id = NEW.booking_id;
    IF NEW.kind = 'charge' THEN v_charged := v_charged + NEW.amount_minor;
    ELSIF NEW.kind = 'refund' THEN v_refunded := v_refunded + NEW.amount_minor;
    ELSIF NEW.kind = 'transfer' THEN v_transferred := v_transferred + NEW.amount_minor;
    ELSE v_reversed := v_reversed + NEW.amount_minor;
    END IF;
    IF v_charged <> v_booking.amount_minor
       OR v_refunded > v_charged
       OR v_transferred > v_booking.tutor_amount_minor
       OR v_reversed > v_transferred
       OR (v_refunded > 0 AND v_transferred <> v_reversed) THEN
        RAISE EXCEPTION 'marketplace money ledger would violate conservation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_money_ledger_conservation
BEFORE INSERT ON marketplace_money_ledger
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_money_ledger();

CREATE FUNCTION marketplace_enforce_booking_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM marketplace_booking
        WHERE booking_id = NEW.booking_id
          AND learner_actor_ref = NEW.learner_actor_ref
          AND tutor_id = NEW.tutor_id
          AND state = 'completed'
          AND dispute_deadline_at <= now()
          AND money_state IN ('charged', 'transferred')
    ) THEN
        RAISE EXCEPTION 'review is not eligible for this booking';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_booking_review_eligibility
BEFORE INSERT ON marketplace_booking_review
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_booking_review();

CREATE OR REPLACE FUNCTION marketplace_enforce_booking_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NEW.learner_actor_ref <> OLD.learner_actor_ref
       OR NEW.tutor_id <> OLD.tutor_id
       OR NEW.tutor_actor_ref <> OLD.tutor_actor_ref
       OR NEW.offering_id <> OLD.offering_id
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
       OR NEW.client_idempotency_key <> OLD.client_idempotency_key THEN
        RAISE EXCEPTION 'marketplace booking authority snapshots are immutable';
    END IF;
    IF (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at)
       AND NOT (OLD.state = 'confirmed' AND NEW.state = 'confirmed'
                AND NEW.schedule_version = OLD.schedule_version + 1) THEN
        RAISE EXCEPTION 'marketplace booking schedule changes require a revision';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
        (OLD.state = 'held' AND NEW.state IN ('payment_pending', 'payment_ambiguous', 'expired'))
        OR (OLD.state = 'payment_ambiguous' AND NEW.state = 'payment_pending')
        OR (OLD.state IN ('payment_pending', 'payment_ambiguous')
            AND NEW.state IN ('confirmed', 'payment_failed', 'cancelled', 'expired'))
        OR (OLD.state = 'confirmed'
            AND NEW.state IN ('completed', 'cancelled', 'learner_no_show', 'tutor_no_show'))
        OR (OLD.state = 'completed' AND NEW.state IN ('disputed', 'resolved_release'))
        OR (OLD.state = 'disputed' AND NEW.state IN ('resolved_refund', 'resolved_release'))
    ) THEN
        RAISE EXCEPTION 'invalid marketplace booking transition';
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE marketplace_booking_schedule_revision OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_money_operation OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_money_ledger OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_booking_reminder_job OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_booking_review OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_money_ledger() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_booking_review() OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT ON marketplace_booking_schedule_revision TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_money_operation TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_money_ledger TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_booking_reminder_job TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_booking_review TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_enforce_money_ledger() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_enforce_booking_review() FROM PUBLIC;

COMMIT;
