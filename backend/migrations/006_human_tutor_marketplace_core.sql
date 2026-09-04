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
    is_published boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_operator_capability (
    actor_ref text NOT NULL
        CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    capability text NOT NULL CHECK (capability IN ('review_tutor_applications')),
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
                   'application_review_started', 'application_decided')
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
ALTER TABLE marketplace_operator_capability OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_audit_event OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT, UPDATE ON marketplace_tutor_application TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_tutor_application_language TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_tutor_application_specialty TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_tutor_profile TO glidelingo_app;
GRANT SELECT ON marketplace_operator_capability TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_audit_event TO glidelingo_app;

COMMIT;
