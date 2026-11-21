import assert from "node:assert/strict";
import test from "node:test";
import { type ActivityRow, activityLabel, activityTarget } from "../src/lib/activity";

const subjectId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const event: ActivityRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version: 1,
  kind: "service",
  action: "request",
  subjectId,
  businessId,
  businessTitle: "Fixture",
  subjectName: "Usluga",
  personId: null,
  startsAt: "2030-01-01T23:30:00.000Z",
  timezone: "Europe/Sarajevo",
  ownerSide: true,
  happenedAt: "2029-12-01T10:00:00.000Z",
  unread: true,
};

test("activity links select the right kind of calendar and preserve the booking day in its timezone", () => {
  assert.equal(activityLabel(event), "Novi zahtjev za termin");
  assert.equal(
    activityTarget(event),
    `/nalog?odjeljak=djelatnosti&kalendar=service&djelatnost=${businessId}&dan=2030-01-02`,
  );
  assert.equal(
    activityTarget({ ...event, kind: "rental" }),
    `/nalog?odjeljak=djelatnosti&kalendar=rental&djelatnost=${businessId}`,
  );
  assert.equal(
    activityTarget({ ...event, ownerSide: false, action: "cancel" }),
    "/nalog?odjeljak=termini&prikaz=historija",
  );
  assert.equal(activityTarget({ ...event, subjectId: "//invalid.test" }), "/nalog/obavijesti");
});

test("messages and moderation link to the recorded conversation or Reel", () => {
  assert.equal(
    activityTarget({ ...event, kind: "message", action: "message", personId: "receiver_A" }),
    "/nalog?odjeljak=poruke&osoba=receiver_A",
  );
  assert.equal(
    activityTarget({ ...event, kind: "message", action: "message" }),
    `/nalog?odjeljak=poruke&razgovor=${subjectId}`,
  );
  assert.equal(
    activityTarget({ ...event, kind: "reel", action: "published" }),
    `/reels/${subjectId}`,
  );
  assert.equal(
    activityTarget({ ...event, kind: "reel", action: "rejected" }),
    `/nalog/reels?djelatnost=${businessId}#reel-${subjectId}`,
  );
});
