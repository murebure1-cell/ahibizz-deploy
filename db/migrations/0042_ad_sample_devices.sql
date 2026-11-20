ALTER TABLE ad_audience_navigation
  ADD COLUMN platform text CHECK (platform IN ('android','ios','desktop','other')),
  ADD COLUMN starts_platform_visit boolean,
  ADD CONSTRAINT ad_navigation_platform_visit_pair
    CHECK ((platform IS NULL) = (starts_platform_visit IS NULL));

