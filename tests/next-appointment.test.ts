import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentCalendar,
  appointmentWhen,
  isNextAppointment,
  type NextAppointment,
} from "../src/lib/next-appointment";

const event: NextAppointment = {
  id: "ea49cae3-4609-40f2-8650-d5b20dc1f580",
  kind: "service",
  name: "Masaža",
  businessTitle: "Studio",
  timezone: "Europe/Sarajevo",
  status: "confirmed",
  startsAt: "2027-04-02T10:30:00.000Z",
  endsAt: "2027-04-02T11:15:00.000Z",
};

test("confirmed appointment export preserves UTC instants, escapes content and folds UTF-8 safely", () => {
  const row = { ...event, name: `Dizajn, crtež; \n${"Ć".repeat(70)}` };
  const file = appointmentCalendar(row, new Date("2027-03-08T10:02:00Z"));
  const unfolded = file.replaceAll("\r\n ", "");
  assert.match(file, /DTSTART:20270402T103000Z\r\nDTEND:20270402T111500Z/);
  assert.ok(unfolded.includes(`SUMMARY:Dizajn\\, crtež\\; \\n${"Ć".repeat(70)}`));
  assert.ok(file.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.ok(file.endsWith("END:VCALENDAR\r\n"));
});

test("nightly stay uses local dates and the departure is the exclusive end", () => {
  const row: NextAppointment = {
    ...event,
    kind: "stay",
    startsAt: "2027-03-27",
    endsAt: "2027-03-30",
  };
  assert.match(
    appointmentCalendar(row),
    /DTSTART;VALUE=DATE:20270327\r\nDTEND;VALUE=DATE:20270330/,
  );
  assert.equal(appointmentWhen(row), "27. marta 2027. – 30. marta 2027.");
  assert.equal(appointmentWhen(event), "2. aprila 2027. · 12:30–13:15 (GMT+2)");
  assert.throws(() => appointmentCalendar({ ...row, status: "requested" }));
  assert.equal(isNextAppointment({ ...row, timezone: "Nije/Grad" }), false);
  assert.equal(isNextAppointment({ ...row, endsAt: row.startsAt }), false);
  assert.equal(isNextAppointment({ ...event, id: "a\r\nATTENDEE:other" }), false);
});
