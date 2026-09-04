BEGIN;

CREATE TABLE marketplace_learning_context (
    booking_id uuid PRIMARY KEY REFERENCES marketplace_booking(booking_id),
    learner_actor_ref text NOT NULL
        CHECK (learner_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    consent_state text NOT NULL CHECK (consent_state IN ('granted', 'revoked')),
    selected_goal text NOT NULL CHECK (length(selected_goal) BETWEEN 3 AND 300),
    language_code text NOT NULL
        CHECK (language_code ~ '^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
    course_id text CHECK (course_id IS NULL OR length(course_id) BETWEEN 1 AND 100),
    course_title text CHECK (course_title IS NULL OR length(course_title) BETWEEN 1 AND 200),
    consented_at timestamptz NOT NULL,
    revoked_at timestamptz,
    access_expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((consent_state = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK (access_expires_at > consented_at),
    CHECK ((course_id IS NULL) = (course_title IS NULL))
);

CREATE TABLE marketplace_learning_context_capability (
    booking_id uuid NOT NULL REFERENCES marketplace_learning_context(booking_id),
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
    capability text NOT NULL CHECK (length(capability) BETWEEN 2 AND 160),
    PRIMARY KEY (booking_id, position),
    UNIQUE (booking_id, capability)
);

CREATE TABLE marketplace_learning_context_review_focus (
    booking_id uuid NOT NULL REFERENCES marketplace_learning_context(booking_id),
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
    review_focus text NOT NULL CHECK (length(review_focus) BETWEEN 2 AND 160),
    PRIMARY KEY (booking_id, position),
    UNIQUE (booking_id, review_focus)
);

CREATE TABLE marketplace_learning_context_audit (
    audit_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES marketplace_booking(booking_id),
    version integer NOT NULL CHECK (version >= 1),
    event text NOT NULL CHECK (event IN ('granted', 'revoked')),
    actor_ref text NOT NULL CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_tutor_follow_up (
    follow_up_id uuid PRIMARY KEY,
    booking_id uuid NOT NULL UNIQUE REFERENCES marketplace_booking(booking_id),
    tutor_actor_ref text NOT NULL
        CHECK (tutor_actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    summary text NOT NULL CHECK (length(summary) BETWEEN 8 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_tutor_follow_up_recommendation (
    follow_up_id uuid NOT NULL REFERENCES marketplace_tutor_follow_up(follow_up_id),
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 7),
    kind text NOT NULL CHECK (kind IN ('course_content', 'free_text')),
    content_reference text
        CHECK (content_reference IS NULL OR length(content_reference) BETWEEN 1 AND 160),
    recommendation text NOT NULL CHECK (length(recommendation) BETWEEN 3 AND 500),
    PRIMARY KEY (follow_up_id, position),
    CHECK ((kind = 'course_content') = (content_reference IS NOT NULL))
);

CREATE FUNCTION marketplace_enforce_learning_context_booking()
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
          AND state IN ('confirmed', 'completed', 'cancelled', 'learner_no_show',
                        'tutor_no_show', 'disputed', 'resolved_refund', 'resolved_release')
          AND confirmed_at IS NOT NULL
          AND NEW.access_expires_at = ends_at + interval '7 days'
    ) THEN
        RAISE EXCEPTION 'learning context must match an eligible confirmed booking';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_learning_context_booking_guard
BEFORE INSERT OR UPDATE ON marketplace_learning_context
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_learning_context_booking();

CREATE FUNCTION marketplace_enforce_follow_up_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM marketplace_booking
        WHERE booking_id = NEW.booking_id
          AND tutor_actor_ref = NEW.tutor_actor_ref
          AND state IN ('completed', 'learner_no_show', 'resolved_release')
          AND confirmed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'tutor follow-up must match an eligible completed booking';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_tutor_follow_up_booking_guard
BEFORE INSERT OR UPDATE ON marketplace_tutor_follow_up
FOR EACH ROW EXECUTE FUNCTION marketplace_enforce_follow_up_booking();

ALTER TABLE marketplace_learning_context OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_learning_context_capability OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_learning_context_review_focus OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_learning_context_audit OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_follow_up OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_tutor_follow_up_recommendation OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_learning_context_booking() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION marketplace_enforce_follow_up_booking() OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT, UPDATE ON marketplace_learning_context TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_learning_context_capability TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_learning_context_review_focus TO glidelingo_app;
GRANT SELECT, INSERT ON marketplace_learning_context_audit TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_tutor_follow_up TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_tutor_follow_up_recommendation TO glidelingo_app;
REVOKE ALL ON FUNCTION marketplace_enforce_learning_context_booking() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_enforce_follow_up_booking() FROM PUBLIC;

COMMIT;
