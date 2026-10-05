import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOnboardingEmail, buildClosureEmail, buildCredentialsEmail } from '../routes/onboarding.js';
import { onboardingCommercialCatalog } from '../services/onboardingCommercial.js';

test('invitation explains selection, stock and absence of payment or signature', () => {
  const email = buildOnboardingEmail({ name: '<script>test</script>', businessName: 'Test & Shop' }, 'https://example.invalid/onboarding/test');
  assert.match(email.text, /renting de 36 meses/); assert.match(email.text, /no se cobra ni se firma/);
  assert.match(email.html, /&lt;script&gt;/); assert.doesNotMatch(email.html, /<script>/);
});

test('first email shows three visible payment options using the frozen application price', () => {
  const commercialCatalog = onboardingCommercialCatalog(29999);
  commercialCatalog.rental.monthlyCents = 1250;
  const mail = buildOnboardingEmail({ name: 'Test', businessName: 'Test', formalData: { commercialCatalog } }, 'https://example.invalid/test');
  for (const body of [mail.html, mail.text]) {
    assert.match(body, /299,99/); assert.match(body, /12,50/); assert.match(body, /450,00/);
    assert.match(body, /tarjeta/); assert.match(body, /efectivo/); assert.match(body, /5 de 50,00/); assert.match(body, /49,99/);
    assert.doesNotMatch(body, /250,00/);
    assert.match(body, /Notificaciones SMS opcionales: 0,075 € por parte/);
    assert.match(body, /el alta no obliga a recargar/);
  }
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
  assert.match(mail.text, /Consulta o regenera el PIN/); assert.doesNotMatch(mail.text, /undefined|PIN POS: null/);
});
