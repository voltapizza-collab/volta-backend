import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceCheckoutLines, offerInWindow } from '../services/checkoutPricing.js';

const product = (id, price, categoryId=1) => ({id,name:`Dish ${id}`,categoryId,category:categoryId===1?'Pizzas':'Bebidas',selectSize:['M','XL'],priceBySize:{M:price,XL:price+4},categoryRef:{customizable:categoryId===1,halfAndHalf:categoryId===1},ingredients:[]});
const menu = [product(1,10),product(2,14),product(3,3,2)];
const line = {cartLineId:'dish',pizzaId:1,size:'M',qty:1,price:10,subtotal:10};
const quote = (lines,context={}) => priceCheckoutLines(lines,{menu,...context});
const rejects = (lines,context={},code='cart_price_changed') => assert.throws(()=>quote(lines,context),e=>e.status===409&&e.message===code);

test('normal prices and quantity come from the menu, and category metadata is canonical',()=>{
  assert.equal(quote([{...line,qty:2,subtotal:20,categoryId:999}])[0].categoryId,1);
  rejects([{...line,price:0.5,subtotal:0.5}]);
  rejects([{...line,subtotal:0.5}]);
  rejects([{...line,qty:1.5}],{},'cart_line_invalid');
  rejects([{...line,incentiveId:4}],{},'cart_line_invalid');
});
test('extras are priced by category and size, duplicates and unregistered extras are rejected',()=>{
  const extras=[{ingredientId:7,categoryId:1,status:'ACTIVE',price:1,priceBySize:{M:2}}];
  const withExtra={...line,extras:[{ingredientId:7,price:2}],subtotal:12};
  assert.equal(quote([withExtra],{extras})[0].subtotal,12);
  rejects([{...withExtra,extras:[{ingredientId:7,price:0}]}],{extras});
  rejects([withExtra],{},'cart_item_unavailable');
  rejects([{...withExtra,extras:[...withExtra.extras,...withExtra.extras]}],{extras},'cart_line_invalid');
});
test('halves use the higher price, and charge extras once on each requested half',()=>{
  const half={...line,type:'HALF_HALF',leftPizzaId:1,rightPizzaId:2,price:14,subtotal:14};
  assert.equal(quote([half])[0].subtotal,14);
  rejects([{...half,price:10,subtotal:10}]);
  const extras=[{ingredientId:7,categoryId:1,status:'ACTIVE',price:2}];
  assert.equal(quote([{...half,subtotal:18,extras:[{ingredientId:7,side:'A',price:2},{ingredientId:7,side:'B',price:2}]}],{extras})[0].subtotal,18);
  rejects([{...half,rightPizzaId:3}],{},'cart_item_unavailable');
});
test('custom recipe uses category minimum, partner cost, size and placement',()=>{
  const selected={ingredientId:7,quantity:'DOUBLE',placement:'LEFT'};
  const custom={...line,type:'CUSTOM_BUILD',price:8,subtotal:10,ingredients:[selected]};
  const uses=[{ingredientId:7,categoryId:1,active:true,ingredient:{costPrice:5}}];
  const profiles=[{ingredientId:7,costPrice:2}];
  assert.equal(quote([custom],{uses,profiles})[0].subtotal,10);
  rejects([{...custom,subtotal:8}],{uses,profiles});
  assert.equal(quote([{...custom,size:'XL',price:11.2,subtotal:14.76}],{uses,profiles})[0].subtotal,14.76);
  rejects([{...custom,ingredients:[selected,selected]}],{uses,profiles},'cart_line_invalid');
});
test('trending prices stay within the advertised band and cannot forge another discount',()=>{
  const trending=menu.map(p=>({...p,trending:p.id===1}));
  assert.equal(quote([{...line,price:9.5,subtotal:9.5}],{menu:trending})[0].subtotal,9.5);
  rejects([{...line,price:9.49,subtotal:9.49}],{menu:trending});
  rejects([{...line,directDiscount:{id:99}}],{menu:trending},'cart_offer_unavailable');
});
test('custom builds do not inherit disabled ingredients from their sample dish',()=>{
  const references=[product(1,10),product(2,10)];
  const uses=[{ingredientId:7,categoryId:1,active:true,ingredient:{costPrice:2}}];
  const custom={...line,type:'CUSTOM_BUILD',price:8,subtotal:10,ingredients:[{ingredientId:7,quantity:'SIMPLE',placement:'FULL'}]};
  assert.equal(quote([custom],{menu:[references[1]],references,uses})[0].subtotal,10);
});
test('promotions validate both price and choice composition against server records',()=>{
  const promo={id:8,status:'ACTIVE',totalPrice:12,title:'Combo',items:[{type:'CHOICE',categoryId:1,size:'M',quantity:1},{pizzaId:3,size:'M',quantity:1}]};
  const cart={cartLineId:'promo',type:'PROMO',promoId:8,qty:1,price:12,subtotal:12,promoItems:[{pizzaId:2,size:'M',quantity:1},{pizzaId:3,size:'M',quantity:1}]};
  assert.equal(quote([cart],{promos:[promo]})[0].name,'Combo');
  rejects([cart],{},'cart_offer_unavailable');
  rejects([{...cart,price:1,subtotal:1}],{promos:[promo]});
  rejects([{...cart,promoItems:[{pizzaId:2,size:'M',quantity:2}]}],{promos:[promo]},'cart_offer_unavailable');
  rejects([cart],{promos:[{...promo,expiresAt:'2020-01-01'}]},'cart_offer_unavailable');
});
test('overlapping promo groups require a complete matching rather than greedy allocation',()=>{
  const promos=[{id:9,totalPrice:20,items:[{type:'CHOICE',optionProductIds:[1,2],size:'M'},{type:'CHOICE',optionProductIds:[1],size:'M'}]}];
  const cart={type:'PROMO',promoId:9,qty:1,price:20,subtotal:20,promoItems:[{pizzaId:1,size:'M'},{pizzaId:2,size:'M'}]};
  assert.equal(quote([cart],{promos})[0].subtotal,20);
});
test('reward requires active incentive, eligible spend, correct item and designated size',()=>{
  const incentives=[{id:9,active:true,triggerMode:'FIXED',fixedAmount:10,rewardPizzaId:3}];
  const reward={type:'INCENTIVE_REWARD',incentiveId:9,pizzaId:3,rewardPizzaId:3,size:'M',qty:1,price:-3,subtotal:0};
  assert.equal(quote([line,reward],{incentives})[1].subtotal,0);
  rejects([reward],{incentives},'cart_offer_unavailable');
  rejects([line,reward],{},'cart_offer_unavailable');
  rejects([line,{...reward,size:'XL'}],{incentives},'cart_offer_unavailable');
  rejects([line,reward,{type:'COUPON',qty:1,price:-1,subtotal:-1}],{incentives},'cart_offer_unavailable');
  const discounted=menu.map(p=>p.id===1?{...p,directDiscount:{id:10}}:p);
  rejects([line,reward],{menu:discounted,incentives},'cart_offer_unavailable');
});
test('boost cannot forge queue credit, price or revenue shares',()=>{
  const boostSettings={active:true,unitPrice:0.5,maxOptions:3,voltaSharePercent:25,partnerSharePercent:75};
  const boost={type:'QUEUE_BOOST',qty:1,price:2,subtotal:2,boost:{currentPosition:5,targetPosition:2,positionsToJump:4,voltaSharePercent:0}};
  assert.equal(quote([line,boost],{boostSettings,queueSize:5})[1].boost.voltaSharePercent,25);
  rejects([line,boost],{boostSettings,queueSize:6},'cart_offer_unavailable');
  rejects([line,{...boost,price:0.5,subtotal:0.5}],{boostSettings,queueSize:5});
});
test('offer windows cover weekdays and overnight hours',()=>{
  const now=new Date('2026-09-18T22:30:00Z'); // Saturday 00:30 in Madrid
  assert.equal(offerInWindow({daysActive:[6],windowStart:1320,windowEnd:120},now),true);
  assert.equal(offerInWindow({daysActive:[5],windowStart:1320,windowEnd:120},now),false);
  assert.equal(offerInWindow({active:false},now),false);
});
