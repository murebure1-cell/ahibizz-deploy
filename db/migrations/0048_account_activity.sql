CREATE TABLE account_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Recipients come only from authoritatively linked domain rows. Avoid locking
  -- the recipient's account in a transaction that already locks the actor.
  recipient_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('message','service','rental','stay','reel')),
  subject_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (
    (kind='message' AND action='message')
    OR (kind='reel' AND action IN ('published','rejected'))
    OR (kind IN ('service','rental','stay') AND action IN ('request','approve','decline','cancel','complete'))
  ),
  business_id uuid,
  owner_side boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  UNIQUE (recipient_id,kind,subject_id,version),
  CHECK (kind='message' OR business_id IS NOT NULL)
);
CREATE INDEX account_activity_inbox ON account_activity(recipient_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX account_activity_message_thread ON account_activity(recipient_id,subject_id)
  WHERE kind='message';

CREATE FUNCTION remove_account_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM account_activity WHERE recipient_id=OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER remove_account_activity AFTER DELETE ON auth_user
FOR EACH ROW EXECUTE FUNCTION remove_account_activity();

ALTER TABLE push_delivery
  DROP CONSTRAINT push_delivery_kind_check,
  ADD CONSTRAINT push_delivery_kind_check CHECK (kind IN ('test','message','activity')),
  ADD COLUMN activity_id uuid REFERENCES account_activity(id) ON DELETE CASCADE,
  ADD CONSTRAINT push_delivery_activity CHECK ((kind='activity')=(activity_id IS NOT NULL)),
  ADD UNIQUE(device_id,activity_id);

CREATE FUNCTION push_queue_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO push_delivery(device_id,kind,activity_id)
    SELECT d.id,'activity',NEW.id
    FROM push_device d JOIN auth_session s ON s.id=d.session_id AND s."userId"=d.user_id
    WHERE d.user_id=NEW.recipient_id AND s."expiresAt">clock_timestamp()
    ON CONFLICT (device_id,activity_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER push_after_activity AFTER INSERT ON account_activity FOR EACH ROW
WHEN (NEW.kind<>'message') EXECUTE FUNCTION push_queue_activity();

CREATE FUNCTION account_activity_from_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_activity(recipient_id,kind,subject_id,version,action,created_at)
    SELECT member.user_id,'message',NEW.thread_id,NEW.sequence,'message',NEW.created_at
    FROM message_thread_member member
    WHERE member.thread_id=NEW.thread_id AND member.user_id<>NEW.sender_user_id
      AND NOT member.blocked
    ON CONFLICT (recipient_id,subject_id) WHERE kind='message'
    DO UPDATE SET version=EXCLUDED.version,created_at=EXCLUDED.created_at,read_at=NULL
    WHERE account_activity.version<EXCLUDED.version;
  RETURN NEW;
END;
$$;
CREATE TRIGGER activity_after_message AFTER INSERT ON message_message
FOR EACH ROW EXECUTE FUNCTION account_activity_from_message();

-- Keep existing unread conversations visible without sending any new push.
INSERT INTO account_activity(recipient_id,kind,subject_id,version,action,created_at)
SELECT member.user_id,'message',member.thread_id,latest.sequence,'message',latest.created_at
FROM message_thread_member member
CROSS JOIN LATERAL (
  SELECT m.sequence,m.created_at FROM message_message m
  WHERE m.thread_id=member.thread_id AND m.sequence>member.read_sequence AND m.sender_user_id<>member.user_id
  ORDER BY m.sequence DESC LIMIT 1
) latest
WHERE NOT member.blocked;

CREATE FUNCTION account_activity_from_appointment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry record;
  category text;
  event_version integer;
  event_action text;
  to_owner boolean;
  recipient text;
BEGIN
  IF TG_TABLE_NAME='booking_entry_event' THEN
    category := 'service';
    event_version := NEW.next_version;
    event_action := CASE WHEN NEW.action='create' THEN 'request' ELSE NEW.action END;
    SELECT e.id,e.business_id,e.customer_user_id AS customer,e.business_owner_user_id AS owner
      INTO entry FROM booking_entry e WHERE e.id=NEW.entry_id AND e.kind='customer';
  ELSIF TG_TABLE_NAME='rental_booking_event' THEN
    category := 'rental';
    event_version := NEW.version;
    event_action := NEW.action;
    SELECT e.id,e.business_id,e.customer_id AS customer,b.owner_user_id AS owner
      INTO entry FROM rental_booking e JOIN directory_business b ON b.id=e.business_id
      WHERE e.id=NEW.booking_id AND e.kind='customer';
  ELSE
    category := 'stay';
    event_version := NEW.version;
    event_action := NEW.action;
    SELECT e.id,e.business_id,e.customer_id AS customer,b.owner_user_id AS owner
      INTO entry FROM stay_booking e JOIN directory_business b ON b.id=e.business_id
      WHERE e.id=NEW.booking_id AND e.kind='customer';
  END IF;
  IF NOT FOUND OR event_action='block' THEN RETURN NEW; END IF;
  to_owner := NEW.actor_user_id=entry.customer;
  recipient := CASE WHEN to_owner THEN entry.owner ELSE entry.customer END;
  IF recipient IS NULL OR recipient=NEW.actor_user_id THEN RETURN NEW; END IF;
  INSERT INTO account_activity(recipient_id,kind,subject_id,version,action,business_id,owner_side,created_at)
  VALUES(recipient,category,entry.id,event_version,event_action,entry.business_id,to_owner,NEW.created_at)
  ON CONFLICT (recipient_id,kind,subject_id,version) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER activity_after_appointment AFTER INSERT ON booking_entry_event
FOR EACH ROW EXECUTE FUNCTION account_activity_from_appointment();
CREATE TRIGGER activity_after_rental AFTER INSERT ON rental_booking_event
FOR EACH ROW EXECUTE FUNCTION account_activity_from_appointment();
CREATE TRIGGER activity_after_stay AFTER INSERT ON stay_booking_event
FOR EACH ROW EXECUTE FUNCTION account_activity_from_appointment();

CREATE FUNCTION account_activity_from_reel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_activity(recipient_id,kind,subject_id,version,action,business_id)
  VALUES(NEW.submitted_by,'reel',NEW.id,1,NEW.status,NEW.business_id)
  ON CONFLICT (recipient_id,kind,subject_id,version) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER activity_after_reel AFTER UPDATE OF status ON business_reel FOR EACH ROW
WHEN (OLD.status='pending' AND NEW.status IN ('published','rejected'))
EXECUTE FUNCTION account_activity_from_reel();
