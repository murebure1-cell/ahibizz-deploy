-- "Jelovnik" and "Porijeklo mesa" on a business page (canvas Djelatnost, owner's go of
-- 2026-11-26). The owner writes both; the meat origin is the owner's own statement about a
-- supplier and is never a Halal certificate or a badge.
CREATE TABLE business_menu (
    business_id uuid PRIMARY KEY REFERENCES directory_business(id) ON DELETE CASCADE,
    items jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 60),
    meat jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(meat) = 'array' AND jsonb_array_length(meat) <= 12),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by text REFERENCES auth_user(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
