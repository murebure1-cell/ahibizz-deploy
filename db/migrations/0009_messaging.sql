-- A thread has exactly two fixed participants. Business right_user_id is its owner snapshot.
CREATE TABLE message_thread (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('person','business')),
    left_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    right_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    business_id uuid REFERENCES directory_business(id) ON DELETE RESTRICT,
    created_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    latest_sequence integer NOT NULL DEFAULT 0 CHECK (latest_sequence BETWEEN 0 AND 2147483646),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (left_user_id<>right_user_id),
    CHECK (created_by_user_id IN (left_user_id,right_user_id)),
    CHECK ((kind='person' AND business_id IS NULL AND left_user_id COLLATE "C" < right_user_id COLLATE "C")
        OR (kind='business' AND business_id IS NOT NULL AND created_by_user_id=left_user_id))
);
CREATE UNIQUE INDEX message_person_pair ON message_thread(left_user_id,right_user_id) WHERE kind='person';
CREATE UNIQUE INDEX message_business_pair ON message_thread(business_id,left_user_id,right_user_id) WHERE kind='business';
CREATE INDEX message_left_inbox ON message_thread(left_user_id,updated_at DESC,id);
CREATE INDEX message_right_inbox ON message_thread(right_user_id,updated_at DESC,id);
CREATE INDEX message_open_rate ON message_thread(created_by_user_id,created_at);

CREATE TABLE message_thread_member (
    thread_id uuid NOT NULL REFERENCES message_thread(id) ON DELETE RESTRICT,
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    read_sequence integer NOT NULL DEFAULT 0 CHECK (read_sequence BETWEEN 0 AND 2147483646),
    blocked boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (thread_id,user_id)
);
CREATE TABLE message_message (
    id uuid PRIMARY KEY,
    thread_id uuid NOT NULL REFERENCES message_thread(id) ON DELETE RESTRICT,
    sender_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 2147483646),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND octet_length(body)<=8000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (thread_id,sequence)
);
CREATE INDEX message_send_rate ON message_message(sender_user_id,created_at);
CREATE TABLE message_command (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    operation text NOT NULL CHECK (operation IN ('open','send','block')),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    result_thread_id uuid NOT NULL REFERENCES message_thread(id) ON DELETE RESTRICT,
    result_message_id uuid REFERENCES message_message(id) ON DELETE RESTRICT,
    result_sequence integer,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_user_id,request_id),
    CHECK ((operation='send' AND result_message_id IS NOT NULL AND result_sequence IS NOT NULL AND result_sequence BETWEEN 1 AND 2147483646)
        OR (operation IN ('open','block') AND result_message_id IS NULL AND result_sequence IS NULL))
);
CREATE INDEX message_command_rate ON message_command(actor_user_id,operation,created_at);
CREATE INDEX message_command_actor_rate ON message_command(actor_user_id,created_at);

CREATE FUNCTION message_thread_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business_owner text;
BEGIN
    IF NEW.latest_sequence<>0 THEN
        RAISE EXCEPTION 'message_thread_must_start_empty' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='business' THEN
        SELECT owner_user_id INTO business_owner FROM directory_business WHERE id=NEW.business_id FOR SHARE;
        IF business_owner IS DISTINCT FROM NEW.right_user_id THEN
            RAISE EXCEPTION 'message_thread_owner_snapshot_required' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER message_thread_insert_guard BEFORE INSERT ON message_thread
FOR EACH ROW EXECUTE FUNCTION message_thread_insert_guard();

CREATE FUNCTION message_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent message_thread%ROWTYPE;
BEGIN
    SELECT * INTO parent FROM message_thread WHERE id=NEW.result_thread_id FOR SHARE;
    IF parent.id IS NULL OR NEW.actor_user_id NOT IN (parent.left_user_id,parent.right_user_id) THEN
        RAISE EXCEPTION 'message_command_participant_required' USING ERRCODE='23514';
    END IF;
    IF NEW.operation='send' AND NOT EXISTS (
        SELECT 1 FROM message_message WHERE id=NEW.result_message_id AND thread_id=NEW.result_thread_id
            AND sender_user_id=NEW.actor_user_id AND sequence=NEW.result_sequence
    ) THEN
        RAISE EXCEPTION 'message_command_content_receipt_required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER message_command_guard BEFORE INSERT ON message_command
FOR EACH ROW EXECUTE FUNCTION message_command_guard();

CREATE FUNCTION message_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'message_history_is_immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER message_content_immutable BEFORE UPDATE OR DELETE ON message_message
FOR EACH ROW EXECUTE FUNCTION message_history_immutable();
CREATE TRIGGER message_command_immutable BEFORE UPDATE OR DELETE ON message_command
FOR EACH ROW EXECUTE FUNCTION message_history_immutable();
CREATE TRIGGER message_thread_no_delete BEFORE DELETE ON message_thread
FOR EACH ROW EXECUTE FUNCTION message_history_immutable();
CREATE TRIGGER message_member_no_delete BEFORE DELETE ON message_thread_member
FOR EACH ROW EXECUTE FUNCTION message_history_immutable();

CREATE FUNCTION message_thread_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.left_user_id<>OLD.left_user_id
        OR NEW.right_user_id<>OLD.right_user_id OR NEW.business_id IS DISTINCT FROM OLD.business_id
        OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at
        OR NEW.latest_sequence<OLD.latest_sequence OR NEW.latest_sequence>OLD.latest_sequence+1 THEN
        RAISE EXCEPTION 'message_thread_invalid_identity_or_sequence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER message_thread_guard BEFORE UPDATE ON message_thread
FOR EACH ROW EXECUTE FUNCTION message_thread_guard();

CREATE FUNCTION message_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent message_thread%ROWTYPE;
BEGIN
    IF TG_OP='UPDATE' AND (NEW.thread_id<>OLD.thread_id OR NEW.user_id<>OLD.user_id OR NEW.read_sequence<OLD.read_sequence) THEN
        RAISE EXCEPTION 'message_member_invalid_identity_or_read_pointer' USING ERRCODE='23514';
    END IF;
    SELECT * INTO parent FROM message_thread WHERE id=NEW.thread_id FOR SHARE;
    IF parent.id IS NULL OR NEW.user_id NOT IN (parent.left_user_id,parent.right_user_id) OR NEW.read_sequence>parent.latest_sequence THEN
        RAISE EXCEPTION 'message_member_invalid_participant_or_read_pointer' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER message_member_guard BEFORE INSERT OR UPDATE ON message_thread_member
FOR EACH ROW EXECUTE FUNCTION message_member_guard();

CREATE FUNCTION message_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent message_thread%ROWTYPE; previous_sequence integer;
BEGIN
    SELECT * INTO parent FROM message_thread WHERE id=NEW.thread_id FOR SHARE;
    SELECT COALESCE(max(sequence),0) INTO previous_sequence FROM message_message WHERE thread_id=NEW.thread_id;
    IF parent.id IS NULL OR NEW.sender_user_id NOT IN (parent.left_user_id,parent.right_user_id)
        OR NEW.sequence<>parent.latest_sequence OR NEW.sequence<>previous_sequence+1 THEN
        RAISE EXCEPTION 'message_content_invalid_participant_or_sequence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER message_content_guard BEFORE INSERT ON message_message
FOR EACH ROW EXECUTE FUNCTION message_content_guard();

CREATE FUNCTION message_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest integer; actual_latest integer; members integer;
BEGIN
    SELECT latest_sequence INTO latest FROM message_thread WHERE id=NEW.id;
    SELECT COALESCE(max(sequence),0) INTO actual_latest FROM message_message WHERE thread_id=NEW.id;
    SELECT count(*) INTO members FROM message_thread_member WHERE thread_id=NEW.id;
    IF latest<>actual_latest OR members<>2 THEN
        RAISE EXCEPTION 'message_thread_incomplete_sequence_or_members' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER message_consistency_guard AFTER INSERT OR UPDATE ON message_thread
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION message_consistency_guard();
