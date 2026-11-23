import assert from "node:assert/strict";
import test from "node:test";
import { readCalendarTarget } from "../src/lib/business-today";
import { supportEmail } from "../src/lib/support-requests";
import { mailExamples } from "../src/server/mail/examples";
import { emailLogoCid } from "../src/server/mail/layout";

const origin = "https://ahibizz.example";
function rendered(id: string) {
  const example = mailExamples.find((entry) => entry.id === id);
  assert.ok(example, `Missing example: ${id}`);
  return example.render(origin);
}

test("only the three current SMTP kinds are marked as active", () => {
  assert.equal(new Set(mailExamples.map((entry) => entry.id)).size, mailExamples.length);
  assert.deepEqual(
    mailExamples
      .filter((entry) => entry.active)
      .map((entry) => entry.id)
      .sort(),
    ["account-approved", "password-reset", "verification"],
  );
  for (const entry of mailExamples) {
    const message = entry.render(origin);
    assert.match(message.subject, /AhiBizz$/);
    assert.ok(message.text.includes(origin));
    assert.ok(message.text.includes(supportEmail));
    assert.ok(message.html.includes(`cid:${emailLogoCid}`));
  }
});

test("booking preview links select the correct owner's calendar or guest's appointments", () => {
  for (const kind of ["service", "rental", "stay"]) {
    const owner = mailExamples.find((entry) => entry.id === `${kind}-owner-requested`);
    assert.ok(owner?.label.startsWith("Vlasnik · "));
    const guest = mailExamples.find((entry) => entry.id === `${kind}-customer-requested`);
    assert.ok(guest?.label.startsWith(kind === "stay" ? "Gost · " : "Korisnik · "));
    const ownerPreview = rendered(`${kind}-owner-requested`);
    const url = ownerPreview.text.split("\n").find((line) => line.startsWith(`${origin}/nalog?`));
    assert.ok(url);
    assert.equal(readCalendarTarget(new URL(url).searchParams)?.kind, kind);
    for (const status of ["requested", "confirmed", "declined", "cancelled"]) {
      const customer = rendered(`${kind}-customer-${status}`);
      assert.ok(customer.text.includes(`${origin}/nalog?odjeljak=termini`));
    }
  }
  assert.ok(rendered("service-customer-completed").text.includes("održan"));
  assert.ok(!mailExamples.some((entry) => /^(stay|rental)-customer-completed$/.test(entry.id)));
});

test("owner, moderation and support notices link to role-appropriate sections", () => {
  for (const [id, path] of [
    ["business-assigned", "/nalog?odjeljak=djelatnosti"],
    ["person-verified", "/nalog?odjeljak=profil"],
    ["business-badge-removed", "/nalog?odjeljak=djelatnosti"],
    ["support-admin-report", "/administracija/zahtjevi"],
    ["support-reviewed", "/pravila-zajednice"],
    ["deletion-requested", "/brisanje-naloga"],
    ["direct-message", "/nalog?odjeljak=poruke"],
  ] as const) {
    assert.ok(rendered(id).text.includes(`${origin}${path}`), id);
  }
});
