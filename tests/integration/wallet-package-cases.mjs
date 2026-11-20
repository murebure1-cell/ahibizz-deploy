import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPackageBenefits } from "../../src/server/paypal-subscriptions/benefits.ts";
import { createPackageSubscriptions } from "../../src/server/paypal-subscriptions/service.ts";

export async function verifyWalletPackages({ pool, auth, customer, plans, provider }) {
  const service = createPackageSubscriptions({ environment: "live", pool, auth, plans, provider });
  const buyer = await customer(),
    stranger = await customer(),
    second = await customer();
  const setRate = (amount) =>
    pool.query(
      "INSERT INTO ahi_credit_rate(request_id,unit_bam_minor,changed_by) VALUES($1,$2,$3)",
      [randomUUID(), amount, buyer.id],
    );
  await setRate(100);
  const benefits = await getPackageBenefits(pool);
  const offer = (person, period = "monthly", packageId = "business", minor = 4900) => ({
    businessId: person.businessId,
    requestId: randomUUID(),
    packageId,
    period,
    accepted: true,
    benefitsVersion: benefits.version,
    expectedCreditMinor: minor,
  });
  const balance = async (p) => (await service.list(p.headers)).walletBalance;
  const fund = (person, quantity) =>
    pool.query(
      `INSERT INTO marketing_order(id,account_id,kind,quantity,status,amount_minor,instructions,quoted_by,quoted_at,settled_by,paid_at,bank_reference)
     VALUES($1,$2,'credits',$3,'paid',$3::int*100,'Test',$2,now(),$2,now(),$4)`,
      [randomUUID(), person.id, quantity, randomUUID()],
    );
  const monthly = offer(buyer);
  await assert.rejects(service.create(buyer.headers, monthly, true), {
    code: "INSUFFICIENT_CREDITS",
  });
  assert.equal((await service.list(buyer.headers)).contracts.length, 0);
  await fund(buyer, 100);
  await assert.rejects(service.create(stranger.headers, monthly, true), { status: 403 });
  await assert.rejects(
    service.create(buyer.headers, { ...monthly, expectedCreditMinor: 48 }, true),
    { code: "WALLET_PAYMENT_CHANGED" },
  );
  const [one, retry] = await Promise.all([
    service.create(buyer.headers, monthly, true),
    service.create(buyer.headers, monthly, true),
  ]);
  assert.equal(one.contract.id, retry.contract.id);
  assert.equal(one.contract.paidCycles, 1);
  assert.equal(one.contract.paidEurMinor, 0);
  assert.equal(one.contract.paymentMethod, "credits");
  assert.equal(await balance(buyer), 51);
  const { expectedCreditMinor, ...paypalOffer } = monthly;
  await assert.rejects(service.create(buyer.headers, { ...paypalOffer, requestId: randomUUID() }), {
    code: "SUBSCRIPTION_ALREADY_EXISTS",
  });
  await assert.rejects(service.create(buyer.headers, paypalOffer), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  const renewal = { cycle: 2, expectedCreditMinor };
  await assert.rejects(service.payCreditCycle(buyer.headers, one.contract.id, renewal), {
    code: "PACKAGE_CYCLE_NOT_DUE",
  });
  await assert.rejects(service.payCreditCycle(stranger.headers, one.contract.id, renewal), {
    status: 404,
  });
  await pool.query(
    "UPDATE live_package_contract SET starts_at=now()-interval '1 month 1 hour',ends_at=now()-interval '1 hour' WHERE id=$1",
    [one.contract.id],
  );
  await setRate(50);
  const [renewed, replayed] = await Promise.all([
    service.payCreditCycle(buyer.headers, one.contract.id, renewal),
    service.payCreditCycle(buyer.headers, one.contract.id, renewal),
  ]);
  assert.equal(renewed.contract.paidCycles, 2);
  assert.equal(replayed.contract.paidCycles, 2);
  assert.equal(await balance(buyer), 2);
  const checkWindow = (id) =>
    pool.query(
      "SELECT paid_package_placement(b,'listing') AS listing,paid_package_placement(b,'nearby') AS nearby FROM directory_business b WHERE b.id=$1",
      [id],
    );
  assert.deepEqual((await checkWindow(buyer.businessId)).rows, [{ listing: true, nearby: true }]);
  await fund(second, 2000);
  const annual = offer(second, "annual", "premium", 178000);
  const prepaid = await service.create(second.headers, annual, true);
  assert.equal(prepaid.contract.totalCycles, 1);
  assert.equal(prepaid.contract.paidCycles, 1);
  assert.equal(await balance(second), 220);
  await assert.rejects(
    service.payCreditCycle(second.headers, prepaid.contract.id, {
      cycle: 2,
      expectedCreditMinor: 178000,
    }),
    { code: "PACKAGE_CYCLE_NOT_DUE" },
  );
  await pool.query(
    "UPDATE live_package_contract SET starts_at=now()-interval '5 months 2 hours',ends_at=now()+interval '7 months' WHERE id=$1",
    [prepaid.contract.id],
  );
  assert.deepEqual((await checkWindow(second.businessId)).rows, [{ listing: true, nearby: true }]);
  const withoutGateway = createPackageSubscriptions({
    environment: "live",
    pool,
    auth,
    plans: {},
    provider: null,
  });
  const basicBuyer = await customer();
  await fund(basicBuyer, 70);
  await pool.query("UPDATE directory_business SET package_access='subscription' WHERE id=$1", [
    basicBuyer.businessId,
  ]);
  const basic = await withoutGateway.create(
    basicBuyer.headers,
    offer(basicBuyer, "monthly", "basic", 5800),
    true,
  );
  assert.equal(basic.contract.packageId, "basic");
  assert.equal(await balance(basicBuyer), 12);
  for (const [packageId, period, price] of [
    ["basic", "annual", 290],
    ["premium", "monthly", 89],
    ["business", "annual", 490],
  ]) {
    const person = await customer();
    await fund(person, 1000);
    if (packageId === "basic")
      await pool.query("UPDATE directory_business SET package_access='subscription' WHERE id=$1", [
        person.businessId,
      ]);
    const chargeMinor = price * 200; // Current conversion is two credits per KM.
    const input = offer(person, period, packageId, chargeMinor);
    await assert.rejects(
      withoutGateway.create(person.headers, { ...input, accepted: false }, true),
      { code: "INVALID_SUBSCRIPTION_INPUT" },
    );
    await assert.rejects(
      withoutGateway.create(
        person.headers,
        { ...input, benefitsVersion: benefits.version + 1 },
        true,
      ),
      { code: "PACKAGE_BENEFITS_CHANGED" },
    );
    const acquired = await withoutGateway.create(person.headers, input, true);
    assert.equal(acquired.contract.cycleCreditMinor, chargeMinor);
    assert.equal(acquired.contract.totalCycles, period === "monthly" ? 12 : 1);
    assert.equal(await balance(person), 1000 - chargeMinor / 100);
  }
  const held = await customer();
  await fund(held, 1000);
  await pool.query(
    `INSERT INTO live_package_contract(id,user_id,business_id,business_title,request_id,package_id,period,amount_bam_minor,amount_eur_minor,total_cycles,benefits_version,nearby_days,featured_days,plan_id,status)
    VALUES($1,$2,$3,'Test',$4,'business','monthly',4900,2505,12,$5,7,0,'P-TEST','APPROVAL_PENDING')`,
    [randomUUID(), held.id, held.businessId, randomUUID(), benefits.version],
  );
  await assert.rejects(
    service.create(held.headers, offer(held, "monthly", "business", 9800), true),
    { code: "SUBSCRIPTION_ALREADY_EXISTS" },
  );
  assert.equal(await balance(held), 1000);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM live_package_payment WHERE contract_id IN ($1,$2,$3)`,
    [one.contract.id, prepaid.contract.id, basic.contract.id],
  );
  assert.equal(rows[0].n, 0);
}
