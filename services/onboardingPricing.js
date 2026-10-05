import { onboardingCommercialCatalog, validPosPrice } from './onboardingCommercial.js';
import { normalizeOnboardingDefaults, rentalMonthlyCents } from './onboardingDefaults.js';
import { smsPricingInfo, SMS_SELL_PRICE_EUR } from './smsCredits.js';

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
  catalog.sms = { ...catalog.sms, ...smsPricingInfo(settings.smsUnitPriceEur || SMS_SELL_PRICE_EUR) };
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
