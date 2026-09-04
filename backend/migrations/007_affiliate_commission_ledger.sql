BEGIN;

CREATE TABLE affiliate_financial_fact (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider = 'stripe'),
    environment text NOT NULL CHECK (environment ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    provider_account_ref text NOT NULL CHECK (length(provider_account_ref) BETWEEN 1 AND 255),
    provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 255),
    provider_transaction_ref text NOT NULL
        CHECK (length(provider_transaction_ref) BETWEEN 1 AND 255),
    fact_kind text NOT NULL CHECK (fact_kind IN ('purchase', 'refund', 'refund_reversal')),
    occurred_at timestamptz NOT NULL,
    principal_ref text REFERENCES affiliate_principal(principal_ref),
    product_ref text CHECK (product_ref IS NULL OR length(product_ref) BETWEEN 1 AND 255),
    currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    gross_amount_minor bigint NOT NULL
        CHECK (gross_amount_minor BETWEEN 1 AND 900000000000000),
    reverses_provider_transaction_ref text
        CHECK (reverses_provider_transaction_ref IS NULL OR
               length(reverses_provider_transaction_ref) BETWEEN 1 AND 255),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, environment, provider_account_ref, provider_event_id),
    UNIQUE (provider, environment, provider_account_ref, provider_transaction_ref),
    CHECK (
      (fact_kind = 'purchase' AND principal_ref IS NOT NULL AND product_ref IS NOT NULL
       AND reverses_provider_transaction_ref IS NULL)
      OR
      (fact_kind IN ('refund', 'refund_reversal') AND product_ref IS NULL
       AND reverses_provider_transaction_ref IS NOT NULL
       AND reverses_provider_transaction_ref <> provider_transaction_ref)
    )
);

CREATE FUNCTION affiliate_guard_financial_fact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'accepted affiliate financial facts are immutable';
END;
$$;

CREATE TRIGGER affiliate_financial_fact_guard
BEFORE UPDATE OR DELETE ON affiliate_financial_fact
FOR EACH ROW EXECUTE FUNCTION affiliate_guard_financial_fact();

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
  IF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    RAISE EXCEPTION 'active affiliate commission policy is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.program_version_id::text, 1));
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.program_version_id IS DISTINCT FROM OLD.program_version_id
       OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR OLD.effective_until IS NOT NULL
       OR NEW.effective_until IS NULL
       OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'active affiliate commission policies allow only one-way interval closure';
    END IF;
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
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.affiliate_commission_policy
    WHERE id = NEW.policy_id
    FOR SHARE;
    IF EXISTS (
      SELECT 1 FROM public.affiliate_commission_policy
      WHERE id = NEW.policy_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'rules for an active affiliate commission policy are immutable';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.affiliate_commission_policy
    WHERE id = OLD.policy_id
    FOR SHARE;
    IF EXISTS (
      SELECT 1 FROM public.affiliate_commission_policy
      WHERE id = OLD.policy_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'rules for an active affiliate commission policy are immutable';
    END IF;
  ELSE
    PERFORM 1 FROM public.affiliate_commission_policy
    WHERE id IN (OLD.policy_id, NEW.policy_id)
    ORDER BY id
    FOR SHARE;
    IF EXISTS (
      SELECT 1 FROM public.affiliate_commission_policy
      WHERE id IN (OLD.policy_id, NEW.policy_id) AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'rules for an active affiliate commission policy are immutable';
    END IF;
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
    source_fact_ref uuid NOT NULL UNIQUE REFERENCES affiliate_financial_fact(id),
    attribution_id uuid NOT NULL,
    creator_id uuid NOT NULL REFERENCES affiliate_creator(id),
    program_version_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    provider text NOT NULL CHECK (provider = 'stripe'),
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
    UNIQUE (provider, environment, provider_account_ref, provider_transaction_ref),
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
CREATE INDEX affiliate_commission_entry_source_transaction_idx
    ON affiliate_commission_entry
      (provider, environment, provider_account_ref, provider_transaction_ref);

CREATE FUNCTION affiliate_guard_commission_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  reversed public.affiliate_commission_entry%ROWTYPE;
  source_fact public.affiliate_financial_fact%ROWTYPE;
  attribution public.affiliate_attribution%ROWTYPE;
  policy public.affiliate_commission_policy%ROWTYPE;
  rule public.affiliate_commission_rule%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'affiliate commission ledger entries are immutable';
  END IF;

  SELECT * INTO source_fact
  FROM public.affiliate_financial_fact
  WHERE id = NEW.source_fact_ref
  FOR SHARE;
  IF NOT FOUND
     OR source_fact.provider <> NEW.provider
     OR source_fact.environment <> NEW.environment
     OR source_fact.provider_account_ref <> NEW.provider_account_ref
     OR source_fact.provider_transaction_ref <> NEW.provider_transaction_ref
     OR source_fact.currency_code <> NEW.currency_code
     OR source_fact.gross_amount_minor <> abs(NEW.basis_amount_minor)
     OR source_fact.occurred_at <> NEW.occurred_at THEN
    RAISE EXCEPTION 'affiliate financial fact does not match the ledger entry';
  END IF;

  IF NEW.entry_kind = 'accrual' THEN
    IF source_fact.fact_kind <> 'purchase' THEN
      RAISE EXCEPTION 'affiliate commission accrual requires a purchase fact';
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
    IF source_fact.principal_ref IS DISTINCT FROM attribution.principal_ref
       OR attribution.state NOT IN ('locked', 'corrected', 'replaced')
       OR attribution.locked_at IS NULL
       OR attribution.bound_at > NEW.occurred_at
       OR (attribution.replaced_at IS NOT NULL
           AND attribution.replaced_at <= NEW.occurred_at)
       OR policy.status <> 'active'
       OR policy.effective_from > NEW.occurred_at
       OR (policy.effective_until IS NOT NULL
           AND policy.effective_until <= NEW.occurred_at)
       OR rule.product_ref IS DISTINCT FROM source_fact.product_ref
       OR rule.commission_rate_basis_points <> NEW.commission_rate_basis_points THEN
      RAISE EXCEPTION 'affiliate commission accrual does not match immutable source facts';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.entry_kind = 'refund' AND source_fact.fact_kind <> 'refund')
     OR (NEW.entry_kind = 'reinstatement'
         AND source_fact.fact_kind <> 'refund_reversal') THEN
    RAISE EXCEPTION 'affiliate commission reversal fact type is invalid';
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
  IF source_fact.reverses_provider_transaction_ref
        IS DISTINCT FROM reversed.provider_transaction_ref
     OR NEW.occurred_at < reversed.occurred_at
     OR NEW.attribution_id <> reversed.attribution_id
     OR NEW.creator_id <> reversed.creator_id
     OR NEW.program_version_id <> reversed.program_version_id
     OR NEW.policy_id <> reversed.policy_id
     OR NEW.rule_id <> reversed.rule_id
     OR NEW.provider <> reversed.provider
     OR NEW.environment <> reversed.environment
     OR NEW.provider_account_ref <> reversed.provider_account_ref
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

ALTER TABLE affiliate_financial_fact OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_commission_policy OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_commission_rule OWNER TO cloudsqlsuperuser;
ALTER TABLE affiliate_commission_entry OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_financial_fact() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_commission_policy() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_commission_rule() OWNER TO cloudsqlsuperuser;
ALTER FUNCTION affiliate_guard_commission_entry() OWNER TO cloudsqlsuperuser;

REVOKE ALL ON affiliate_financial_fact, affiliate_commission_policy,
    affiliate_commission_rule, affiliate_commission_entry FROM glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_financial_fact() FROM PUBLIC, glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_commission_policy() FROM PUBLIC, glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_commission_rule() FROM PUBLIC, glidelingo_app;
REVOKE ALL ON FUNCTION affiliate_guard_commission_entry() FROM PUBLIC, glidelingo_app;
-- The public API can expose only the role-scoped, minimized ledger projection.
-- A future authenticated and reconciled finance worker must receive its own
-- narrowly scoped writer role in a later migration before facts can be consumed.
GRANT SELECT ON affiliate_commission_entry TO glidelingo_app;

COMMIT;
