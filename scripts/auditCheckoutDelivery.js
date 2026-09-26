import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';
import { buildOrderAvailability } from '../services/orderAvailability.js';

process.env.DATABASE_URL=validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
process.env.TELNYX_API_KEY='';process.env.STRIPE_SECRET_KEY='sk_test_audit_not_real';
process.env.GOOGLE_GEOCODING_KEY='maps_audit_not_real';
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,...args)=>{assert.equal(new URL(url).hostname,'127.0.0.1');return originalFetch(url,...args)};
const {default:axios}=await import('axios');
axios.interceptors.request.use(()=>{throw Error('External network forbidden')});
let routeKm=4.1, mapCalls=0;
axios.get=async url=>{
 assert.equal(url,'https://maps.googleapis.com/maps/api/geocode/json');mapCalls++;
 return {data:{results:[{formatted_address:'Isolated test address',types:['street_address'],geometry:{location:{lat:40.42,lng:-3.75}}}]}};
};
axios.post=async url=>{
 assert.equal(url,'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');mapCalls++;
 return {data:routeKm==null?[]:[{destinationIndex:0,condition:'ROUTE_EXISTS',distanceMeters:routeKm*1000}]}};
const {default:prisma}=await import('../services/prisma.js');
const {default:checkoutRoutes}=await import('../routes/checkout.js');
const {default:storesRoutes}=await import('../routes/stores.js');
let attemptedSale=null,mutation=null;
const rollbackPrisma=new Proxy(prisma,{get(target,key){
 if(key==='$transaction')return (callback,options)=>target.$transaction(async tx=>{
  if(mutation)await mutation(tx);
  const sale=await callback(tx);
  attemptedSale={total:Number(sale.total),delivery:sale.customerData.delivery,currency:sale.currency};
  throw Object.assign(Error('AUDIT_ROLLBACK_AFTER_SALE'),{status:418});
 },options);
 const value=target[key];return typeof value==='function'?value.bind(target):value;
}});
const app=express();app.use(express.json());app.use('/stores',storesRoutes(prisma));app.use('/checkout',checkoutRoutes(rollbackPrisma));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
const before=await captureTables(prisma);const checks=[];let complete=false,targetStore,targetPartner,deliveryCoupon;
const json=value=>value==null||typeof value==='string'?value:JSON.stringify(value);
try {
 targetStore=before.Store.find(s=>s.id===1);targetPartner=before.Partner.find(p=>p.id===targetStore.partnerId);
 await prisma.$executeRawUnsafe('UPDATE Partner SET deliveryPricingMode = ?, deliveryFeeBase = 3, deliveryBaseKm = 2, deliveryExtraPerKm = 1.25, deliveryRadiusKm = 8, deliveryFeeFixed = 2.5, minimumPaymentAmount = 0, paymentPolicySettings = ? WHERE id = ?','VARIABLE',JSON.stringify({cash:true}),targetPartner.id);
 await prisma.$executeRawUnsafe('UPDATE Store SET acceptingOrders = 1, deliveryEnabled = 1, latitude = 40.4, longitude = -3.7 WHERE id = ?',targetStore.id);
 const liveStore=await prisma.store.findUnique({where:{id:targetStore.id},include:{hours:true}});
 const availability=buildOrderAvailability(liveStore);
 const scheduledFor=availability.requiresSchedule?availability.days.flatMap(d=>d.slots)[0]?.scheduledFor:undefined;
 assert.ok(!availability.requiresSchedule||scheduledFor);
 const menu=await(await fetch(`${base}/stores/${targetPartner.slug}/${targetStore.slug}/menu`)).json();
 const pizza=menu.menu.find(p=>p.selectSize.includes('M'));
 const price=Number(pizza.priceBySize.M);
 const customer=before.Customer.find(c=>c.partnerId===targetPartner.id);
 const cart=[{pizzaId:pizza.pizzaId,size:'M',qty:1,price,subtotal:price}];
 deliveryCoupon=await prisma.coupon.create({data:{partnerId:targetPartner.id,code:'AUDIT-DELIVERY-'+Date.now(),kind:'AMOUNT',variant:'FIXED',amount:0,campaign:'DELIVERY_FREE',usageUnlimited:true}});
 const baseDelivery={method:'COURIER',address:'Isolated test address',lat:0,lng:0,distanceKm:0,deliveryFee:6.75};
 const cases=[
  {name:'valid_server_route',delivery:baseDelivery,accepted:true,fee:6.75},
  {name:'forged_zero_fee',delivery:{...baseDelivery,deliveryFee:0},error:'delivery_price_changed'},
  {name:'forged_short_distance',delivery:{...baseDelivery,deliveryFee:3,distanceKm:0},error:'delivery_price_changed'},
  {name:'kilometer_boundary',km:3.001,delivery:{...baseDelivery,deliveryFee:4.25},error:'delivery_price_changed'},
  {name:'outside_radius',km:8.001,delivery:baseDelivery,error:'delivery_outside_area'},
  {name:'manual_review_notice',km:null,delivery:{...baseDelivery,deliveryFee:3},error:'delivery_price_changed'},
  {name:'manual_review_accepted',km:null,delivery:{...baseDelivery,deliveryFee:3,manualReviewAccepted:true},accepted:true,fee:3,manual:true},
  {name:'manual_forged_fee',km:null,delivery:{...baseDelivery,deliveryFee:0,manualReviewAccepted:true},error:'delivery_price_changed'},
  {name:'missing_address',delivery:{...baseDelivery,address:''},error:'delivery_address_required'},
  {name:'policy_changes_before_sale',delivery:baseDelivery,error:'delivery_policy_changed',mutate:tx=>tx.partner.update({where:{id:targetPartner.id},data:{deliveryFeeBase:4}})},
  {name:'store_disables_delivery',delivery:baseDelivery,error:'delivery_method_not_allowed',mutate:tx=>tx.store.update({where:{id:targetStore.id},data:{deliveryEnabled:false}})},
  {name:'fixed_control',fixed:true,delivery:{...baseDelivery,deliveryFee:2.5},accepted:true,fee:2.5,noMaps:true},
  {name:'pickup_control',delivery:{method:'PICKUP'},accepted:true,fee:0,noMaps:true},
  {name:'free_delivery_exceeds_products',km:7.1,delivery:{...baseDelivery,deliveryFee:10.5},accepted:true,fee:10.5,freeDelivery:true},
 ];
 for(const entry of cases) {
  await prisma.$executeRawUnsafe('UPDATE Partner SET deliveryPricingMode = ? WHERE id = ?',entry.fixed?'FIXED':'VARIABLE',targetPartner.id);
  for(const paymentMode of ['cash','card']) {
   routeKm=Object.hasOwn(entry,'km')?entry.km:4.1;mapCalls=0;attemptedSale=null;mutation=entry.mutate||null;
   const requestCart=entry.freeDelivery?[...cart,{type:'COUPON',source:'coupon',couponCode:deliveryCoupon.code,qty:1,price:-10.5,subtotal:-10.5}]:cart;
   const response=await fetch(`${base}/checkout/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partnerId:targetPartner.id,storeId:targetStore.id,paymentMode,customer:{id:customer.id},scheduledFor,cart:requestCart,delivery:entry.delivery})});
   const body=await response.json();
   if(entry.accepted){
    assert.equal(response.status,418,JSON.stringify(body));assert.ok(attemptedSale);
    assert.equal(attemptedSale.total,Math.round((price+(entry.freeDelivery?0:entry.fee))*100)/100);
    assert.equal(attemptedSale.delivery.deliveryFee,entry.fee);
    assert.equal(attemptedSale.delivery.manualReviewRequired,entry.manual===true);
    if(entry.name==='valid_server_route') {assert.equal(attemptedSale.delivery.distanceKm,4.1);assert.equal(attemptedSale.delivery.lat,40.42)}
   }else{assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,entry.error);assert.equal(attemptedSale,null)}
   if(entry.noMaps)assert.equal(mapCalls,0);
   checks.push({name:entry.name,paymentMode,status:response.status,error:body.error,acceptedAndRolledBack:Boolean(attemptedSale),quotedFee:body.deliveryQuote?.deliveryFee,chargedFee:attemptedSale?.delivery.deliveryFee,mapCalls,manualReview:attemptedSale?.delivery.manualReviewRequired});
  }
 }
 complete=true;
}finally{
 if(deliveryCoupon)await prisma.coupon.delete({where:{id:deliveryCoupon.id}});
 if(targetPartner)await prisma.$executeRawUnsafe('UPDATE Partner SET deliveryPricingMode = ?, deliveryFeeBase = ?, deliveryBaseKm = ?, deliveryExtraPerKm = ?, deliveryRadiusKm = ?, deliveryFeeFixed = ?, minimumPaymentAmount = ?, paymentPolicySettings = ? WHERE id = ?',targetPartner.deliveryPricingMode,targetPartner.deliveryFeeBase,targetPartner.deliveryBaseKm,targetPartner.deliveryExtraPerKm,targetPartner.deliveryRadiusKm,targetPartner.deliveryFeeFixed,targetPartner.minimumPaymentAmount,json(targetPartner.paymentPolicySettings),targetPartner.id);
 if(targetStore)await prisma.$executeRawUnsafe('UPDATE Store SET acceptingOrders = ?, deliveryEnabled = ?, latitude = ?, longitude = ? WHERE id = ?',targetStore.acceptingOrders,targetStore.deliveryEnabled,targetStore.latitude,targetStore.longitude,targetStore.id);
 assert.deepEqual(tableDigests(await captureTables(prisma)),tableDigests(before));
 const report={verifiedAt:new Date().toISOString(),environment:'isolated_loopback_copy',complete,checks,allTablesRestored:Object.keys(before).length,externalMapsCalls:false,paymentsOrMessagesSent:false};
 fs.writeFileSync(new URL('../docs/checkout-delivery-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({complete,checks:checks.length,tablesRestored:Object.keys(before).length}));
 await new Promise(r=>server.close(r));await prisma.$disconnect();
}
