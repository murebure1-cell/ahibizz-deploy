-- The owner's answer to a review, as drawn ("Odgovor vlasnika"): at most one per review, shown
-- under it. It lives beside the review, not in it, so answering never changes the review's own
-- version or history. When a review is removed (its author's account is erased), its answer goes
-- with it.
CREATE TABLE business_review_reply (
    review_id uuid PRIMARY KEY REFERENCES business_review(id) ON DELETE CASCADE,
    author_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000 AND body = btrim(body)),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
