// These rules operate on server-priced lines. Keep the storefront preview in sync.
const money = value => Math.round(Number(value || 0) * 100) / 100;
const kind = (line, value) => String(line.type || '').toUpperCase() === value || String(line.source || '').toUpperCase() === value;
export const isClearanceLine = line => line?.directDiscount?.isClearance === true;
const product = line => !kind(line, 'COUPON') && !kind(line, 'QUEUE_BOOST');
export const isPizzaCategory = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('pizza');

export function getDeliveryBlocks(lines, blockSize = 5) {
  const size = Math.max(1, Math.trunc(Number(blockSize) || 5));
  const products = lines.filter(product);
  const units = rows => rows.reduce((sum, line) => sum + Number(line.deliveryUnits || 0) * Number(line.qty || 1), 0);
  const regular = products.filter(line => !isClearanceLine(line));
  const totalBlocks = products.length ? Math.max(1, Math.ceil(units(products) / size)) : 0;
  const coveredBlocks = regular.length ? Math.max(1, Math.ceil(units(regular) / size)) : 0;
  return { totalBlocks, coveredBlocks, extraBlocks: Math.max(0, totalBlocks - coveredBlocks) };
}

export function getShippingBenefitFee(lines, partner, deliveryFee) {
  if (!lines.some(line => product(line) && !isClearanceLine(line))) return 0;
  // Only fixed tariffs have a configured pizza capacity. Distance tariffs stay unchanged.
  if (partner.deliveryPricingMode === 'VARIABLE') return money(deliveryFee);
  const { totalBlocks, coveredBlocks } = getDeliveryBlocks(lines, partner.deliveryFeeBlockSize);
  return totalBlocks ? money(deliveryFee * coveredBlocks / totalBlocks) : 0;
}

export function getOrderMinimum(lines, method, minimumAmount, shippingDiscount = 0) {
  const minimum = Math.max(0, money(minimumAmount));
  const productSubtotal = money(Math.max(0, lines.reduce((sum, line) => {
    if (kind(line, 'QUEUE_BOOST') || kind(line, 'INCENTIVE_REWARD')) return sum;
    return sum + Number(line.subtotal || 0);
  }, 0) + Number(shippingDiscount || 0)));
  const pickupExempt = method === 'PICKUP' && lines.some(isClearanceLine);
  const missingAmount = pickupExempt ? 0 : money(Math.max(0, minimum - productSubtotal));
  return { minimumPaymentAmount: minimum, productSubtotal, missingAmount, pickupExempt, met: missingAmount === 0 };
}
