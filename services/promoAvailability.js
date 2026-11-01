const list = value => Array.isArray(value) ? value : [];
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// Use the current store menu: it already excludes disabled products, missing
// recipe ingredients, future launches and expired products.
export function isPromoAvailable(promo, menu = []) {
  const items = list(promo?.items);
  if (!items.length) return false;
  return items.every(item => {
    if (!item) return false;
    const choice = ['CHOICE', 'CATEGORY'].includes(String(item.type || '').trim().toUpperCase());
    const ids = list(item.optionProductIds).map(Number);
    const options = menu.filter(product => {
      if (product.available === false) return false;
      if (item.size && !list(product.selectSize).includes(item.size)) return false;
      if (!choice) return Number(item.pizzaId) > 0 && Number(item.pizzaId) === Number(product.pizzaId);
      if (ids.length || item.choiceType === 'PRODUCTS') return ids.includes(Number(product.pizzaId));
      if (Number(item.categoryId) > 0) return Number(item.categoryId) === Number(product.categoryId);
      const category = normalize(item.categoryName || item.category || item.name);
      return Boolean(category) && category === normalize(product.category || product.categoryName);
    });
    if (!choice) return options.length > 0;
    const quantity = Number(item.quantity || item.qty || 1);
    return Number.isInteger(quantity) && quantity > 0 && new Set(options.map(product => Number(product.pizzaId))).size >= quantity;
  });
}
