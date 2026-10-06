import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import onboardingRoutes from '../routes/onboarding.js';
import { buildCommercialSelection, installmentAmounts, onboardingCommercialCatalog } from '../services/onboardingCommercial.js';
import { isPublicWebRoute } from '../services/webAccess.js';
import { newOnboardingCatalog } from '../services/onboardingPricing.js';

test('customer selects 1–36 rental months from the frozen catalog; client prices and invalid terms cannot change it', async () => {
  const catalog = await newOnboardingCatalog({ onboardingPricing: { findUnique: async () => ({ posTotalCents: 25000, revision: 4, defaults: { rentMode: 'CUSTOMER_TERM' } }) } });
  assert.equal(catalog.rental.termOptions.length, 36);
  for (let months = 1; months <= 36; months++) {
    const result = buildCommercialSelection({ posChoice: 'RENT_QUOTE', posRentalMonths: String(months), commercialAcknowledged: true,
      commercialVersion: catalog.version, monthlyRentCents: 1, durationMonths: 99, rentalTotalCents: 1 }, { catalog });
    assert.deepEqual(result.missing, []);
    assert.equal(result.fields.posRentalMonths, months);
    assert.equal(result.selection.pos.durationMonths, months);
    assert.equal(result.selection.pos.monthlyRentCents, Math.round(25000 / months));
    assert.equal(result.selection.pos.rentalTotalCents, Math.round(25000 / months) * months);
  }
  for (const value of ['', 0, -1, 37, 12.5, 'bad', true, [12], {}, null]) {
    assert.ok(buildCommercialSelection({ posChoice: 'RENT_QUOTE', posRentalMonths: value }, { catalog }).missing.includes('posRentalMonths'));
  }
  const legacy = buildCommercialSelection({ posChoice: 'RENT_QUOTE', posRentalMonths: 12 });
  assert.equal(legacy.selection.pos.durationMonths, 36);
});

const version = onboardingCommercialCatalog().version;
test('all installment plans sum to 250 euros and ignore client price/ownership injection', () => {
  for (let count = 2; count <= 6; count++) assert.equal(installmentAmounts(count).reduce((a,b) => a+b), 25000);
  assert.deepEqual(installmentAmounts(6), [4167,4167,4167,4167,4167,4165]);
  for (const count of [0, 1, 7, 2.5, NaN]) assert.throws(() => installmentAmounts(count));
  const result = buildCommercialSelection({ posChoice: 'INSTALLMENTS', posInstallments: '6', commercialVersion: version,
    commercialAcknowledged: 'true', price: 1, totalCents: 1, paid: true, commercialSelection: { status: 'PAID' } });
  assert.deepEqual(result.missing, []);
  assert.equal(result.selection.pos.totalCents, 25000);
  assert.equal(result.selection.initialTotalCents, null);
  assert.equal(result.selection.status, 'PENDING_REVIEW');
  assert.equal(result.selection.sms.initialCents, 0);
  assert.equal(result.selection.sms.initialRecharge, 'SEPARATE');
  assert.equal(result.fields.smsRequested, undefined);
  assert.equal(result.selection.settlement.deductPosOrSms, false);
});
test('rental is a quote request with Volta ownership and no invented price or deposit', () => {
  const { selection } = buildCommercialSelection({ posChoice: 'RENT_QUOTE', monthlyRentCents: 1100, depositCents: 25000 });
  assert.equal(selection.pos.ownership, 'VOLTA');
  assert.equal(selection.pos.monthlyRentCents, null);
  assert.equal(selection.pos.depositCents, null);
  assert.equal(selection.pos.firstPaymentCents, null);
  assert.equal(selection.pos.rentalTermsStatus, 'QUOTE_REQUIRED');
});
test('requires choice, acknowledgment, valid installments and current catalog', () => {
  assert.deepEqual(buildCommercialSelection({}).missing, ['posChoice', 'commercialAcknowledged', 'commercialVersion']);
  assert.ok(buildCommercialSelection({ posChoice: 'INSTALLMENTS', posInstallments: '7' }).missing.includes('posInstallments'));
  assert.ok(buildCommercialSelection({ posChoice: 'PURCHASE', commercialAcknowledged: 'yes', commercialVersion: 'old' }).missing.includes('commercialVersion'));
  assert.equal(isPublicWebRoute('POST', '/onboarding/form/token/draft'), true);
  assert.equal(isPublicWebRoute('POST', '/onboarding/requests/1/contract/send'), false);
});

test('HTTP saves partial drafts, resumes, validates submission, freezes selection and blocks legacy signing', async t => {
  // Never connect to an SMTP server in this integration test.
  for (const key of ['SMTP_USER','GMAIL_USER','SMTP_PASS','GMAIL_APP_PASSWORD']) {
    const previous = process.env[key]; delete process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let row = { id: 1, token: 'test-token', status: 'EMAIL_SENT', email: 'test@example.com', businessName: 'Test',
    updatedAt: new Date(1000), formalData: { supportingDocuments: [{ type: 'IDENTITY' }, { type: 'FISCAL' }] } };
  let conflict = false;
  const db = { onboardingRequest: {
    findUnique: async () => structuredClone(row),
    updateMany: async ({ where, data }) => {
      if (conflict || where.status !== row.status || +where.updatedAt !== +row.updatedAt) return { count: 0 };
      row = { ...row, ...data, updatedAt: new Date(+row.updatedAt + 1) }; return { count: 1 };
    },
  } };
  const app = express(); app.use(express.json()); app.use(onboardingRoutes(db));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await post('/form/test-token/draft', { commercialName: 'Mi tienda', posChoice: 'INSTALLMENTS', posInstallments: 6, smsRequested: true,
    activation: { partnerId: 99 }, supportingDocuments: [{ type: 'BANK' }] });
  assert.equal(response.status, 200);
  assert.equal(row.status, 'EMAIL_SENT'); assert.equal(row.submittedAt, undefined);
  assert.equal(row.formalData.onboardingDraft.activation, undefined);
  assert.equal(row.formalData.supportingDocuments.length, 2);
  const loaded = await (await fetch(url + '/form/test-token')).json();
  assert.equal(loaded.request.formalData.onboardingDraft.commercialName, 'Mi tienda');
  assert.equal(loaded.request.formalData.onboardingDraft.smsRequested, undefined);
  assert.equal(loaded.request.commercialCatalog.posTotalCents, 25000);
  conflict = true;
  assert.equal((await post('/form/test-token/draft', { commercialName: 'Stale' })).status, 409);
  assert.equal(row.formalData.onboardingDraft.commercialName, 'Mi tienda');
  conflict = false;
  assert.equal((await post('/form/test-token', {})).status, 400);
  const fields = { partnerType: 'AUTONOMO', legalName: 'Test', taxId: 'TEST', legalRepresentative: 'Test', representativeRole: 'Titular',
    commercialName: 'Mi tienda', businessAddress: 'Calle 1', city: 'Madrid', postalCode: '28001', country: 'España',
    businessPhone: '600000000', businessEmail: 'test@example.com', accountHolder: 'Test', iban: 'ES0012341234123412341234',
    acceptedTerms: true, acceptedCompliance: true, posChoice: 'INSTALLMENTS', posInstallments: 6,
    commercialVersion: version, commercialAcknowledged: true };
  response = await post('/form/test-token', fields);
  assert.equal(response.status, 200);
  assert.equal(row.status, 'IN_REVIEW');
  assert.equal(row.formalData.onboardingDraft, undefined);
  assert.equal(row.formalData.commercialSelection.pos.firstPaymentCents, 4167);
  assert.equal(row.formalData.commercialSelection.sms.initialRecharge, 'SEPARATE');
  assert.equal((await post('/form/test-token/draft', fields)).status, 409);
  assert.equal((await post('/form/test-token', fields)).status, 409);
  response = await post('/requests/1/contract/send', {});
  assert.equal(response.status, 403); assert.equal((await response.json()).error, 'admin_required');
  row.status = 'CONTRACT_SENT'; // Even manual status updates cannot bypass the legacy signature guard.
  response = await post('/form/test-token/sign-contract', { acceptedContract: true });
  assert.equal(response.status, 409); assert.equal((await response.json()).error, 'commercial_closure_pending');

  const rentalCatalog = await newOnboardingCatalog({ onboardingPricing: { findUnique: async () => ({ posTotalCents: 25000, revision: 4, defaults: { rentMode: 'CUSTOMER_TERM' } }) } });
  row = { ...row, status: 'EMAIL_SENT', submittedAt: null, formalData: { commercialCatalog: rentalCatalog, supportingDocuments: [{ type: 'IDENTITY' }, { type: 'FISCAL' }] } };
  assert.equal((await post('/form/test-token/draft', { posChoice: 'RENT_QUOTE', posRentalMonths: 12 })).status, 200);
  const resumed = (await (await fetch(url + '/form/test-token')).json()).request;
  assert.equal(resumed.formalData.onboardingDraft.posRentalMonths, 12);
  assert.equal(resumed.formalData.onboardingDraft.commercialSelection.pos.monthlyRentCents, 2083);
  const rentalFields = { ...fields, posChoice: 'RENT_QUOTE', commercialVersion: rentalCatalog.version, posRentalMonths: 37 };
  response = await post('/form/test-token', rentalFields);
  assert.equal(response.status, 400); assert.ok((await response.json()).missing.includes('posRentalMonths'));
  assert.equal((await post('/form/test-token', { ...rentalFields, posRentalMonths: 12, monthlyRentCents: 1 })).status, 200);
  assert.equal(row.formalData.posRentalMonths, 12);
  assert.equal(row.formalData.commercialSelection.pos.monthlyRentCents, 2083);
  assert.equal(row.formalData.commercialSelection.pos.durationMonths, 12);
  assert.equal(row.formalData.commercialSelection.pos.rentalTotalCents, 24996);
});
