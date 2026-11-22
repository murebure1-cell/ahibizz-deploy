ALTER TABLE support_request
  DROP CONSTRAINT support_request_subject_check,
  ADD CONSTRAINT support_request_subject_check
    CHECK (subject IN ('deletion','person','business','review','conversation','help','reel'));
