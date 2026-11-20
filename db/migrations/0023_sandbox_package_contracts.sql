-- Sandbox contract and transaction evidence only. Never joined to live entitlements or receipts.
CREATE TABLE sandbox_package_contract (
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
  plan_id text NOT NULL,
  provider_id text UNIQUE,
  approval_url text,
  status text NOT NULL CHECK (status IN ('CREATING','APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
  provider_updated_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  paid_cycles integer NOT NULL DEFAULT 0 CHECK (paid_cycles BETWEEN 0 AND total_cycles),
  paid_eur_minor integer NOT NULL DEFAULT 0 CHECK (paid_eur_minor>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id)
);
CREATE UNIQUE INDEX sandbox_package_contract_open ON sandbox_package_contract (business_id) WHERE status NOT IN ('CANCELLED','EXPIRED');
CREATE INDEX sandbox_package_contract_owner ON sandbox_package_contract (user_id, created_at DESC);
CREATE TABLE sandbox_package_payment (
  id text PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES sandbox_package_contract(id) ON DELETE RESTRICT,
  amount_eur_minor integer NOT NULL CHECK(amount_eur_minor>0),
  paid_at timestamptz NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK(status IN ('COMPLETED','REFUNDED','REVERSED','PARTIALLY_REFUNDED'))
);
CREATE INDEX sandbox_package_payment_contract ON sandbox_package_payment(contract_id,paid_at);
