import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOrderMinimum, getDeliveryBlocks, getShippingBenefitFee } from '../services/fulfillmentPolicy.js';
import { priceCheckoutLines } from '../services/checkoutPricing.js';
import { validateCheckoutDelivery } from '../services/checkoutDelivery.js';
import { calculateCouponDiscount, getEligibleCouponSubtotal, validateTopDealAvailability } from '../routes/checkout.js';

const normal = (subtotal, qty = 1) => ({ qty, subtotal, deliveryUnits: 1 });
const clearance = (subtotal = 5, qty = 1) => ({ ...normal(subtotal, qty), directDiscount: { id: 8, isClearance: true } });
const discount = subtotal => ({ type: 'COUPON', qty: 1, subtotal });
const partner = { deliveryPricingMode: 'FIXED', deliveryFeeBlockSize: 5, deliveryFeeFixed: 2.5 };

test('pickup exemption includes mixed carts and disappears with the last clearance', () => {
  for (const cart of [[clearance()], [clearance(), normal(3)]]) {
    assert.equal(getOrderMinimum(cart, 'PICKUP', 9.99).met, true);
    assert.equal(getOrderMinimum(cart, 'COURIER', 9.99).met, false);
  }
  assert.equal(getOrderMinimum([normal(3)], 'PICKUP', 9.99).missingAmount, 6.99);
  assert.equal(getOrderMinimum([clearance()], 'COURIER', 9.99).missingAmount, 4.99);
  assert.equal(getOrderMinimum([clearance(9.99)], 'COURIER', 9.99).met, true);
});

test('delivery minimum uses discounted products, excluding queue fees, rewards and shipping discounts', () => {
  assert.equal(getOrderMinimum([normal(10), discount(-1)], 'COURIER', 9.99).missingAmount, .99);
  const fees = [{ type: 'QUEUE_BOOST', subtotal: 3 }, { type: 'INCENTIVE_REWARD', subtotal: -8 }];
  assert.equal(getOrderMinimum([normal(8), ...fees], 'COURIER', 9.99).missingAmount, 1.99);
  assert.equal(getOrderMinimum([normal(9.99), discount(-2.5)], 'COURIER', 9.99, 2.5).met, true);
  assert.equal(getOrderMinimum([normal(20), clearance(), discount(-18)], 'COURIER', 9.99).missingAmount, 2.99);
});

test('clearance cannot receive product coupons or help reach their threshold', () => {
  const lines = [normal(20), clearance()];
  assert.equal(getEligibleCouponSubtotal(lines), 20);
  assert.equal(calculateCouponDiscount({ kind: 'PERCENT', percent: 50 }, getEligibleCouponSubtotal(lines)), 10);
  assert.equal(calculateCouponDiscount({ kind: 'AMOUNT', amount: 100 }, getEligibleCouponSubtotal(lines)), 20);
});

test('fixed shipping counts physical pizzas and preserves only independently covered blocks', async () => {
  for (const [regular, liquidated, blocks, free] of [[5,1,2,2.5],[4,1,1,2.5],[5,6,3,2.5],[6,1,2,5],[0,6,2,0],[15,0,3,7.5]]) {
    const lines = [...(regular ? [normal(regular * 10, regular)] : []), ...(liquidated ? [clearance(liquidated * 5, liquidated)] : [])];
    assert.equal(getDeliveryBlocks(lines, 5).totalBlocks, blocks);
    const quote = await validateCheckoutDelivery(partner, {}, { method:'COURIER', address:'Example 1', deliveryFee:blocks * 2.5, lines });
    assert.equal(quote.deliveryFee, blocks * 2.5);
    assert.equal(getShippingBenefitFee(lines, partner, quote.deliveryFee), free);
  }
  assert.equal(getDeliveryBlocks([normal(30,3)], 2).totalBlocks, 2);
  assert.equal(getDeliveryBlocks([{ ...normal(10,20), deliveryUnits:0 }], 5).totalBlocks, 1);
  await assert.rejects(validateCheckoutDelivery(partner, {}, { method:'COURIER', address:'Example 1', deliveryFee:2.5, lines:[normal(60,6)] }), error => error.message === 'delivery_price_changed' && error.details.deliveryQuote.deliveryFee === 5);
});

const dish = (id, price, extra = {}) => ({ id, category:'Pizzas', selectSize:['M'], priceBySize:{M:price}, categoryRef:{halfAndHalf:true}, ingredients:[], ...extra });
const saleLine = (pizzaId, price, extra = {}) => ({ pizzaId, size:'M', qty:1, price, subtotal:price, ...extra });
test('pricing derives clearance and capacity from the catalog, rejecting stale and forged flags', () => {
  const menu = [dish(1,5,{directDiscount:{id:8,isClearance:true}}),dish(2,10)];
  const priced = priceCheckoutLines([saleLine(1,5,{deliveryUnits:0})], {menu});
  assert.equal(priced[0].directDiscount.isClearance, true);
  assert.equal(priced[0].deliveryUnits, 1);
  for (const line of [saleLine(2,10,{directDiscount:{id:8,isClearance:true}}),saleLine(1,5,{directDiscount:{id:8,isClearance:false}})]) {
    assert.throws(() => priceCheckoutLines([line],{menu}), /cart_offer_unavailable/);
  }
  const stale = saleLine(1,5,{directDiscount:{id:8,isClearance:true}});
  assert.throws(() => priceCheckoutLines([stale],{menu:[dish(1,5)]}), /cart_offer_unavailable/);
  assert.equal(priceCheckoutLines([saleLine(2,10,{isClearance:true,deliveryUnits:0})],{menu})[0].directDiscount, null);
});

test('fixed-price packs coexist with standalone clearance without stacking its price or exemption', () => {
  const menu=[dish(1,5,{directDiscount:{id:8,isClearance:true}}),dish(2,10)];
  assert.throws(() => priceCheckoutLines([saleLine(1,10,{type:'HALF_HALF',leftPizzaId:1,rightPizzaId:2})],{menu}), /cart_offer_unavailable/);
  const promos=[{id:4,status:'ACTIVE',totalPrice:6,items:[{pizzaId:1,size:'M',quantity:1}]}];
  const promo={type:'PROMO',promoId:4,qty:1,price:6,subtotal:6,promoItems:[{pizzaId:1,size:'M',quantity:1}]};
  const priced = priceCheckoutLines([{...promo,directDiscount:{id:8,isClearance:true}}],{menu,promos});
  assert.equal(priced[0].price,6);
  assert.equal(priced[0].subtotal,6);
  assert.equal(priced[0].directDiscount,null);
  assert.equal(priced[0].deliveryUnits,1);
  assert.equal(getOrderMinimum(priced,'PICKUP',9.99).met,false);
  assert.throws(() => priceCheckoutLines([{...promo,price:5,subtotal:5}],{menu,promos}), /cart_price_changed/);
  const choicePromos=[{...promos[0],items:[{type:'CHOICE',choiceType:'PRODUCTS',optionProductIds:[1],size:'M',quantity:1}]}];
  assert.equal(priceCheckoutLines([promo],{menu,promos:choicePromos})[0].price,6);
});

test('adding clearance preserves an earned reward, without contributing to it', () => {
  const menu=[dish(1,5,{directDiscount:{id:8,isClearance:true}}),dish(2,10),dish(3,3)];
  const incentives=[{id:9,active:true,triggerMode:'FIXED',fixedAmount:10,rewardPizzaId:3}];
  const reward=saleLine(3,-3,{type:'INCENTIVE_REWARD',incentiveId:9,rewardPizzaId:3,subtotal:0});
  const lines=[saleLine(1,5),saleLine(2,10),reward,{...discount(-2.5),price:-2.5,coupon:{campaign:'DELIVERY_FREE'}}];
  assert.equal(priceCheckoutLines(lines,{menu,incentives})[2].subtotal,0);
  assert.throws(() => priceCheckoutLines([saleLine(1,5),reward],{menu,incentives}), /cart_offer_unavailable/);
});

test('clearance still obeys shared Top Deal stock limits', () => {
  const deal={id:8,isClearance:true,status:'ACTIVE',targetType:'PRODUCT',productIds:[1],storeIds:[3],usageLimit:1,usedCount:0};
  const line=saleLine(1,5,{cartLineId:'one',directDiscount:{id:8,isClearance:true}});
  assert.equal(validateTopDealAvailability([line],{activeTopDeals:[deal],storeId:3}),null);
  assert.equal(validateTopDealAvailability([{...line,qty:2,subtotal:10}],{activeTopDeals:[deal],storeId:3}).error,'top_deal_quantity_unavailable');
  assert.equal(validateTopDealAvailability([line],{activeTopDeals:[],storeId:3}).error,'top_deal_not_available');
});
