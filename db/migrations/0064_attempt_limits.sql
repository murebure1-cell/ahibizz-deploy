-- Attempt counters of our own: tries per email address (sign-in, registration, password mail),
-- password changes per account, and app sign-ins started per account.
--
-- They used to share auth_rate_limit with the sign-in library. The library deletes every row in
-- that table older than its longest configured window (60 seconds here) whenever one of its own
-- buckets rolls over. A limit of eight password tries in fifteen minutes therefore lasted about a
-- minute (independent review, 2026-11-28). The library never touches this table.
CREATE TABLE auth_attempt_limit (
    key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 200),
    count integer NOT NULL CHECK (count >= 1),
    window_started_at timestamptz NOT NULL
);

-- For clearing out windows that ended long ago.
CREATE INDEX auth_attempt_limit_started ON auth_attempt_limit (window_started_at);

-- Counters left in the shared table are at most a minute old; they are not carried over.
DELETE FROM auth_rate_limit
WHERE key LIKE 'ahibizz-email:%'
   OR key LIKE 'account-password:%'
   OR key LIKE 'account-app-handoff:%';
