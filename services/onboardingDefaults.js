import { creditsFromAmount, getSmsCreditPackages, SMS_SELL_PRICE_EUR, normalizeSmsPrice, smsPricingInfo } from './smsCredits.js';

const fail = () => { throw Object.assign(new Error('invalid_onboarding_defaults'), { status: 400 }); };
export function normalizeOnboardingDefaults(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  const result = { rentMode: input.rentMode || 'FIXED' };
  if (input.smsUnitPriceEur !== undefined) result.smsUnitPriceEur = normalizeSmsPrice(input.smsUnitPriceEur);
  if (!['FIXED', 'PRICE_24', 'PRICE_36', 'CUSTOMER_TERM'].includes(result.rentMode)) fail();
  for (const [key, min, max] of [['rentCents',1,1000000],['depositCents',0,1000000],['smsCents',1,1000000],['signatureDays',1,60],['refundDays',1,30]]) {
    const value = input[key];
    if (value == null || value === '') { result[key] = null; continue; }
    if (!Number.isSafeInteger(value) || value < min || value > max) fail();
    result[key] = value;
  }
  for (const key of ['equipmentTerms','settlementTerms','supplyTerms','cancellationTerms']) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > (key === 'equipmentTerms' ? 8000 : 4000) || (value.trim() && value.trim().length < 30)) fail();
    result[key] = value.trim();
  }
  return result;
}
export const rentalMonthlyCents = (price, defaults = {}) => defaults.rentMode === 'PRICE_24' ? Math.round(price / 24)
  : defaults.rentMode === 'PRICE_36' ? Math.round(price / 36) : defaults.rentCents ?? null;

export function offerDefaults(request, pricing, generalTerms) {
  const settings = pricing.defaults || {};
  const referencePrice = request.formalData?.commercialSelection?.pos?.totalCents ?? request.formalData?.commercialCatalog?.posTotalCents ?? pricing.posTotalCents;
  return { generalTerms, ...settings, posTotalCents: referencePrice,
    rentCents: request.formalData?.commercialCatalog?.rental?.monthlyCents ?? rentalMonthlyCents(referencePrice, settings),
    smsCents: request.formalData?.commercialCatalog?.sms?.initialCents ?? settings.smsCents ?? null,
    smsCredits: request.formalData?.commercialCatalog?.sms?.credits ?? (settings.smsCents ? creditsFromAmount(settings.smsCents / 100) : null),
    depositCents: request.formalData?.commercialCatalog?.rental?.depositCents ?? settings.depositCents ?? null,
    supplyReference: `POS · expediente ${request.id}`,
    ...(request.formalData?.commercialSelection?.sms?.initialRecharge === 'SEPARATE' ? { smsCents: 0, smsCredits: 0 } : {}),
  };
}
export const onboardingSmsPackages = (price = SMS_SELL_PRICE_EUR) => getSmsCreditPackages(price).map(pack => ({ cents: Math.round(pack.amount * 100), credits: pack.credits }));
export const onboardingSmsPricing = smsPricingInfo;
