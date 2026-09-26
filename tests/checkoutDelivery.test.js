import assert from 'node:assert/strict';
import {test} from 'node:test';
import axios from 'axios';
import {resolveCheckoutDelivery,calculateDeliveryFee,validateCheckoutDelivery} from '../services/checkoutDelivery.js';
import {formatSale} from '../routes/myorders.js';
import {computeDrivingDistances} from '../services/deliveryGeography.js';

const partner={id:7,country:'ES',deliveryPricingMode:'VARIABLE',deliveryFeeBase:3,deliveryBaseKm:2,deliveryExtraPerKm:1.25,deliveryRadiusKm:8};
const store={id:3,latitude:40.4,longitude:-3.7,city:'Madrid'};
const delivery={method:'COURIER',address:'Calle de prueba 1',distanceKm:0,deliveryFee:0,lat:store.latitude,lng:store.longitude};
const deps={getKey:()=> 'test-not-real',geocode:async()=>({lat:40.42,lng:-3.75,types:['street_address'],partialMatch:false,formattedAddress:'Dirección verificada'}),route:async()=>[{id:3,distanciaKm:4.1}]};
test('server route determines the variable fee, ignoring forged distance, coordinates and fee',async()=>{
 const quote=await resolveCheckoutDelivery(partner,store,delivery,{...deps,route:async(origin)=>{
  assert.deepEqual(origin,{lat:40.42,lng:-3.75});return [{id:3,distanciaKm:4.1}];
 }});
 assert.equal(quote.deliveryFee,6.75);assert.equal(quote.distanceKm,4.1);assert.equal(quote.resolved,true);
});
test('full route precision is retained across kilometer billing boundaries',async()=>{
 const quote=await resolveCheckoutDelivery(partner,store,delivery,{...deps,route:async()=>[{id:3,distanciaKm:3.001}]});
 assert.equal(quote.deliveryFee,5.5);assert.equal(quote.distanceKm,3.001);
 assert.equal(calculateDeliveryFee(partner,3),4.25);
});
test('pickup and fixed delivery do not require a maps request',async()=>{
 const noMaps={getKey:()=>{throw Error('unexpected lookup')}};
 assert.equal((await resolveCheckoutDelivery(partner,store,{method:'PICKUP'},noMaps)).deliveryFee,0);
 assert.equal((await resolveCheckoutDelivery({...partner,deliveryPricingMode:'FIXED',deliveryFeeFixed:2.5},store,delivery,noMaps)).deliveryFee,2.5);
});
test('unverifiable addresses and routes return explicit unresolved facts, not a client fee',async()=>{
 const variants=[
  [{...deps,getKey:()=>''},'GEOCODING_NOT_CONFIGURED'],
  [{...deps,geocode:async()=>null},'ADDRESS_NOT_VERIFIED'],
  [{...deps,geocode:async()=>({lat:40,lng:0,types:['route']})},'ADDRESS_NOT_VERIFIED'],
  [{...deps,route:async()=>null},'ROUTE_UNAVAILABLE'],
  [{...deps,route:async()=>[{id:99,distanciaKm:1}]},'ROUTE_UNAVAILABLE'],
  [{...deps,route:async()=>[{id:3,distanciaKm:null}]},'ROUTE_UNAVAILABLE'],
  [{...deps,route:async()=>[{id:3,distanciaKm:-1}]},'ROUTE_UNAVAILABLE'],
  [{...deps,geocode:async()=>{throw Error('timeout')}},'DELIVERY_PROVIDER_UNAVAILABLE'],
 ];
 for(const [dependencies,reason] of variants) assert.deepEqual(await resolveCheckoutDelivery(partner,store,delivery,dependencies),{resolved:false,reason});
});
test('coverage is checked against the store actually receiving the order',async()=>{
 assert.deepEqual(await resolveCheckoutDelivery(partner,store,delivery,{...deps,route:async()=>[{id:3,distanciaKm:8.001}]}),{resolved:false,reason:'OUTSIDE_DELIVERY_AREA'});
 assert.equal((await resolveCheckoutDelivery(partner,store,delivery,{...deps,route:async()=>[{id:3,distanciaKm:8}]})).resolved,true);
 assert.equal((await resolveCheckoutDelivery(partner,{...store,latitude:null},delivery,deps)).reason,'STORE_COORDINATES_UNAVAILABLE');
});
test('route matrix rejects explicit failures even when distance or status are misleading',async t=>{
 const original=axios.post;t.after(()=>{axios.post=original});
 for(const row of [
  {condition:'ROUTE_NOT_FOUND',distanceMeters:0},
  {condition:'ROUTE_NOT_FOUND',status:{code:0},distanceMeters:0},
  {condition:'ROUTE_EXISTS',status:{code:7},distanceMeters:1000},
  {condition:'ROUTE_EXISTS',distanceMeters:null},
 ]) {
  axios.post=async()=>({data:[{destinationIndex:0,...row}]});
  assert.equal(await computeDrivingDistances({lat:40,lng:0},[store],'test'),null);
 }
 axios.post=async()=>({data:[{destinationIndex:0,condition:'ROUTE_EXISTS',distanceMeters:3100}]});
 assert.equal((await computeDrivingDistances({lat:40,lng:0},[store],'test'))[0].distanciaKm,3.1);
});
test('a different delivery fee requires confirmation before checkout continues',async()=>{
 await assert.rejects(validateCheckoutDelivery(partner,store,delivery,deps),error=>error.status===409&&error.message==='delivery_price_changed'&&error.details.deliveryQuote.deliveryFee===6.75);
 const result=await validateCheckoutDelivery(partner,store,{...delivery,deliveryFee:6.75},deps);
 assert.equal(result.distanceKm,4.1);
});
test('manual fallback preserves server base, requires customer notice, and reaches POS formatting',async()=>{
 const missing={...deps,route:async()=>null};
 await assert.rejects(validateCheckoutDelivery(partner,store,{...delivery,deliveryFee:3},missing),error=>error.details.deliveryQuote.manualReviewRequired===true);
 await assert.rejects(validateCheckoutDelivery(partner,store,{...delivery,deliveryFee:0,manualReviewAccepted:true},missing),/delivery_price_changed/);
 const quote=await validateCheckoutDelivery(partner,store,{...delivery,deliveryFee:3,manualReviewAccepted:true},missing);
 assert.equal(quote.deliveryFee,3);assert.equal(quote.manualReviewRequired,true);assert.equal(quote.distanceKm,null);
 assert.equal(formatSale({customerData:{delivery:{manualReviewRequired:true}}}).deliveryReviewRequired,true);
 assert.equal(formatSale({customerData:{}}).deliveryReviewRequired,false);
 await assert.rejects(validateCheckoutDelivery(partner,store,{...delivery,manualReviewAccepted:true},{...deps,route:async()=>[{id:3,distanciaKm:9}]}),/delivery_outside_area/);
 await assert.rejects(validateCheckoutDelivery(partner,store,{...delivery,address:''},missing),/delivery_address_required/);
});
