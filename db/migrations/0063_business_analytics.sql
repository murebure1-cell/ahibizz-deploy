-- What the drawn "Analitika" shows an owner (2026-11-27): taps on call, message and map, where
-- visitors came from, and at which hour. Like the view counts of 0060 only numbers per business
-- and day are kept: no visitor, no address, no device.
CREATE TABLE business_touch_day (
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE CASCADE,
    day date NOT NULL,
    kind text NOT NULL CHECK (kind IN ('call', 'message', 'map')),
    touches integer NOT NULL DEFAULT 0 CHECK (touches >= 0),
    PRIMARY KEY (business_id, day, kind)
);

CREATE TABLE business_source_day (
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE CASCADE,
    day date NOT NULL,
    source text NOT NULL CHECK (source IN ('search', 'category', 'map', 'other')),
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (business_id, day, source)
);

CREATE TABLE business_view_hour (
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE CASCADE,
    day date NOT NULL,
    hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (business_id, day, hour)
);
