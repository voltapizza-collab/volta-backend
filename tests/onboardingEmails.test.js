import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingEmail, buildClosureEmail, buildCredentialsEmail } from '../routes/onboarding.js';
import { onboardingCommercialCatalog } from '../services/onboardingCommercial.js';
import { newOnboardingCatalog } from '../services/onboardingPricing.js';

test('new invitation describes a maximum; closure email uses the chosen rental term', async () => {
  const commercialCatalog = await newOnboardingCatalog({ onboardingPricing: { findUnique: async () => ({ posTotalCents: 25000, revision: 4, defaults: { rentMode: 'CUSTOMER_TERM' } }) } });
  const mail = buildOnboardingEmail({ name: 'Test', businessName: 'Shop', formalData: { commercialCatalog } }, 'https://example.invalid/test');
  for (const text of [mail.text, mail.html]) {
    assert.match(text, /hasta 36 meses/); assert.doesNotMatch(text, /La cuota se calcula|Elige el número de mensualidades/);
    assert.doesNotMatch(text, /completar las 36 mensualidades/);
  }
  const row = { name: 'Test', formalData: { closure: { offer: { workflow: 'SIGN_PAY_ACTIVATE', revision: 1, totalCents: 2083,
    lines: [{ label: 'POS', amountCents: 2083 }], pos: { mode: 'RENT_QUOTE', durationMonths: 12, firstCents: 2083, totalCents: 24996 } } } } };
  const closure = buildClosureEmail(row, 'https://example.invalid/test');
  for (const text of [closure.text, closure.html]) {
    assert.match(text, /Renting de 12 meses/); assert.match(text, /20,83/); assert.match(text, /249,96/);
    assert.match(text, /completar las 12 mensualidades/); assert.doesNotMatch(text, /36 mensualidades|Renting de 36/);
  }
});

test('invitation explains selection, stock and absence of payment or signature', () => {
  const email = buildOnboardingEmail({ name: '<script>test</script>', businessName: 'Test & Shop' }, 'https://example.invalid/onboarding/test');
  assert.match(email.text, /Renting de 36 meses/); assert.match(email.text, /no se cobra ni se firma/);
  assert.match(email.html, /&lt;script&gt;/); assert.doesNotMatch(email.html, /<script>/);
});

test('first email shows only payment method buttons; prices and details remain in the form', () => {
  const commercialCatalog = onboardingCommercialCatalog(29999);
  commercialCatalog.rental.monthlyCents = 1250;
  const mail = buildOnboardingEmail({ name: 'Test', businessName: 'Test', formalData: { commercialCatalog } }, 'https://example.invalid/test');
  for (const body of [mail.html, mail.text]) {
    assert.match(body, /Continuar a la fase 2/);
    assert.match(body, /Al contado/); assert.match(body, /Compra a plazos/); assert.match(body, /Renting de 36 meses/);
    assert.doesNotMatch(body, /299,99|12,50|450,00|250,00|5 de 50,00|49,99|0,075|Stripe|prioridad/);
    assert.match(body, /notificaciones SMS son opcionales/);
    for (const mode of ['PURCHASE', 'INSTALLMENTS', 'RENT_QUOTE']) assert.match(body, new RegExp(`posChoice=${mode}`));
  }
  assert.match(mail.html, /href="https:\/\/example.invalid\/test"[^>]*>Continuar a la fase 2/);
});
test('closure email contains itemized initial payment, rental ownership, delivery and resume instructions', () => {
  const row = { name: 'Test', businessName: 'Shop', formalData: { closure: { offer: { revision: 3, signatureDays: 7, totalCents: 2100,
    lines: [{ label: 'POS', amountCents: 1100 }, { label: 'SMS', amountCents: 1000 }],
    pos: { mode: 'RENT_QUOTE', durationMonths: 36, firstCents: 1100, totalCents: 39600, delivery: { status: 'REPLENISHMENT', expected: '2099-01-01', latest: '2099-01-10' } } } } } };
  const mail = buildClosureEmail(row, 'https://example.invalid/onboarding/test?contract=1');
  for (const text of [mail.text, mail.html]) {
    assert.match(text, /396,00/); assert.match(text, /21,00/); assert.match(text, /sin pago residual/);
    assert.match(text, /2099-01-10/); assert.match(text, /sin volver a pagar/); assert.match(text, /cerrada a pedidos/);
  }
});
test('welcome uses scoped links, distinguishes preparation and safely omits unavailable PIN on resend', () => {
  const mail = buildCredentialsEmail({ name: 'Test' }, { partnerSlug: 'local-test', partnerName: 'Shop', storeSlug: 'central', storeName: 'Central', username: 'local-test',
    invitationUrl: 'https://example.invalid/backoffice/local-test?reset=test' });
  assert.match(mail.text, /\/backoffice\/local-test/); assert.match(mail.text, /\/pos\/local-test\/central/);
  assert.match(mail.text, /recepción de pedidos sigue cerrada/); assert.match(mail.text, /no confirma la entrega física/);
  assert.match(mail.text, /Contraseña inicial: local-test/); assert.match(mail.text, /Cuenta y contraseña/);
  assert.doesNotMatch(mail.text + mail.html, /reset=|Crear mi contraseña|24 horas/);
  assert.match(mail.text, /Consulta o regenera el PIN/); assert.doesNotMatch(mail.text, /undefined|PIN POS: null/);
});
