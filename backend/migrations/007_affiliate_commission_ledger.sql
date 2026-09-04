BEGIN;

ALTER TABLE billing_event_delivery
    DROP CONSTRAINT billing_event_delivery_last_error_class_check;
ALTER TABLE billing_event_delivery
    ADD CONSTRAINT billing_event_delivery_last_error_class_check CHECK (
      last_error_class IS NULL OR last_error_class IN (
        'commission_policy_unavailable',
        'commission_source_unavailable',
        'consumer_not_implemented',
        'database_unavailable',
        'invalid_provider_actor',
        'provider_unavailable',
        'unsupported_delivery',
        'unexpected_failure'
      )
    );

CREATE TABLE affiliate_commission_policy (
    id uuid PRIMARY KEY,
    program_version_id uuid NOT NULL REFERENCES affiliate_program_version(id),
    policy_version integer NOT NULL CHECK (policy_version > 0),
    status text NOT NULL CHECK (status IN ('draft', 'active')),
    effective_from timestamptz,
    effective_until timestamptz,
    activated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (program_version_id, policy_version),
    UNIQUE (id, program_version_id),
    CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
    CHECK (
      (status = 'draft' AND effective_from IS NULL AND effective_until IS NULL
       AND activated_at IS NULL)
      OR
      (status = 'active' AND effective_from IS NOT NULL AND activated_at IS NOT NULL)
    )
);

CREATE TABLE affiliate_commission_rule (
    id uuid PRIMARY KEY,
    policy_id uuid NOT NULL REFERENCES affiliate_commission_policy(id),
    product_ref text NOT NULL CHECK (length(product_ref) BETWEEN 1 AND 255),
    currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    basis_amount_minor bigint NOT NULL CHECK (basis_amount_minor > 0),
    commission_rate_basis_points integer NOT NULL
        CHECK (commission_rate_basis_points BETWEEN 1 AND 10000),
    rounding_mode text NOT NULL CHECK (rounding_mode = 'half_up'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (policy_id, product_ref),
    UNIQUE (id, policy_id)
);

ALTER TABLE affiliate_attribution
    ADD CONSTRAINT affiliate_attribution_commission_identity_unique
    UNIQUE (id, creator_id, program_version_id);

CREATE FUNCTION affiliate_guard_commission_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'active' THEN
    RAISE EXCEPTION 'active affiliate commission policy is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.program_version_id::text, 1));
    IF EXISTS (
      SELECT 1
      FROM public.affiliate_commission_policy AS existing
      WHERE existing.program_version_id = NEW.program_version_id
        AND existing.id <> NEW.id
        AND existing.status = 'active'
        AND tstzrange(existing.effective_from, existing.effective_until, '[)')
            && tstzrange(NEW.effective_from, NEW.effective_until, '[)')
    ) THEN
      RAISE EXCEPTION 'active affiliate commission policy intervals cannot overlap';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_commission_policy_guard
BEFORE INSERT OR UPDATE OR DELETE ON affiliate_commission_policy
FOR EACH ROW EXECUTE FUNCTION affiliate_guard_commission_policy();

CREATE FUNCTION affiliate_guard_commission_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  guarded_policy_id uuid;
  guarded_policy_status text;
BEGIN
  guarded_policy_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.policy_id ELSE NEW.policy_id END;
  SELECT status INTO guarded_policy_status
  FROM public.affiliate_commission_policy
  WHERE id = guarded_policy_id
  FOR SHARE;
  IF guarded_policy_status = 'active' THEN
    RAISE EXCEPTION 'rules for an active affiliate commission policy are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_commission_rule_guard
BEFORE INSERT OR UPDATE OR DELETE ON affiliate_commission_rule
FOR EACH ROW EXECUTE FUNCTION affiliate_guard_commission_rule();

CREATE TABLE affiliate_commission_entry (
    id uuid PRIMARY KEY,
    source_event_ref uuid NOT NULL UNIQUE REFERENCES billing_event_inbox(event_ref),
    attribution_id uuid NOT NULL,
    creator_id uuid NOT NULL REFERENCES affiliate_creator(id),
    program_version_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
    environment text NOT NULL CHECK (environment ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    provider_account_ref text NOT NULL CHECK (length(provider_account_ref) BETWEEN 1 AND 255),
    provider_transaction_ref text NOT NULL CHECK (length(provider_transaction_ref) BETWEEN 1 AND 255),
    entry_kind text NOT NULL CHECK (entry_kind IN ('accrual', 'refund', 'reinstatement')),
    currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    basis_amount_minor bigint NOT NULL CHECK (basis_amount_minor <> 0),
    commission_rate_basis_points integer NOT NULL
        CHECK (commission_rate_basis_points BETWEEN 1 AND 10000),
    commission_amount_minor bigint NOT NULL CHECK (commission_amount_minor <> 0),
    reverses_entry_id uuid UNIQUE REFERENCES affiliate_commission_entry(id),
    occurred_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (attribution_id, creator_id, program_version_id)
      REFERENCES affiliate_attribution (id, creator_id, program_version_id),
    FOREIGN KEY (policy_id, program_version_id)
      REFERENCES affiliate_commission_policy (id, program_version_id),
    FOREIGN KEY (rule_id, policy_id)
      REFERENCES affiliate_commission_rule (id, policy_id),
    UNIQUE (provider, environment, provider_account_ref, provider_transaction_ref, entry_kind),
    CHECK (
      (entry_kind = 'accrual' AND reverses_entry_id IS NULL
       AND basis_amount_minor > 0 AND commission_amount_minor > 0)
      OR
      (entry_kind = 'refund' AND reverses_entry_id IS NOT NULL
       AND basis_amount_minor < 0 AND commission_amount_minor < 0)
      OR
      (entry_kind = 'reinstatement' AND reverses_entry_id IS NOT NULL
       AND basis_amount_minor > 0 AND commission_amount_minor > 0)
    ),
    CHECK (
      entry_kind <> 'accrual'
      OR commission_amount_minor =
         (basis_amount_minor * commission_rate_basis_points + 5000) / 10000
    )
);

CREATE INDEX affiliate_commission_entry_creator_time_idx
    ON affiliate_commission_entry (creator_id, occurred_at DESC, id DESC);
CREATE INDEX affiliate_commission_entry_transaction_idx
    ON affiliate_commission_entry
      (provider, environment, provider_account_ref, provider_transaction_ref, entry_kind);

CREATE FUNCTION affiliate_guard_commission_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  reversed public.affiliate_commission_entry%ROWTYPE;
  source_event public.billing_event_inbox%ROWTYPE;
  attribution public.affiliate_attribution%ROWTYPE;
  policy public.affiliate_commission_policy%ROWTYPE;
  rule public.affiliate_commission_rule%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'affiliate commission ledger entries are immutable';
  END IF;
  SELECT * INTO source_event
  FROM public.billing_event_inbox
  WHERE event_ref = NEW.source_event_ref
  FOR SHARE;
  IF NOT FOUND
     OR source_event.provider <> NEW.provider
     OR source_event.environment <> NEW.environment
     OR source_event.provider_account_ref <> NEW.provider_account_ref
     OR source_event.object_refs ->> 'transaction'
        IS DISTINCT FROM NEW.provider_transaction_ref
     OR source_event.occurred_at <> NEW.occurred_at THEN
    RAISE EXCEPTION 'affiliate commission source event does not match the ledger entry';
  END IF;

  IF NEW.entry_kind = 'accrual' THEN
    IF source_event.event_type NOT IN (
      'INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL'
    ) THEN
      RAISE EXCEPTION 'affiliate commission accrual requires a purchase event';
    END IF;
    SELECT * INTO attribution
    FROM public.affiliate_attribution
    WHERE id = NEW.attribution_id
    FOR SHARE;
    SELECT * INTO policy
    FROM public.affiliate_commission_policy
    WHERE id = NEW.policy_id
    FOR SHARE;
    SELECT * INTO rule
    FROM public.affiliate_commission_rule
    WHERE id = NEW.rule_id
    FOR SHARE;
    IF attribution.state NOT IN ('locked', 'corrected')
       OR attribution.locked_at IS NULL
       OR attribution.bound_at > NEW.occurred_at
       OR policy.status <> 'active'
       OR policy.effective_from > NEW.occurred_at
       OR (policy.effective_until IS NOT NULL
           AND policy.effective_until <= NEW.occurred_at)
       OR rule.product_ref IS DISTINCT FROM source_event.object_refs ->> 'product'
       OR rule.currency_code <> NEW.currency_code
       OR rule.basis_amount_minor <> NEW.basis_amount_minor
       OR rule.commission_rate_basis_points <> NEW.commission_rate_basis_points THEN
      RAISE EXCEPTION 'affiliate commission accrual does not match immutable source facts';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.entry_kind = 'refund' AND source_event.event_type <> 'REFUND')
     OR (NEW.entry_kind = 'reinstatement'
         AND source_event.event_type <> 'REFUND_REVERSED') THEN
    RAISE EXCEPTION 'affiliate commission reversal event type is invalid';
  END IF;

  SELECT * INTO reversed
  FROM public.affiliate_commission_entry
  WHERE id = NEW.reverses_entry_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reversed affiliate commission entry is missing';
  END IF;
  IF (NEW.entry_kind = 'refund' AND reversed.entry_kind <> 'accrual')
     OR (NEW.entry_kind = 'reinstatement' AND reversed.entry_kind <> 'refund') THEN
    RAISE EXCEPTION 'affiliate commission reversal sequence is invalid';
  END IF;
  IF NEW.attribution_id <> reversed.attribution_id
     OR NEW.creator_id <> reversed.creator_id
     OR NEW.program_version_id <> reversed.program_version_id
     OR NEW.policy_id <> reversed.policy_id
     OR NEW.rule_id <> reversed.rule_id
     OR NEW.provider <> reversed.provider
     OR NEW.environment <> reversed.environment
     OR NEW.provider_account_ref <> reversed.provider_account_ref
     OR NEW.provider_transaction_ref <> reversed.provider_transaction_ref
     OR NEW.currency_code <> reversed.currency_code
     OR NEW.commission_rate_basis_points <> reversed.commission_rate_basis_points
     OR NEW.basis_amount_minor <> -reversed.basis_amount_minor
     OR NEW.commission_amount_minor <> -reversed.commission_amount_minor THEN
    RAISE EXCEPTION 'affiliate commission reversal does not conserve the original entry';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_commission_entry_guard
BEFORE INSERT OR UPDATE OR DELETE ON affiliate_commission_entry
FOR EACH ROW EXECUTE FUNCTION affiliate_guard_commission_entry();

ALTER TABLE affiliate_commission_policy OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_commission_rule OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_commission_entry OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_commission_policy() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_commission_rule() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_commission_entry() OWNER TO cloudsqlsuperuser;

REVOKE ALL ON affiliate_commission_policy, affiliate_commission_rule,
    affiliate_commission_entry FROM glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_commission_policy() FROM PUBLIC, glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_commission_rule() FROM PUBLIC, glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_commission_entry() FROM PUBLIC, glidelingo_app;
GRANT SELECT ON affiliate_commission_policy, affiliate_commission_rule TO glidelingo_app;
GRANT SELECT, INSERT ON affiliate_commission_entry TO glidelingo_app;

COMMIT;
