const VERSION = 'pos-2026-10-v2';
export const validPosPrice = value => Number.isSafeInteger(value) && value >= 100 && value <= 1000000;
export function installmentAmounts(count, total = 25000) {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw new Error('invalid_installments');
  if (!validPosPrice(total)) throw new Error('invalid_pos_price');
  const regular = Math.round(total / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? total - regular * (count - 1) : regular);
}
export function onboardingCommercialCatalog(total = 25000, revision = 0) {
  if (!validPosPrice(total)) throw new Error('invalid_pos_price');
  return { version: `${VERSION}-${revision}-${total}`, currency: 'EUR', vatIncluded: true, posTotalCents: total,
    installments: Object.fromEntries([2, 3, 4, 5, 6].map(count => [count, installmentAmounts(count, total)])),
    rental: { status: 'QUOTE_REQUIRED', monthlyCents: null, depositCents: null, durationMonths: 36, ownershipTransfer: 'AFTER_TERM_AND_FULL_PAYMENT' },
    sms: { status: 'QUOTE_REQUIRED', initialCents: null, credits: null },
  };
}
export function buildCommercialSelection(body, { draft = false, catalog = onboardingCommercialCatalog() } = {}) {
  const posChoice = ['PURCHASE', 'INSTALLMENTS', 'RENT_QUOTE'].includes(body.posChoice) ? body.posChoice : '';
  const count = Number(body.posInstallments);
  const posInstallments = posChoice === 'INSTALLMENTS' && Number.isInteger(count) && count >= 2 && count <= 6 ? count : null;
  const commercialAcknowledged = body.commercialAcknowledged === true || body.commercialAcknowledged === 'true';
  const missing = [];
  if (!posChoice) missing.push('posChoice');
  if (posChoice === 'INSTALLMENTS' && !posInstallments) missing.push('posInstallments');
  if (!commercialAcknowledged) missing.push('commercialAcknowledged');
  if (!draft && body.commercialVersion !== catalog.version) missing.push('commercialVersion');
  const payments = posChoice === 'PURCHASE' ? [catalog.posTotalCents]
    : posChoice === 'INSTALLMENTS' && posInstallments ? installmentAmounts(posInstallments, catalog.posTotalCents) : null;
  return { missing, fields: { posChoice, posInstallments, commercialAcknowledged, commercialVersion: catalog.version },
    selection: { schemaVersion: 2, catalogVersion: catalog.version, status: draft ? 'DRAFT' : 'PENDING_REVIEW',
      currency: 'EUR', vatIncluded: true, pos: { mode: posChoice, totalCents: payments ? catalog.posTotalCents : null,
        installmentCents: payments, installmentCount: payments?.length || null, interestPercent: payments ? 0 : null,
        firstPaymentCents: payments?.[0] ?? null, interval: posChoice === 'INSTALLMENTS' ? 'MONTHLY' : null,
        monthlyRentCents: null, depositCents: null,
        durationMonths: posChoice === 'RENT_QUOTE' ? 36 : null,
        ownership: posChoice === 'RENT_QUOTE' ? 'VOLTA' : 'PURCHASE_TERMS_PENDING',
        rentalTermsStatus: posChoice === 'RENT_QUOTE' ? 'QUOTE_REQUIRED' : null },
      sms: { status: 'QUOTE_REQUIRED', initialCents: null, credits: null },
      settlement: { merchantPercent: 90, voltaPercent: 9, ambassadorPercent: 1,
        scheduleStatus: 'TO_BE_AGREED', advanceFunds: false, deductPosOrSms: false },
      initialTotalCents: null, acknowledged: commercialAcknowledged,
      recordedAt: new Date().toISOString() } };
}

// These applications must use the future versioned offer/payment closure, never
// the old signature endpoint which has no equipment/SMS payment requirement.
export const needsCommercialClosure = request => Boolean(request?.formalData?.commercialCatalog || request?.formalData?.commercialSelection || request?.formalData?.onboardingDraft);
