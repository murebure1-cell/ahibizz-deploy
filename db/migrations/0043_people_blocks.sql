CREATE TABLE people_block (
    actor_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    target_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    blocked boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id,target_id),
    CHECK (actor_id <> target_id)
);
CREATE INDEX people_block_actor_order ON people_block(actor_id,updated_at DESC,target_id) WHERE blocked;
ALTER TABLE auth_account_preferences ADD COLUMN hide_blocked_businesses boolean NOT NULL DEFAULT false;

-- Existing personal conversation controls continue to protect the same people after the upgrade.
INSERT INTO people_block (actor_id,target_id,updated_at)
SELECT m.user_id,
       CASE WHEN m.user_id=t.left_user_id THEN t.right_user_id ELSE t.left_user_id END,
       m.updated_at
FROM message_thread_member m JOIN message_thread t ON t.id=m.thread_id
WHERE t.kind='person' AND m.blocked
ON CONFLICT (actor_id,target_id) DO NOTHING;

CREATE FUNCTION people_contact_blocked(actor text, target text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM people_block
        WHERE blocked AND ((actor_id=actor AND target_id=target) OR (actor_id=target AND target_id=actor))
    )
$$;
