-- How often a public profile and a published business are opened, counted per day (owner's
-- wish of 2026-11-26, for "Pregledi profila / djelatnosti · 30 dana" on Moj profil).
-- Only the count is kept: no viewer, no address, no device. A browser counts a page once per
-- session and an owner opening their own page is not counted.
CREATE TABLE profile_view_day (
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    day date NOT NULL,
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (user_id, day)
);

CREATE TABLE business_view_day (
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE CASCADE,
    day date NOT NULL,
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (business_id, day)
);
