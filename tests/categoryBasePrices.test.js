import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import partnerCategoriesRoutes from '../routes/partnerCategories.js';
import { validateCategoryBasePrices } from '../services/categoryBasePrices.js';
import { loadStoreMenuProducts } from '../services/storeMenuProducts.js';
import { authorizeBackoffice } from '../services/webAccess.js';

test('base prices validate currency precision and only known available sizes', () => {
  assert.deepEqual(validateCategoryBasePrices({M:8.99},['M']),{M:8.99});
  assert.deepEqual(validateCategoryBasePrices({},['M']),{});
  for (const value of [{M:0},{M:-1},{M:'8.99'},{M:true},{M:NaN},{M:Infinity},{M:1.001},{M:10001},{XL:9},[],null]) {
    assert.throws(()=>validateCategoryBasePrices(value,['M']),error=>error.status===400);
  }
});

test('category price saves are partner scoped, preserve global flags and do not fake success', async t => {
  let customizable = true, fail = false, saved;
  const rows = [];
  const db = {
    partner: {findUnique: async ({where})=>({id:where.id,slug:'example'})},
    category: {findUnique:async()=>({id:3,customizable,halfAndHalf:true,position:2})},
    menuPizza: {findMany:async ({where})=>{assert.deepEqual(where,{partnerId:7,categoryId:3,type:'SELLABLE'});return [{selectSize:['M','L']}];}},
    partnerCategory: {upsert:async operation=>{if(fail) throw new Error('database unavailable');saved=operation;rows.push(operation);return {...operation.update};}},
  };
  const app=express();app.use(express.json());app.use(partnerCategoriesRoutes(db));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}/partners/7/categories/3`;
  const patch=body=>fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let response=await patch({customBasePrices:{M:8.25,L:10.5}});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).customBasePrices,{M:8.25,L:10.5});
  assert.deepEqual(saved.where,{partnerId_categoryId:{partnerId:7,categoryId:3}});
  assert.deepEqual(saved.update,{customBasePrices:{M:8.25,L:10.5}});
  assert.equal((await patch({customBasePrices:{M:8},customizable:true})).status,400);
  assert.equal((await patch({customBasePrices:{XXL:8}})).status,400);
  customizable=false;assert.equal((await patch({customBasePrices:{M:8}})).status,409);
  customizable=true;fail=true;assert.equal((await patch({customBasePrices:{M:8}})).status,500);
  assert.equal(rows.length,1);
});

test('backoffice category endpoint rejects another business', async () => {
  const req={method:'PATCH',webSession:{role:'backoffice',partnerId:7},body:{customBasePrices:{M:9}},query:{},is:()=>false};
  await authorizeBackoffice({},req,'/partners/7/categories/3');
  await assert.rejects(()=>authorizeBackoffice({},req,'/partners/8/categories/3'),error=>error.status===403);
});

test('menu product loader reads base prices from the partner category, independently of product price', async () => {
  const products=await loadStoreMenuProducts({$queryRawUnsafe:async (sql,...params)=>{
    assert.match(sql,/pc.partnerId = p.partnerId/);assert.deepEqual(params,[2,2,7]);
    return [{id:1,name:'Offer',category:'Pizza',categoryId:3,selectSize:'["M"]',priceBySize:'{"M":4.94}',customBasePrices:'{"M":8.25}',customizable:1,halfAndHalf:1,productActive:1}];
  }},7,2);
  assert.deepEqual(products[0].categoryBasePriceBySize,{M:8.25});
  assert.equal(products[0].categoryRef.customizable,true);
});
