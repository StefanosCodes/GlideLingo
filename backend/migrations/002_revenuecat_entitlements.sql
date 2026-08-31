BEGIN;

CREATE TABLE revenuecat_entitlement_state (
    actor_ref text NOT NULL CHECK (actor_ref ~ '^rcusr_v1_[A-Za-z0-9_-]{43}$'),
    entitlement_id text NOT NULL CHECK (entitlement_id = 'pro'),
    environment text NOT NULL CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
    is_active boolean NOT NULL,
    expires_at timestamptz,
    provider_event_at timestamptz NOT NULL,
    verified_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_ref, entitlement_id, environment),
    CHECK (provider_event_at >= timestamptz '2000-01-01 00:00:00+00'),
    CHECK (verified_at >= timestamptz '2000-01-01 00:00:00+00')
);

CREATE INDEX revenuecat_entitlement_state_stale_idx
    ON revenuecat_entitlement_state (verified_at)
    WHERE is_active;

CREATE TABLE revenuecat_webhook_event (
    event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 255),
    environment text NOT NULL CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
    actor_ref text NOT NULL CHECK (actor_ref ~ '^rcusr_v1_[A-Za-z0-9_-]{43}$'),
    event_at timestamptz NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    CHECK (event_at >= timestamptz '2000-01-01 00:00:00+00')
);

CREATE INDEX revenuecat_webhook_event_processed_idx
    ON revenuecat_webhook_event (processed_at);

GRANT SELECT, INSERT, UPDATE ON revenuecat_entitlement_state TO glidelingo_app;
GRANT SELECT, INSERT ON revenuecat_webhook_event TO glidelingo_app;

COMMIT;
