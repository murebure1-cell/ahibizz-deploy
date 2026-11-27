-- What others see on a public person profile, and which kinds of push a person wants.
-- Absent preference rows keep today's behaviour: everything shown, every push sent.
ALTER TABLE auth_account_preferences
  ADD COLUMN show_city boolean NOT NULL DEFAULT true,
  ADD COLUMN show_friend_count boolean NOT NULL DEFAULT true,
  ADD COLUMN push_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN push_bookings boolean NOT NULL DEFAULT true,
  ADD COLUMN push_reels boolean NOT NULL DEFAULT true;

-- A new message queues a push only for members who did not turn message push off.
CREATE OR REPLACE FUNCTION push_queue_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO push_delivery(device_id,kind,message_id)
        SELECT d.id,'message',NEW.id
        FROM message_thread_member member JOIN push_device d ON d.user_id=member.user_id
        JOIN auth_session s ON s.id=d.session_id AND s."userId"=d.user_id
        WHERE member.thread_id=NEW.thread_id AND member.user_id<>NEW.sender_user_id
          AND NOT member.blocked AND s."expiresAt">clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM auth_account_preferences ap
            WHERE ap.user_id=member.user_id AND NOT ap.push_messages
          );
    RETURN NEW;
END;
$$;

-- Bookings (services, rentals, stays) and reel decisions follow their own choice.
CREATE OR REPLACE FUNCTION push_queue_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth_account_preferences ap
    WHERE ap.user_id=NEW.recipient_id
      AND ((NEW.kind='reel' AND NOT ap.push_reels)
        OR (NEW.kind IN ('service','rental','stay') AND NOT ap.push_bookings))
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO push_delivery(device_id,kind,activity_id)
    SELECT d.id,'activity',NEW.id
    FROM push_device d JOIN auth_session s ON s.id=d.session_id AND s."userId"=d.user_id
    WHERE d.user_id=NEW.recipient_id AND s."expiresAt">clock_timestamp()
    ON CONFLICT (device_id,activity_id) DO NOTHING;
  RETURN NEW;
END;
$$;
