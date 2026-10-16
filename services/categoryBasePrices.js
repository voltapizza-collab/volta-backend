export const CUSTOM_BASE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'ST'];

export function validateCategoryBasePrices(value, availableSizes) {
  const invalid = () => { throw Object.assign(new Error('invalid_category_base_prices'), { status: 400 }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = {};
  for (const [size, price] of Object.entries(value)) {
    if (!CUSTOM_BASE_SIZES.includes(size) || !availableSizes.includes(size) ||
        typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 10000 ||
        Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) invalid();
    result[size] = Math.round(price * 100) / 100;
  }
  return result;
}

export function configuredCategoryBasePrice(prices, size) {
  const price = prices?.[size];
  return typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= 10000
    ? Math.round(price * 100) / 100 : null;
}
