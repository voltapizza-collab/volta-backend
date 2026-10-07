import { SMS_SELL_PRICE_EUR, smsPricingInfo } from './smsCredits.js';
const VERSION = 'pos-2026-10-v4';
// Add explanatory tariff metadata to older invitations without changing their POS prices or saved offers.
export const withOnboardingSmsTariff = catalog => ({ ...catalog,
  sms: { optional: true, unitPriceEur: SMS_SELL_PRICE_EUR, ...catalog.sms } });
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
    sms: { ...smsPricingInfo(), initialCents: 0, credits: 0 },
  };
}
export function buildCommercialSelection(body, { draft = false, catalog = onboardingCommercialCatalog() } = {}) {
  const posChoice = ['PURCHASE', 'INSTALLMENTS', 'RENT_QUOTE'].includes(body.posChoice) ? body.posChoice : '';
  const count = Number(body.posInstallments);
  const posInstallments = posChoice === 'INSTALLMENTS' && Number.isInteger(count) && count >= 2 && count <= 6 ? count : null;
  const flexibleRental = ['PRICE_BY_TERM', 'AMORTIZED_RENTAL'].includes(catalog.rental.calculation);
  const rentalInput = body.posRentalMonths;
  const rentalCount = (typeof rentalInput === 'number' || typeof rentalInput === 'string' && /^\d+$/.test(rentalInput)) ? Number(rentalInput) : NaN;
  const rentalPlan = flexibleRental ? catalog.rental.termOptions.find(plan => plan.months === rentalCount) : null;
  const posRentalMonths = posChoice === 'RENT_QUOTE' ? (flexibleRental ? rentalPlan?.months ?? null : catalog.rental.durationMonths ?? 36) : null;
  const monthlyRentCents = flexibleRental ? rentalPlan?.monthlyCents ?? null : catalog.rental.monthlyCents;
  const commercialAcknowledged = body.commercialAcknowledged === true || body.commercialAcknowledged === 'true';
  const missing = [];
  if (!posChoice) missing.push('posChoice');
  if (posChoice === 'INSTALLMENTS' && !posInstallments) missing.push('posInstallments');
  if (posChoice === 'RENT_QUOTE' && flexibleRental && !rentalPlan) missing.push('posRentalMonths');
  if (!commercialAcknowledged) missing.push('commercialAcknowledged');
  if (!draft && body.commercialVersion !== catalog.version) missing.push('commercialVersion');
  const payments = posChoice === 'PURCHASE' ? [catalog.posTotalCents]
    : posChoice === 'INSTALLMENTS' && posInstallments ? installmentAmounts(posInstallments, catalog.posTotalCents) : null;
  return { missing, fields: { posChoice, posInstallments, posRentalMonths, commercialAcknowledged, commercialVersion: catalog.version },
    selection: { schemaVersion: 2, catalogVersion: catalog.version, status: draft ? 'DRAFT' : 'PENDING_REVIEW',
      currency: 'EUR', vatIncluded: true, pos: { mode: posChoice, totalCents: payments ? catalog.posTotalCents : null,
        installmentCents: payments, installmentCount: payments?.length || null, interestPercent: payments ? 0 : null,
        firstPaymentCents: payments?.[0] ?? (posChoice === 'RENT_QUOTE' ? monthlyRentCents : null), interval: posChoice === 'INSTALLMENTS' ? 'MONTHLY' : null,
        monthlyRentCents: posChoice === 'RENT_QUOTE' ? monthlyRentCents : null, depositCents: posChoice === 'RENT_QUOTE' ? catalog.rental.depositCents : null,
        durationMonths: posRentalMonths,
        ...(posChoice === 'RENT_QUOTE' && flexibleRental ? { calculation: catalog.rental.calculation, rentalTotalCents: rentalPlan?.totalCents ?? null } : {}),
        ...(posChoice === 'RENT_QUOTE' && catalog.rental.calculation === 'AMORTIZED_RENTAL' && rentalPlan ? {
          rentalPayments: rentalPlan.payments, rentalSchedule: rentalPlan.schedule,
          principalCents: rentalPlan.principalCents, interestCents: rentalPlan.interestCents,
          monthlyInterestPercent: rentalPlan.monthlyInterestPercent, annualNominalPercent: rentalPlan.annualNominalPercent,
          annualEffectivePercent: rentalPlan.annualEffectivePercent, firstPaymentTiming: rentalPlan.firstPaymentTiming,
          commissionCents: rentalPlan.commissionCents } : {}),
        ownership: posChoice === 'RENT_QUOTE' ? 'VOLTA' : 'PURCHASE_TERMS_PENDING',
        rentalTermsStatus: posChoice === 'RENT_QUOTE' ? 'QUOTE_REQUIRED' : null },
      sms: { ...withOnboardingSmsTariff(catalog).sms, initialRecharge: 'SEPARATE', initialCents: 0, credits: 0 },
      settlement: { merchantPercent: 90, voltaPercent: 9, ambassadorPercent: 1,
        scheduleStatus: 'TO_BE_AGREED', advanceFunds: false, deductPosOrSms: false },
      initialTotalCents: null, acknowledged: commercialAcknowledged,
      recordedAt: new Date().toISOString() } };
}

// These applications must use the future versioned offer/payment closure, never
// the old signature endpoint which has no equipment/SMS payment requirement.
export const needsCommercialClosure = request => Boolean(request?.formalData?.commercialCatalog || request?.formalData?.commercialSelection || request?.formalData?.onboardingDraft);
