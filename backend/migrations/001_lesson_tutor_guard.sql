BEGIN;

CREATE TABLE lesson_tutor_turn_guard (
    actor_ref text NOT NULL CHECK (actor_ref ~ '^tusr_v1_[A-Za-z0-9_-]{43}$'),
    operation text NOT NULL,
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 100),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    turn_ref uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'retryable', 'ambiguous')),
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_ref, operation, idempotency_key),
    CHECK ((status = 'completed') = (response IS NOT NULL))
);

CREATE INDEX lesson_tutor_turn_guard_actor_created_idx
    ON lesson_tutor_turn_guard (actor_ref, created_at DESC);

CREATE INDEX lesson_tutor_turn_guard_created_idx
    ON lesson_tutor_turn_guard (created_at DESC);

CREATE INDEX lesson_tutor_turn_guard_in_progress_idx
    ON lesson_tutor_turn_guard (updated_at)
    WHERE status = 'in_progress';

CREATE INDEX lesson_tutor_turn_guard_terminal_updated_idx
    ON lesson_tutor_turn_guard (updated_at)
    WHERE status <> 'in_progress';

GRANT SELECT, INSERT, UPDATE ON lesson_tutor_turn_guard TO glidelingo_app;

COMMIT;
