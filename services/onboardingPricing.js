import { onboardingCommercialCatalog, validPosPrice } from './onboardingCommercial.js';

export async function readOnboardingPricing(db) {
  const row = await db.onboardingPricing.findUnique({ where: { id: 1 } });
  return row || { id: 1, posTotalCents: 25000, revision: 0 };
}
export async function newOnboardingCatalog(db) {
  const price = await readOnboardingPricing(db);
  return onboardingCommercialCatalog(price.posTotalCents, price.revision);
}
export async function updateOnboardingPricing(db, input, actor) {
  if (!validPosPrice(input.posTotalCents)) throw Object.assign(new Error('invalid_pos_price'), { status: 400 });
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw Object.assign(new Error('pricing_changed'), { status: 409 });
  return db.$transaction(async tx => {
    await tx.onboardingPricing.upsert({ where: { id: 1 }, create: { id: 1, posTotalCents: 25000, revision: 0 }, update: {} });
    const result = await tx.onboardingPricing.updateMany({ where: { id: 1, revision: input.revision }, data: {
      posTotalCents: input.posTotalCents, revision: { increment: 1 }, updatedBy: actor,
    } });
    if (result.count !== 1) throw Object.assign(new Error('pricing_changed'), { status: 409 });
    return tx.onboardingPricing.findUnique({ where: { id: 1 } });
  });
}
