ALTER TABLE sandbox_package_contract
  ADD COLUMN reported_cycles integer NOT NULL DEFAULT 0 CHECK (reported_cycles BETWEEN 0 AND total_cycles),
  ADD COLUMN settlement_hold_until timestamptz;
