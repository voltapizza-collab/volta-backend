import { onboardingCommercialCatalog, validPosPrice } from './onboardingCommercial.js';
import { normalizeOnboardingDefaults, rentalMonthlyCents } from './onboardingDefaults.js';
import { smsPricingInfo, SMS_SELL_PRICE_EUR } from './smsCredits.js';
import { rentalPlan } from './onboardingRental.js';

export async function readOnboardingPricing(db) {
  const row = await db.onboardingPricing.findUnique({ where: { id: 1 } });
  return row || { id: 1, posTotalCents: 25000, revision: 0 };
}
export async function newOnboardingCatalog(db) {
  const price = await readOnboardingPricing(db);
  const catalog = onboardingCommercialCatalog(price.posTotalCents, price.revision);
  const settings = price.defaults || {};
  const monthlyCents = rentalMonthlyCents(price.posTotalCents, settings);
  if (monthlyCents) catalog.rental = { ...catalog.rental, status: 'PROPOSED', monthlyCents, totalCents: monthlyCents * 36, depositCents: settings.depositCents ?? null };
  if (settings.rentMode === 'CUSTOMER_TERM') {
    catalog.rental = { ...catalog.rental, status: 'PROPOSED', calculation: 'PRICE_BY_TERM',
      monthlyCents: null, totalCents: null, durationMonths: null, depositCents: settings.depositCents ?? 0,
      termOptions: Array.from({ length: 36 }, (_, i) => {
        const months = i + 1, amount = Math.round(price.posTotalCents / months);
        return { months, monthlyCents: amount, totalCents: amount * months };
      }) };
  }
  catalog.sms = { ...catalog.sms, ...smsPricingInfo(settings.smsUnitPriceEur || SMS_SELL_PRICE_EUR) };
  if (settings.rentMode === 'FINANCED_TERM') {
    catalog.version += '-rental-1pct-upfront-v1';
    catalog.rental = { status: 'PROPOSED', calculation: 'AMORTIZED_RENTAL',
      monthlyCents: null, totalCents: null, durationMonths: null, maxMonths: 12,
      depositCents: settings.depositCents ?? 0, ownershipTransfer: 'AFTER_TERM_AND_FULL_PAYMENT',
      monthlyInterestPercent: 1, annualNominalPercent: 12, annualEffectivePercent: 12.682503,
      firstPaymentTiming: 'UPFRONT', commissionCents: 0,
      termOptions: Array.from({ length: 12 }, (_, i) => rentalPlan(price.posTotalCents, i + 1)) };
  }
  return catalog;
}
export async function updateOnboardingPricing(db, input, actor) {
  if (!validPosPrice(input.posTotalCents)) throw Object.assign(new Error('invalid_pos_price'), { status: 400 });
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw Object.assign(new Error('pricing_changed'), { status: 409 });
  const defaults = input.defaults === undefined ? undefined : normalizeOnboardingDefaults(input.defaults);
  return db.$transaction(async tx => {
    await tx.onboardingPricing.upsert({ where: { id: 1 }, create: { id: 1, posTotalCents: 25000, revision: 0 }, update: {} });
    const current = await tx.onboardingPricing.findUnique({ where: { id: 1 } });
    if (defaults && defaults.smsUnitPriceEur === undefined && current?.defaults?.smsUnitPriceEur !== undefined) {
      defaults.smsUnitPriceEur = current.defaults.smsUnitPriceEur;
    }
    const result = await tx.onboardingPricing.updateMany({ where: { id: 1, revision: input.revision }, data: {
      posTotalCents: input.posTotalCents, ...(defaults === undefined ? {} : { defaults }), revision: { increment: 1 }, updatedBy: actor,
    } });
    if (result.count !== 1) throw Object.assign(new Error('pricing_changed'), { status: 409 });
    return tx.onboardingPricing.findUnique({ where: { id: 1 } });
  });
}
