BEGIN;

ALTER TABLE marketplace_operator_capability
    DROP CONSTRAINT marketplace_operator_capability_capability_check;
ALTER TABLE marketplace_operator_capability
    ADD CONSTRAINT marketplace_operator_capability_capability_check CHECK (
        capability IN ('review_tutor_applications', 'manage_tutor_status',
                       'verify_tutor_credentials', 'review_message_reports')
    );

CREATE TABLE marketplace_conversation (
    conversation_id uuid PRIMARY KEY,
    learner_actor_ref text NOT NULL
        CHECK (learner_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id),
    tutor_actor_ref text NOT NULL
        CHECK (tutor_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    booking_id uuid,
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (learner_actor_ref <> tutor_actor_ref),
    UNIQUE (learner_actor_ref, tutor_id, booking_id)
);

CREATE INDEX marketplace_conversation_tutor_actor_idx
    ON marketplace_conversation (tutor_actor_ref, updated_at DESC, conversation_id);
CREATE INDEX marketplace_conversation_learner_actor_idx
    ON marketplace_conversation (learner_actor_ref, updated_at DESC, conversation_id);
CREATE UNIQUE INDEX marketplace_conversation_prebooking_unique_idx
    ON marketplace_conversation (learner_actor_ref, tutor_id) WHERE booking_id IS NULL;

CREATE TABLE marketplace_message (
    message_id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL
        REFERENCES marketplace_conversation(conversation_id) ON DELETE CASCADE,
    sender_actor_ref text
        CHECK (sender_actor_ref IS NULL OR sender_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    kind text NOT NULL CHECK (kind IN ('user', 'system')),
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    client_message_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'system') = (sender_actor_ref IS NULL))
);

CREATE INDEX marketplace_message_conversation_cursor_idx
    ON marketplace_message (conversation_id, created_at DESC, message_id DESC);
CREATE UNIQUE INDEX marketplace_message_client_idempotency_idx
    ON marketplace_message (conversation_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE TABLE marketplace_actor_block (
    blocker_actor_ref text NOT NULL
        CHECK (blocker_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    blocked_actor_ref text NOT NULL
        CHECK (blocked_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_actor_ref, blocked_actor_ref),
    CHECK (blocker_actor_ref <> blocked_actor_ref)
);

CREATE TABLE marketplace_message_report (
    report_id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES marketplace_conversation(conversation_id),
    message_id uuid REFERENCES marketplace_message(message_id),
    reporter_actor_ref text NOT NULL
        CHECK (reporter_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    subject_actor_ref text NOT NULL
        CHECK (subject_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    reason text NOT NULL CHECK (reason IN ('harassment', 'spam', 'unsafe', 'other')),
    details text CHECK (details IS NULL OR length(details) BETWEEN 8 AND 1000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolved_by_actor_ref text
        CHECK (resolved_by_actor_ref IS NULL OR
               resolved_by_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    resolution_reason text
        CHECK (resolution_reason IS NULL OR length(resolution_reason) BETWEEN 8 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK ((status = 'open') =
           (resolved_by_actor_ref IS NULL AND resolution_reason IS NULL AND resolved_at IS NULL)),
    UNIQUE (conversation_id, message_id, reporter_actor_ref)
);

CREATE INDEX marketplace_message_report_queue_idx
    ON marketplace_message_report (created_at, report_id) WHERE status = 'open';

CREATE TABLE marketplace_message_report_access_audit (
    audit_id uuid PRIMARY KEY,
    report_id uuid NOT NULL REFERENCES marketplace_message_report(report_id),
    operator_actor_ref text NOT NULL
        CHECK (operator_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    action text NOT NULL CHECK (action IN ('viewed', 'resolved')),
    reason text CHECK (reason IS NULL OR length(reason) BETWEEN 8 AND 1000),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_message_rate_event (
    event_id uuid PRIMARY KEY,
    actor_ref text NOT NULL CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketplace_message_rate_event_actor_idx
    ON marketplace_message_rate_event (actor_ref, occurred_at DESC);

CREATE TABLE marketplace_message_notification_preference (
    actor_ref text PRIMARY KEY CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    email_enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_message_notification_job (
    job_id uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES marketplace_message(message_id) ON DELETE CASCADE,
    recipient_actor_ref text NOT NULL
        CHECK (recipient_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'leased', 'retryable', 'completed', 'dead')),
    attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 8),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),
    lease_expires_at timestamptz,
    safe_failure_code text CHECK (
        safe_failure_code IS NULL OR safe_failure_code IN ('timeout', 'unavailable', 'rejected')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id, recipient_actor_ref),
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX marketplace_message_notification_job_claim_idx
    ON marketplace_message_notification_job (available_at, created_at, job_id)
    WHERE status IN ('queued', 'retryable');

ALTER TABLE marketplace_conversation OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_actor_block OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message_report OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message_report_access_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message_rate_event OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message_notification_preference OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_message_notification_job OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT, UPDATE ON marketplace_conversation TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_message TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_actor_block TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_message_report TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_message_report_access_audit TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_message_rate_event TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_message_notification_preference TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_message_notification_job TO glidelingo_app;

COMMIT;
