-- The signing identity persists across restarts and deployments. No signing material is seeded.
CREATE TABLE push_signer (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    public_key text NOT NULL,
    private_key text NOT NULL
);

-- A subscription belongs to an approved, signed-in user's specific login.
CREATE TABLE push_device (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 1 AND 1600),
    p256dh text NOT NULL,
    auth_key text NOT NULL,
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    session_id text NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
    test_id uuid UNIQUE,
    test_requested_at timestamptz,
    test_state text CHECK (test_state IN ('scheduled','accepted','shown','opened','failed'))
);
CREATE INDEX push_device_user ON push_device(user_id);
CREATE INDEX push_device_session ON push_device(session_id);

CREATE TABLE push_test_limit (
    user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
    requested_at timestamptz NOT NULL
);

CREATE TABLE push_delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES push_device(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('test','message')),
    message_id uuid REFERENCES message_message(id) ON DELETE CASCADE,
    due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '10 minutes'),
    attempts integer NOT NULL DEFAULT 0,
    CHECK ((kind='message')=(message_id IS NOT NULL)),
    UNIQUE(device_id,message_id)
);
CREATE INDEX push_delivery_due ON push_delivery(due_at);

CREATE FUNCTION push_queue_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO push_delivery(device_id,kind,message_id)
        SELECT d.id,'message',NEW.id
        FROM message_thread_member member JOIN push_device d ON d.user_id=member.user_id
        JOIN auth_session s ON s.id=d.session_id AND s."userId"=d.user_id
        WHERE member.thread_id=NEW.thread_id AND member.user_id<>NEW.sender_user_id
          AND NOT member.blocked AND s."expiresAt">clock_timestamp();
    RETURN NEW;
END;
$$;
CREATE TRIGGER push_after_message AFTER INSERT ON message_message
FOR EACH ROW EXECUTE FUNCTION push_queue_message();
