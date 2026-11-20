-- Credit contracts share the active-listing constraint and keep their original credit price.
ALTER TABLE live_package_contract
  ADD COLUMN payment_method text NOT NULL DEFAULT 'paypal' CHECK(payment_method IN ('paypal','credits')),
  ADD COLUMN cycle_credit_minor bigint CHECK(cycle_credit_minor>0),
  ALTER COLUMN plan_id DROP NOT NULL,
  ADD CONSTRAINT live_package_tender CHECK (
    (payment_method='paypal' AND plan_id IS NOT NULL AND cycle_credit_minor IS NULL) OR
    (payment_method='credits' AND plan_id IS NULL AND provider_id IS NULL AND approval_url IS NULL
      AND cycle_credit_minor IS NOT NULL AND paid_eur_minor=0)
  ),
  ADD UNIQUE (id,user_id,cycle_credit_minor);

CREATE TABLE wallet_package_period (
  contract_id uuid NOT NULL,
  account_id text NOT NULL,
  cycle_number smallint NOT NULL CHECK(cycle_number BETWEEN 1 AND 12),
  credit_minor bigint NOT NULL CHECK(credit_minor>0),
  debit_id uuid NOT NULL UNIQUE,
  paid_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(contract_id,cycle_number),
  FOREIGN KEY(contract_id,account_id,credit_minor) REFERENCES live_package_contract(id,user_id,cycle_credit_minor),
  FOREIGN KEY(debit_id,account_id,credit_minor) REFERENCES ahi_wallet_debit(purchase_id,account_id,credit_minor)
);

CREATE OR REPLACE FUNCTION paid_package_placement_until(b directory_business, kind text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT max(window_ends) FROM (
    SELECT CASE kind
      WHEN 'listing' THEN bounds.cycle_ends
      WHEN 'nearby' THEN LEAST(bounds.cycle_ends, bounds.cycle_starts + c.nearby_days*interval '24 hours')
      WHEN 'featured' THEN LEAST(bounds.cycle_ends, bounds.cycle_starts + c.featured_days*interval '24 hours')
    END AS window_ends
    FROM live_package_contract c
    CROSS JOIN LATERAL (
      SELECT p.status,p.needs_review,(row_number() OVER (ORDER BY p.paid_at,p.id)-1)::int AS position
      FROM live_package_payment p WHERE p.contract_id=c.id AND c.payment_method='paypal'
      UNION ALL
      SELECT 'COMPLETED'::text,false,w.cycle_number-1
      FROM wallet_package_period w WHERE w.contract_id=c.id AND c.payment_method='credits'
    ) sale
    CROSS JOIN LATERAL generate_series(CASE WHEN c.period='annual' THEN 0 ELSE sale.position END,
                                     CASE WHEN c.period='annual' THEN 11 ELSE sale.position END) AS m(idx)
    CROSS JOIN LATERAL (SELECT
       ((c.starts_at AT TIME ZONE 'UTC') + make_interval(months=>m.idx)) AT TIME ZONE 'UTC' AS cycle_starts,
       ((c.starts_at AT TIME ZONE 'UTC') + make_interval(months=>m.idx+1)) AT TIME ZONE 'UTC' AS cycle_ends) bounds
    WHERE c.business_id=b.id AND c.user_id=b.owner_user_id AND c.paid_cycles>0 AND c.ends_at>now()
      AND c.starts_at<=now() AND sale.status='COMPLETED' AND NOT sale.needs_review
      AND m.idx<12 AND bounds.cycle_starts<=now() AND bounds.cycle_ends>now()
  ) windows WHERE window_ends>now()
$$;
