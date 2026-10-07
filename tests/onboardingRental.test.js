import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalPlan } from '../services/onboardingRental.js';
import { newOnboardingCatalog } from '../services/onboardingPricing.js';
import { buildCommercialSelection } from '../services/onboardingCommercial.js';
import { buildOnboardingEmail } from '../routes/onboarding.js';

test('advance payment reduces principal immediately; monthly interest and final cent adjustment settle the balance', () => {
  const plan = rentalPlan(25000, 12);
  assert.deepEqual(plan.payments, [...Array(11).fill(2199), 2201]);
  assert.equal(plan.totalCents, 26390);
  assert.equal(plan.interestCents, 1390);
  assert.equal(plan.schedule[0].interestCents, 0);
  assert.equal(plan.schedule[0].balanceCents, 22801);
  assert.equal(plan.schedule[1].interestCents, 228);
  assert.equal(plan.schedule.at(-1).balanceCents, 0);
  assert.deepEqual(rentalPlan(25000, 1).payments, [25000]);
  for (const principal of [100, 999, 25000, 29999, 1000000]) for (let n = 1; n <= 12; n++) {
    const p = rentalPlan(principal, n);
    assert.equal(p.schedule.reduce((sum, row) => sum + row.principalCents, 0), principal);
    assert.ok(p.schedule.every(row => row.paymentCents > 0 && row.balanceCents >= 0));
    assert.equal(p.schedule.at(-1).balanceCents, 0);
    // Independent discounted cash-flow check, allowing cent-rounding each period.
    assert.ok(Math.abs(p.payments.reduce((sum, amount, i) => sum + amount / 1.01 ** i, 0) - principal) < 6);
  }
  for (const n of [0, 13, 36, 1.5, '12']) assert.throws(() => rentalPlan(25000, n));
});

test('new financed catalog caps terms at 12 and freezes server amounts; older catalog keeps 36', async () => {
  const db = mode => ({ onboardingPricing: { findUnique: async () => ({ posTotalCents: 25000, revision: 5, defaults: { rentMode: mode } }) } });
  const catalog = await newOnboardingCatalog(db('FINANCED_TERM'));
  assert.equal(catalog.rental.termOptions.length, 12);
  const select = months => buildCommercialSelection({ posChoice: 'RENT_QUOTE', posRentalMonths: months,
    commercialVersion: catalog.version, commercialAcknowledged: true, monthlyInterestPercent: 0,
    rentalPayments: [1], monthlyRentCents: 1 }, { catalog });
  const result = select(12);
  assert.deepEqual(result.missing, []);
  assert.equal(result.selection.pos.firstPaymentCents, 2199);
  assert.equal(result.selection.pos.monthlyInterestPercent, 1);
  assert.equal(result.selection.pos.rentalTotalCents, 26390);
  assert.deepEqual(result.selection.pos.rentalPayments, [...Array(11).fill(2199), 2201]);
  assert.ok(select(13).missing.includes('posRentalMonths'));
  assert.equal((await newOnboardingCatalog(db('CUSTOMER_TERM'))).rental.termOptions.length, 36);
  const mail = buildOnboardingEmail({ name: 'Test', businessName: 'Test', formalData: { commercialCatalog: catalog } }, 'https://example.invalid/form');
  for (const body of [mail.html, mail.text]) {
    assert.match(body, /Renting hasta 12 meses/);
    assert.doesNotMatch(body, /36 meses|21,99|263,90|1 %/);
  }
});
