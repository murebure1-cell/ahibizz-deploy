CREATE TABLE platform_settings (
    key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.-]{0,127}$'),
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
