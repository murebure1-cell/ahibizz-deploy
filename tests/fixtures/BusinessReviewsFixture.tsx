"use client";
import { useMemo, useState } from "react";
import { BusinessReviews } from "../../src/components/reviews/BusinessReviews";
import { ReviewsAdmin } from "../../src/components/reviews/ReviewsAdmin";
import { createBusinessReviewsMemory, reviewFixtureBusiness } from "./business-reviews-memory";
export function BusinessReviewsFixture() {
  const [memory] = useState(createBusinessReviewsMemory),
    [role, setRole] = useState("fixture-customer"),
    [revision, setRevision] = useState(0);
  const api = useMemo(() => memory.api(role), [memory, role]);
  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "28px 16px",
        fontFamily: "Arial, sans-serif",
        background: "#f5f6f8",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 24, color: "#173347" }}>Recenzije — izolirani pregled</h1>
      <nav
        aria-label="Uloga u testnom prikazu"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}
      >
        {[
          ["fixture-customer", "Korisnik"],
          ["fixture-owner", "Vlasnik"],
          ["fixture-admin", "Admin"],
          ["guest", "Posjetilac"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={role === value}
            onClick={() => {
              setRole(value as string);
              setRevision((v) => v + 1);
            }}
            style={{
              padding: "12px 15px",
              borderRadius: 12,
              border: "1px solid #c9d4da",
              background: role === value ? "#173347" : "white",
              color: role === value ? "white" : "#173347",
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {role === "fixture-admin" ? (
        <ReviewsAdmin key={revision} api={memory.admin} expectedAccountId="fixture-admin" />
      ) : (
        <BusinessReviews key={revision} businessId={reviewFixtureBusiness} api={api} />
      )}
    </main>
  );
}
