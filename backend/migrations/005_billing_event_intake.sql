BEGIN;

CREATE TABLE billing_event_provider_actor (
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
    environment text NOT NULL CHECK (environment ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    provider_account_ref text NOT NULL
        CHECK (length(provider_account_ref) BETWEEN 1 AND 255),
    actor_ref text NOT NULL
        CHECK (actor_ref ~ '^[a-z][a-z0-9_]{1,31}_v[0-9]+_[A-Za-z0-9_-]{43}$'),
    provider_actor_ciphertext bytea NOT NULL
        CHECK (octet_length(provider_actor_ciphertext) BETWEEN 30 AND 512),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, environment, provider_account_ref, actor_ref)
);

CREATE TABLE billing_event_inbox (
    event_ref uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
    environment text NOT NULL CHECK (environment ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    provider_account_ref text NOT NULL
        CHECK (length(provider_account_ref) BETWEEN 1 AND 255),
    provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 255),
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    actor_ref text,
    object_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    schema_version smallint NOT NULL CHECK (schema_version BETWEEN 1 AND 32767),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    UNIQUE (provider, environment, provider_account_ref, provider_event_id),
    CHECK (occurred_at >= timestamptz '2000-01-01 00:00:00+00'),
    CHECK (received_at >= timestamptz '2000-01-01 00:00:00+00'),
    CHECK (occurred_at <= received_at + interval '5 minutes'),
    CHECK (jsonb_typeof(object_refs) = 'object'),
    CHECK (actor_ref IS NULL OR actor_ref ~
        '^[a-z][a-z0-9_]{1,31}_v[0-9]+_[A-Za-z0-9_-]{43}$')
);

CREATE INDEX billing_event_inbox_received_idx
    ON billing_event_inbox (received_at, event_ref);

CREATE TABLE billing_event_delivery (
    delivery_ref uuid PRIMARY KEY,
    event_ref uuid NOT NULL REFERENCES billing_event_inbox (event_ref),
    consumer text NOT NULL CHECK (consumer IN ('pro_entitlement', 'affiliate_finance')),
    state text NOT NULL
        CHECK (state IN ('pending', 'processing', 'retryable', 'completed', 'manual_review')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    last_error_class text CHECK (last_error_class IS NULL OR last_error_class IN (
        'consumer_not_implemented',
        'database_unavailable',
        'invalid_provider_actor',
        'provider_unavailable',
        'unsupported_delivery',
        'unexpected_failure'
    )),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_ref, consumer),
    CHECK ((state = 'processing') = (lease_token IS NOT NULL)),
    CHECK ((state = 'processing') = (lease_expires_at IS NOT NULL)),
    CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
    CHECK (lease_expires_at IS NULL OR lease_expires_at > updated_at)
);

CREATE INDEX billing_event_delivery_ready_idx
    ON billing_event_delivery (next_attempt_at, created_at, delivery_ref)
    WHERE state IN ('pending', 'retryable');

CREATE INDEX billing_event_delivery_expired_lease_idx
    ON billing_event_delivery (lease_expires_at, delivery_ref)
    WHERE state = 'processing';

ALTER TABLE billing_event_provider_actor OWNER TO cloudsqlsuperuser;
ALTER TABLE billing_event_inbox OWNER TO cloudsqlsuperuser;
ALTER TABLE billing_event_delivery OWNER TO cloudsqlsuperuser;

GRANT SELECT, INSERT ON billing_event_provider_actor TO glidelingo_app;
GRANT SELECT, INSERT ON billing_event_inbox TO glidelingo_app;
GRANT SELECT, INSERT, UPDATE ON billing_event_delivery TO glidelingo_app;

COMMIT;
