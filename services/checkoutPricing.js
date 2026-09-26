import { loadStorefrontPricing } from '../routes/stores.js';
import { normalizeBoostSettings } from './boostSettings.js';

const array = value => Array.isArray(value) ? value : [];
const money = value => Math.round(Number(value) * 100) / 100;
const equalMoney = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(money(a) - money(b)) < 0.005;
const fail = (line, code = 'cart_price_changed', details = {}) => { throw Object.assign(new Error(code), { status: 409, details: { cartLineId: line.cartLineId, line: line.name, ...details } }); };
const matches = (line, type, source) => String(line.type || '').toUpperCase() === type || String(line.source || '').toLowerCase() === source;
const coupon = line => matches(line, 'COUPON', 'coupon');
const reward = line => matches(line, 'INCENTIVE_REWARD', 'incentive_reward');
const boost = line => matches(line, 'QUEUE_BOOST', 'queue_boost');
const custom = line => matches(line, 'CUSTOM_BUILD', 'custom') || String(line.cartLineId).startsWith('custom-');
const half = line => Boolean(line.leftPizzaId || line.rightPizzaId || line.type === 'HALF_HALF');
const promo = line => Boolean(line.promoId || array(line.promoItems).length || matches(line, 'PROMO', 'promo'));
const localNow = now => new Date(now.toLocaleString('sv-SE', { timeZone: process.env.TIMEZONE || 'Europe/Madrid' }).replace(' ', 'T'));
export const offerInWindow = (offer, now = new Date()) => {
  if (offer.status && offer.status !== 'ACTIVE') return false;
  if (offer.active === false) return false;
  const start = offer.activeFrom || offer.startsAt, end = offer.expiresAt || offer.endsAt;
  if ((start && new Date(start) > now) || (end && new Date(end) <= now)) return false;
  const local = localNow(now), days = array(offer.daysActive);
  if (days.length && !days.map(Number).includes(local.getDay())) return false;
  const minute = local.getHours() * 60 + local.getMinutes();
  const from = offer.windowStart == null ? 0 : Number(offer.windowStart), to = offer.windowEnd == null ? 1440 : Number(offer.windowEnd);
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
};
const productPrice = (product, size, line) => {
  if (!product || !array(product.selectSize).includes(size) || !Number.isFinite(Number(product.priceBySize?.[size])) || Number(product.priceBySize[size]) <= 0) fail(line, 'cart_item_unavailable');
  return Number(product.priceBySize[size]);
};
const categorySame = (a,b) => a.categoryId != null ? Number(a.categoryId) === Number(b.categoryId) : a.category === b.category;
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// Match promo slots to individual units rather than trusting cart category names
// or a total price supplied by the browser. The matching permits overlapping groups.
export function validatePromoComposition(line, offer, byId) {
  const units = [], slots = [];
  for (const item of array(line.promoItems)) {
    const count = Number(item.quantity ?? item.qty ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 100 || units.length + count > 100) fail(line, 'cart_offer_unavailable');
    const product = byId.get(Number(item.pizzaId)); productPrice(product, item.size, line);
    for (let i=0;i<count;i++) units.push({ ...item, product });
  }
  for (const item of array(offer.items)) {
    const count = Number(item.quantity || 1);
    if (!Number.isInteger(count) || count < 1 || count > 100 || slots.length + count > 100) fail(line, 'cart_offer_unavailable');
    for (let i=0;i<count;i++) slots.push(item);
  }
  if (!slots.length || slots.length !== units.length) fail(line, 'cart_offer_unavailable');
  const accepts = (slot, unit) => {
    if (slot.size && slot.size !== unit.size) return false;
    if (!['CHOICE','CATEGORY'].includes(String(slot.type || '').toUpperCase())) return Number(slot.pizzaId) === Number(unit.pizzaId);
    const ids = array(slot.optionProductIds).map(Number);
    if (ids.length || slot.choiceType === 'PRODUCTS') return ids.includes(Number(unit.pizzaId));
    return slot.categoryId ? Number(slot.categoryId) === unit.product.categoryId : normalized(slot.categoryName || slot.category || slot.name) === normalized(unit.product.category);
  };
  const assigned = new Map();
  const match = (slotIndex, seen) => {
    for (let i=0;i<units.length;i++) {
      if (seen.has(i) || !accepts(slots[slotIndex],units[i])) continue;
      seen.add(i);
      if (!assigned.has(i) || match(assigned.get(i),seen)) { assigned.set(i,slotIndex); return true; }
    }
    return false;
  };
  if (!slots.every((_,i) => match(i,new Set()))) fail(line, 'cart_offer_unavailable');
}

export function priceCheckoutLines(lines, context) {
  const { menu, references = menu, recipeProducts = menu, extras = [], uses = [], profiles = [], promos = [], incentives = [], averageTicket = 0, boostSettings, queueSize, checkRewardThreshold = true, now = new Date() } = context;
  const byId = new Map(menu.map(p => [p.id,p]));
  let rewards = 0, boosts = 0;
  const priced = lines.map(line => {
    if (!Number.isSafeInteger(Number(line.qty)) || line.qty <= 0 || line.qty > 100) fail(line, 'cart_line_invalid');
    const flags = [coupon(line),reward(line),boost(line),custom(line),half(line),promo(line)];
    if (flags.filter(Boolean).length > 1) fail(line, 'cart_line_invalid');
    if ((!reward(line) && (line.incentiveId || line.rewardPizzaId)) || (!boost(line) && line.boost)) fail(line, 'cart_line_invalid');
    const hasComponents = line.pizzaId || line.leftPizzaId || line.rightPizzaId || line.rewardPizzaId || array(line.extras).length || array(line.ingredients).length || array(line.customDetails?.ingredients).length || array(line.promoItems).length;
    if (coupon(line) || boost(line)) {
      if (hasComponents || line.qty !== 1) fail(line, 'cart_line_invalid');
      if (coupon(line)) return {...line,directDiscount:null,trendingPricing:null}; // coupon value is calculated by couponEvaluation.
      if (++boosts > 1 || !boostSettings?.active) fail(line, 'cart_offer_unavailable');
      const jumps = Number(line.boost?.positionsToJump), target = Number(line.boost?.targetPosition), current = Number(line.boost?.currentPosition);
      if (!Number.isSafeInteger(jumps) || jumps < 1 || !Number.isSafeInteger(target) || target < 1 || target > boostSettings.maxOptions || current !== queueSize || jumps !== current - target + 1) fail(line,'cart_offer_unavailable');
      const expected = money(jumps * boostSettings.unitPrice);
      if (!equalMoney(line.price,expected) || !equalMoney(line.subtotal,expected)) fail(line);
      return { ...line, source:'queue_boost', directDiscount:null, trendingPricing:null, boost:{ ...line.boost, unitPrice:boostSettings.unitPrice, amount:expected, voltaSharePercent:boostSettings.voltaSharePercent, partnerSharePercent:boostSettings.partnerSharePercent } };
    }
    if (reward(line)) {
      if (++rewards > 1 || line.qty !== 1 || array(line.extras).length || array(line.ingredients).length || array(line.customDetails?.ingredients).length) fail(line,'cart_offer_unavailable');
      const offer = incentives.find(i => i.id === Number(line.incentiveId));
      if (!offer || !offerInWindow(offer,now) || Number(line.pizzaId) !== offer.rewardPizzaId || Number(line.rewardPizzaId) !== offer.rewardPizzaId) fail(line,'cart_offer_unavailable');
      const product = byId.get(offer.rewardPizzaId);
      const value = productPrice(product,line.size,line);
      const rewardSize = product.selectSize.includes('M') ? 'M' : product.selectSize[0];
      if (line.size !== rewardSize) fail(line,'cart_offer_unavailable');
      return { ...line, type:'INCENTIVE_REWARD', source:'incentive_reward', price:-value, subtotal:0, directDiscount:null, trendingPricing:null };
    }
    if (promo(line)) {
      if (line.pizzaId || array(line.extras).length || array(line.ingredients).length || array(line.customDetails?.ingredients).length) fail(line,'cart_line_invalid');
      const offer = promos.find(p => p.id === Number(line.promoId));
      if (!offer || !offerInWindow(offer,now)) fail(line,'cart_offer_unavailable');
      validatePromoComposition(line,offer,byId);
      if (!equalMoney(line.price,offer.totalPrice) || !equalMoney(line.subtotal,Number(offer.totalPrice)*line.qty)) fail(line);
      return { ...line, type:'PROMO', source:'promo', name:offer.title, directDiscount:null, trendingPricing:null };
    }
    const product = custom(line) ? references.find(p=>p.id===Number(line.pizzaId)) : byId.get(Number(line.pizzaId));
    if (!product) fail(line,'cart_item_unavailable');
    const selected = array(line.ingredients).length ? line.ingredients : array(line.customDetails?.ingredients);
    if (!custom(line) && selected.length) fail(line,'cart_line_invalid');
    let base, directDiscount = null, ingredientTotal = 0;
    if (custom(line)) {
      const hasExplicitCustom = references.some(p=>p.categoryRef?.customizable);
      if (hasExplicitCustom ? !product.categoryRef?.customizable : !normalized(product.category).includes('pizza')) fail(line,'cart_item_unavailable');
      if (!selected.length || array(line.extras).length || (line.customMeta?.categoryId && Number(line.customMeta.categoryId) !== product.categoryId)) fail(line,'cart_line_invalid');
      const availableCategory = menu.filter(p=>categorySame(product,p));
      const category = availableCategory.length ? availableCategory : references.filter(p=>categorySame(product,p));
      const sizeProducts = category.filter(p=>array(p.selectSize).includes(line.size) && Number(p.priceBySize[line.size])>0);
      const sizePrices = sizeProducts.map(p=>Number(p.priceBySize[line.size]));
      if (!sizePrices.length) fail(line,'cart_item_unavailable');
      base = money(Math.min(...sizePrices)*0.8);
      // Browser category minima can include the advertised ±0.50 trending band.
      const floatingMinimum = sizeProducts.map(p=>Math.max(0,Number(p.priceBySize[line.size])-(p.trending?0.5:0)));
      if (Number(line.price) >= money(Math.min(...floatingMinimum)*0.8) && Number(line.price) <= money(Math.min(...sizeProducts.map(p=>Number(p.priceBySize[line.size])+(p.trending?0.5:0)))*0.8)) base=Number(line.price);
      const seen = new Set();
      for (const ingredient of selected) {
        const ingredientId = Number(ingredient.ingredientId ?? ingredient.id);
        if (seen.has(ingredientId) || !['FULL','LEFT','RIGHT'].includes(ingredient.placement) || !['SIMPLE','DOUBLE'].includes(ingredient.quantity || 'SIMPLE')) fail(line,'cart_line_invalid');
        seen.add(ingredientId);
        const use = uses.find(u=>u.ingredientId===ingredientId && u.categoryId===product.categoryId && u.active);
        const recipeIngredient = recipeProducts.filter(p=>categorySame(product,p)).flatMap(p=>p.ingredients).find(r=>r.ingredient.id===ingredientId)?.ingredient;
        if (!use && !recipeIngredient) fail(line,'cart_item_unavailable');
        const ingredientRow = use?.ingredient || recipeIngredient;
        const profile = profiles.find(p=>p.ingredientId===ingredientId);
        const cost = Number(profile?.costPrice ?? ingredientRow?.costPrice ?? use?.costPrice ?? use?.price ?? 0);
        const diameter = { XS:20, S:25, M:30, L:35, XL:40, XXL:45, ST:30 }[line.size] || 30;
        const unit = money(cost * diameter * diameter / 900);
        const price = unit * (ingredient.quantity==='DOUBLE'?2:1) * (ingredient.placement==='FULL'?1:0.5);
        if (!Number.isFinite(price) || price < 0) fail(line);
        ingredientTotal += price;
      }
    } else if (half(line)) {
      const left=byId.get(Number(line.leftPizzaId)), right=byId.get(Number(line.rightPizzaId));
      if (!left?.categoryRef?.halfAndHalf || !right?.categoryRef?.halfAndHalf || ![left.id,right.id].includes(product.id)) fail(line,'cart_item_unavailable');
      base=Math.max(productPrice(left,line.size,line),productPrice(right,line.size,line));
    } else {
      base=productPrice(product,line.size,line);
      if (product.trending && Number(line.price)>=Math.max(0,base-0.5) && Number(line.price)<=base+0.5) base=Number(line.price);
      directDiscount=product.directDiscount || null;
      if (line.directDiscount && Number(line.directDiscount.id)!==directDiscount?.id) fail(line,'cart_offer_unavailable');
      if (line.trendingPricing && !product.trending) fail(line);
    }
    const seenExtras = new Set();
    for (const extra of array(line.extras)) {
      const ingredientId=Number(extra.ingredientId ?? extra.id), side=half(line)?extra.side:'';
      if (half(line) && !['A','B'].includes(side)) fail(line,'cart_line_invalid');
      const key=`${ingredientId}:${side}`; if(seenExtras.has(key)) fail(line,'cart_line_invalid'); seenExtras.add(key);
      const sourceProduct=half(line)?byId.get(Number(side==='A'?line.leftPizzaId:line.rightPizzaId)):product;
      const row=extras.find(e=>e.ingredientId===ingredientId && e.categoryId===sourceProduct.categoryId && e.status==='ACTIVE');
      if(!row) fail(line,'cart_item_unavailable');
      const sized=Number(row.priceBySize?.[line.size]), extraPrice=sized>0?sized:Number(row.price||0);
      if(!equalMoney(extra.price,extraPrice)) fail(line);
      ingredientTotal+=extraPrice;
    }
    const total=money((base+ingredientTotal)*line.qty);
    if(!equalMoney(line.price,base)||!equalMoney(line.subtotal,total)) fail(line,'cart_price_changed',{expectedSubtotal:total});
    const trendingPricing = product.trending && !custom(line) && !half(line) ? {
      mode:'FLOATING_BAND',band:0.5,size:line.size,basePrice:Number(product.priceBySize[line.size]),chargedPrice:base,
      adjustment:money(base-Number(product.priceBySize[line.size])),adjustmentTotal:money((base-Number(product.priceBySize[line.size]))*line.qty),
      floorPrice:money(Math.max(0,Number(product.priceBySize[line.size])-0.5)),ceilingPrice:money(Number(product.priceBySize[line.size])+0.5),
    } : null;
    return {...line, categoryId:product.categoryId, category:product.category, directDiscount, trendingPricing, subtotal:total,
      ...(custom(line) ? { customDetails:{...line.customDetails, ingredients:selected} } : {})};
  });
  for(const line of checkRewardThreshold ? priced.filter(reward) : []) {
    const offer=incentives.find(i=>i.id===Number(line.incentiveId));
    const target=offer.triggerMode==='FIXED'?Number(offer.fixedAmount):money(Number(averageTicket)*(1+Number(offer.percentOverAvg||0)/100));
    const eligible=priced.filter(l=>!reward(l)&&!boost(l)&&!promo(l)&&!l.directDiscount).reduce((sum,l)=>sum+Number(l.subtotal||0),0);
    if(!(target>0)||eligible+0.005<target) fail(line,'cart_offer_unavailable');
  }
  return priced;
}

export async function validateCheckoutPricing(prisma, lines, { partner, store, activeTopDeals, checkRewards = true }) {
  const { menu, products, references } = await loadStorefrontPricing(prisma,{partner,store,activeTopDeals});
  const needsCustom=lines.some(custom), needsExtras=lines.some(l=>array(l.extras).length), needsReward=lines.some(reward);
  const [extras,uses,profiles,promos,incentives,average,boostSettings,queueSize] = await Promise.all([
    needsExtras?prisma.ingredientExtra.findMany({where:{partnerId:partner.id,status:'ACTIVE'}}):[],
    needsCustom?prisma.ingredientCategoryUse.findMany({where:{partnerId:partner.id,active:true},include:{ingredient:true}}):[],
    needsCustom?prisma.partnerIngredientProfile.findMany({where:{partnerId:partner.id}}):[],
    lines.some(promo)?prisma.promo.findMany({where:{partnerId:partner.id,status:'ACTIVE'}}):[],
    needsReward?prisma.incentive.findMany({where:{partnerId:partner.id,active:true}}):[],
    needsReward?prisma.sale.aggregate({where:{storeId:store.id,status:{not:'CANCELED'}},_avg:{total:true}}):null,
    lines.some(boost)?prisma.boostSetting.findUnique({where:{id:1}}).then(row=>normalizeBoostSettings(row || {})):null,
    lines.some(boost)?prisma.sale.count({where:{partnerId:partner.id,storeId:store.id,processed:false,status:'PAID'}}):null,
  ]);
  // Coupon evaluation replaces the client's discount before the final reward check.
  return priceCheckoutLines(lines,{menu,references,recipeProducts:products,extras,uses,profiles,promos,incentives,averageTicket:Number(average?._avg?.total||0),boostSettings,queueSize,checkRewardThreshold:checkRewards});
}
