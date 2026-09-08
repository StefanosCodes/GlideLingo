BEGIN;

-- Marketplace migration 007 belongs to the affiliate integration queue. This additive migration
-- is operator-run only after predecessors 004-007 have been reconciled and applied.

ALTER TABLE marketplace_tutor_profile
    ADD COLUMN lead_time_minutes integer NOT NULL DEFAULT 720
        CHECK (lead_time_minutes BETWEEN 60 AND 10080),
    ADD COLUMN buffer_before_minutes integer NOT NULL DEFAULT 0
        CHECK (buffer_before_minutes BETWEEN 0 AND 120),
    ADD COLUMN buffer_after_minutes integer NOT NULL DEFAULT 0
        CHECK (buffer_after_minutes BETWEEN 0 AND 120);

CREATE TABLE marketplace_tutor_dialect (
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 7),
    dialect_code text NOT NULL CHECK (dialect_code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})+$'),
    PRIMARY KEY (tutor_id, dialect_code),
    UNIQUE (tutor_id, position)
);

CREATE TABLE marketplace_availability_rule (
    rule_id uuid PRIMARY KEY,
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id) ON DELETE CASCADE,
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_local time NOT NULL,
    end_local time NOT NULL,
    effective_from date NOT NULL,
    effective_until date,
    time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (start_local < end_local),
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE INDEX marketplace_availability_rule_tutor_window_idx
    ON marketplace_availability_rule (tutor_id, weekday, effective_from, effective_until)
    WHERE enabled;

CREATE TABLE marketplace_availability_exception (
    exception_id uuid PRIMARY KEY,
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id) ON DELETE CASCADE,
    local_date date NOT NULL,
    start_local time NOT NULL,
    end_local time NOT NULL,
    kind text NOT NULL CHECK (kind IN ('available', 'unavailable')),
    time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (start_local < end_local),
    UNIQUE (tutor_id, local_date, start_local, end_local, kind)
);

CREATE INDEX marketplace_availability_exception_tutor_date_idx
    ON marketplace_availability_exception (tutor_id, local_date, start_local);

CREATE TABLE marketplace_tutor_favorite (
    learner_actor_ref text NOT NULL
        CHECK (learner_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_actor_ref, tutor_id)
);

CREATE INDEX marketplace_tutor_favorite_learner_idx
    ON marketplace_tutor_favorite (learner_actor_ref, created_at DESC, tutor_id);

ALTER TABLE marketplace_tutor_dialect OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_availability_rule OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_availability_exception OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_favorite OWNER TO cloudsqlsuperuser;

GRANT UPDATE (lead_time_minutes, buffer_before_minutes, buffer_after_minutes, version, updated_at)
    ON marketplace_tutor_profile TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_tutor_dialect TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_availability_rule TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_availability_exception TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_tutor_favorite TO glidelingo_app;

COMMIT;
