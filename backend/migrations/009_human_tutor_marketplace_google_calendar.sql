BEGIN;

-- Marketplace migration 007 belongs to the integration queue. This additive migration must run
-- only after 008. Calendar data is deliberately limited to encrypted credentials and busy ranges.

CREATE TABLE marketplace_calendar_oauth_state (
    state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
    tutor_id uuid NOT NULL REFERENCES marketplace_tutor_profile(tutor_id) ON DELETE CASCADE,
    actor_ref text NOT NULL CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 12 AND 500),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX marketplace_calendar_oauth_state_expiry_idx
    ON marketplace_calendar_oauth_state (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE marketplace_calendar_connection (
    tutor_id uuid PRIMARY KEY REFERENCES marketplace_tutor_profile(tutor_id) ON DELETE CASCADE,
    actor_ref text NOT NULL UNIQUE CHECK (actor_ref ~ '^mktusr_v1_[A-Za-z0-9_-]{43}$'),
    provider text NOT NULL DEFAULT 'google' CHECK (provider = 'google'),
    encrypted_refresh_token bytea CHECK (octet_length(encrypted_refresh_token) BETWEEN 29 AND 8192),
    token_key_version smallint CHECK (token_key_version BETWEEN 1 AND 32767),
    granted_scope text NOT NULL
        CHECK (granted_scope = 'https://www.googleapis.com/auth/calendar.freebusy'),
    status text NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'stale', 'reconnect_required', 'revoked')),
    cache_generation uuid,
    last_refreshed_at timestamptz,
    cache_expires_at timestamptz,
    safe_failure_code text
        CHECK (safe_failure_code IS NULL OR safe_failure_code IN
               ('rate_limited', 'timeout', 'unavailable', 'revoked', 'invalid_response')),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((cache_generation IS NULL) = (last_refreshed_at IS NULL)),
    CHECK ((cache_generation IS NULL) = (cache_expires_at IS NULL)),
    CHECK (cache_expires_at IS NULL OR cache_expires_at > last_refreshed_at),
    CHECK ((encrypted_refresh_token IS NULL) = (token_key_version IS NULL)),
    CHECK (status NOT IN ('connected', 'stale') OR encrypted_refresh_token IS NOT NULL)
);

CREATE TABLE marketplace_calendar_busy_interval (
    tutor_id uuid NOT NULL REFERENCES marketplace_calendar_connection(tutor_id) ON DELETE CASCADE,
    generation uuid NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    PRIMARY KEY (tutor_id, generation, starts_at, ends_at),
    CHECK (starts_at < ends_at),
    CHECK (ends_at - starts_at <= interval '31 days')
);

CREATE INDEX marketplace_calendar_busy_interval_lookup_idx
    ON marketplace_calendar_busy_interval (tutor_id, generation, starts_at, ends_at);

CREATE TABLE marketplace_calendar_refresh_job (
    job_id uuid PRIMARY KEY,
    tutor_id uuid NOT NULL UNIQUE
        REFERENCES marketplace_calendar_connection(tutor_id) ON DELETE CASCADE,
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

CREATE INDEX marketplace_calendar_refresh_claim_idx
    ON marketplace_calendar_refresh_job (available_at, created_at, job_id)
    WHERE status IN ('queued', 'retryable');

ALTER TABLE marketplace_calendar_oauth_state OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_calendar_connection OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_calendar_busy_interval OWNER TO cloudsqlsuperuser;
ALTER TABLE marketplace_calendar_refresh_job OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_calendar_oauth_state TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_calendar_connection TO glidelingo_app;
GRANT SELECT, INSERT, DELETE ON marketplace_calendar_busy_interval TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON marketplace_calendar_refresh_job TO glidelingo_app;

COMMIT;
