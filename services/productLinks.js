const list = value => {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  return Array.isArray(value) ? value : [];
};
const hasId = (values, id) => list(values).some(value => Number(value) === Number(id));
const sameCategory = (value, product) =>
  (product.categoryId && Number(value.categoryId) === product.categoryId) ||
  (product.category && String(value.categoryName || value.category || '').trim().toLowerCase() === product.category.trim().toLowerCase());
const targeted = (row, product) => hasId(row.productIds, product.id) ||
  (row.targetType === 'CATEGORY' && (hasId(row.categoryIds, product.categoryId) ||
    list(row.categoryNames).some(name => sameCategory({ categoryName: name }, product))));
export const promoProductIds = items => [...new Set(list(items).flatMap(item =>
  [item.pizzaId, ...list(item.optionProductIds)]).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];

export async function getProductLinks(prisma, product) {
  const [deals, promos, incentives, partner] = await Promise.all([
    prisma.directDiscount.findMany({ where: { partnerId: product.partnerId }, select: { id:true,title:true,targetType:true,productIds:true,categoryIds:true,categoryNames:true } }),
    prisma.promo.findMany({ where: { partnerId: product.partnerId }, select: { id:true,title:true,items:true } }),
    prisma.incentive.findMany({ where: { partnerId: product.partnerId, rewardPizzaId: product.id }, select: { id:true,name:true } }),
    prisma.partner.findUnique({ where: { id:product.partnerId }, select: { priceAdjustmentRules:true } }),
  ]);
  const promoMatches = promo => list(promo.items).some(item => {
    if (Number(item.pizzaId) === product.id || hasId(item.optionProductIds, product.id)) return true;
    return ['CATEGORY','CHOICE'].includes(String(item.type).toUpperCase()) &&
      item.choiceType !== 'PRODUCTS' && !list(item.optionProductIds).length && sameCategory(item, product);
  });
  return [
    ['TOP_DEAL', deals.filter(deal => targeted(deal,product))],
    ['PROMO', promos.filter(promoMatches)],
    ['INCENTIVE', incentives],
    ['PRICE_RULE', list(partner?.priceAdjustmentRules).filter(rule => targeted(rule,product))],
  ].filter(([,rows]) => rows.length).map(([type,rows]) => ({ type, count:rows.length,
    items:rows.map(row => ({ id:row.id,name:row.title || row.name || String(row.id) })) }));
}

// Offer writes and deletion lock the same products to prevent dangling JSON IDs.
export function withProductReferences(prisma, partnerId, productIds, save) {
  const ids = [...new Set(productIds)].sort((a,b)=>a-b);
  return prisma.$transaction(async tx => {
    if (ids.length) {
      const rows = await tx.$queryRawUnsafe(`SELECT id FROM MenuPizza WHERE partnerId = ? AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,partnerId,...ids);
      if (rows.length !== ids.length) throw Object.assign(new Error('bad_product_ids'),{status:400});
    }
    return save(tx);
  });
}

export function deleteUnlinkedProduct(prisma, id) {
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM MenuPizza WHERE id = ? FOR UPDATE',id);
    const product = await tx.menuPizza.findUnique({where:{id}});
    if (!product) throw Object.assign(new Error('product_not_found'),{status:404});
    const links = await getProductLinks(tx, product);
    if (links.length) throw Object.assign(new Error('product_linked'),{status:409,links,productName:product.name});
    await tx.menuPizza.delete({where:{id}});
    return product;
  });
}
