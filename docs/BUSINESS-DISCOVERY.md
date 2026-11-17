# Business facts, reviews and location review

Business opening hours are separate from service-booking availability. Unknown hours
remain unknown. An opted-in schedule has seven explicitly supplied days, a business
IANA time zone and up to four non-overlapping local-time intervals per day. An empty
day means closed. Overnight work is entered on both affected days. Public open/closed
status is derived from the real instant in that business time zone.

Amenities are owner-supplied facts from a bounded catalogue. They never grant halal,
identity, payment-provider or other verification. An administrator's independent
verification rules remain unchanged. Updating business facts uses the same global
business version and publication rules as the existing editor.

Reviews use one durable record per eligible person and business. The author can edit
or withdraw their review. An administrator can hide or restore it with a recorded
reason. Owners cannot review their own business. Public totals exclude withdrawn or
hidden reviews, ineligible authors and reviews that become self-reviews after an
ownership change. Review-author names and profile links are public only when that
person has chosen a public personal profile. A private author appears as
"Korisnik AhiBizza". No ratings are seeded from imported descriptions or other sites.

Location batches contain public business identity/address fields and proposed points,
with source provenance. The administrator must review them before applying them.
Every change fresh-reads the business, matches the prepared identity and address,
requires the existing point to be unknown, and patches only coordinates using the
existing actor-bound directory endpoint and version check. An uncertain response is
reconciled before another write. City centres, street centroids, ambiguous `bb`
addresses and unrelated named points are never substituted for business locations.

Anonymous reads, isolated PostgreSQL transactions, fixture interface checks and live
application changes are recorded separately in release evidence. A fixture review
or test schedule is not a public review or operational opening schedule.
