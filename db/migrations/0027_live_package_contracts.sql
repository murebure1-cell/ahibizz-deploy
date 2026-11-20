-- Live sales and contracts use separate tables from Sandbox fixtures.
CREATE TABLE live_package_benefits (
  version integer PRIMARY KEY CHECK (version>0),
  benefits jsonb NOT NULL,
  updated_by text REFERENCES auth_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO live_package_benefits(version,benefits) VALUES(1,
  '{"basic":{"enabled":true,"nearbyDays":0,"featuredDays":0},"business":{"enabled":true,"nearbyDays":7,"featuredDays":0},"premium":{"enabled":true,"nearbyDays":15,"featuredDays":7}}');

CREATE TABLE live_package_contract (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
  business_title text NOT NULL,
  request_id uuid NOT NULL,
  package_id text NOT NULL CHECK (package_id IN ('basic','business','premium')),
  period text NOT NULL CHECK (period IN ('monthly','annual')),
  amount_bam_minor integer NOT NULL CHECK (amount_bam_minor > 0),
  amount_eur_minor integer NOT NULL CHECK (amount_eur_minor > 0),
  total_cycles integer NOT NULL CHECK ((period='monthly' AND total_cycles=12) OR (period='annual' AND total_cycles=1)),
  benefits_version integer NOT NULL REFERENCES live_package_benefits(version),
  nearby_days smallint NOT NULL CHECK(nearby_days BETWEEN 0 AND 31),
  featured_days smallint NOT NULL CHECK(featured_days BETWEEN 0 AND 31),
  plan_id text NOT NULL,
  provider_id text UNIQUE,
  approval_url text,
  status text NOT NULL CHECK (status IN ('CREATING','APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
  provider_updated_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  paid_cycles integer NOT NULL DEFAULT 0 CHECK (paid_cycles BETWEEN 0 AND total_cycles),
  paid_eur_minor integer NOT NULL DEFAULT 0 CHECK (paid_eur_minor>=0),
  reported_cycles integer NOT NULL DEFAULT 0 CHECK (reported_cycles BETWEEN 0 AND total_cycles),
  settlement_hold_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id)
);
CREATE UNIQUE INDEX live_package_contract_open ON live_package_contract (business_id) WHERE status NOT IN ('CANCELLED','EXPIRED');
CREATE INDEX live_package_contract_owner ON live_package_contract (user_id, created_at DESC);
CREATE TABLE live_package_payment (
  id text PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES live_package_contract(id) ON DELETE RESTRICT,
  amount_eur_minor integer NOT NULL CHECK(amount_eur_minor>0),
  paid_at timestamptz NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK(status IN ('COMPLETED','REFUNDED','REVERSED','PARTIALLY_REFUNDED'))
);
CREATE INDEX live_package_payment_contract ON live_package_payment(contract_id,paid_at);

ALTER TABLE directory_business ADD COLUMN package_access text NOT NULL DEFAULT 'legacy'
  CHECK(package_access IN ('legacy','first_year','subscription'));

CREATE INDEX live_package_access_window ON live_package_contract(business_id,user_id,ends_at)
  WHERE paid_cycles>0;

-- Calendar anniversaries use UTC and retain month-end anchors. The provider's numbered sales
-- include reversals in sequence so a refunded month never displaces a later paid month.
CREATE FUNCTION paid_package_placement_until(b directory_business, kind text) RETURNS timestamptz
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
      FROM live_package_payment p WHERE p.contract_id=c.id
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

CREATE FUNCTION paid_package_placement(b directory_business, kind text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT paid_package_placement_until(b,kind) IS NOT NULL $$;

CREATE FUNCTION package_allows_listing(b directory_business) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN b.package_access = 'legacy' THEN true
    WHEN b.package_access = 'first_year' AND (b.created_at AT TIME ZONE 'UTC' + interval '1 year') AT TIME ZONE 'UTC' > now() THEN true
    ELSE paid_package_placement(b,'listing')
  END
$$;
