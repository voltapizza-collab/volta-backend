import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { snapshotPackages, applyFoodConfiguration, foodAssignmentPreview, categoryAllowed } from '../services/foodPackages.js';
import foodPackagesRoutes from '../routes/foodPackages.js';
import partnerCategoriesRoutes from '../routes/partnerCategories.js';
import { loadStoreMenuProducts } from '../services/storeMenuProducts.js';
import { priceCheckoutLines } from '../services/checkoutPricing.js';
import { authorizeBackoffice, isPublicWebRoute } from '../services/webAccess.js';

function database() {
  const categories = [
    { id: 1, name: 'Artesanas', customizable: true, builderType: 'PIZZA', halfAndHalf: true, position: 0 },
    { id: 2, name: 'Hamburguesas', customizable: false, builderType: 'NONE', halfAndHalf: false, position: 1 },
    { id: 3, name: 'Kebab', customizable: false, builderType: 'NONE', halfAndHalf: false, position: 2 },
    { id: 4, name: 'Bebidas', customizable: false, builderType: 'NONE', halfAndHalf: false, position: 3 },
  ];
  const packages = [[1, 'Pizza', [1,4]], [2, 'Burger', [2,4]], [3, 'Kebab', [3,4]]].map(([id,name,categoryIds]) => ({ id,name,categoryIds,active:true,updatedAt:new Date('2026-10-24T12:00:00Z') }));
  const partner = { id: 7, slug: 'test', foodConfiguration: null };
  const links = []; const changes = [];
  const db = { categories, packages, partnerRow: partner, links, changes,
    $transaction: async fn => fn(db), $queryRaw: async () => [],
    foodPackage: { findMany: async ({ where } = {}) => packages.filter(p => (!where?.id || where.id.in.includes(p.id)) && (where?.active === undefined || p.active === where.active)) },
    category: { findMany: async ({ where } = {}) => categories.filter(c => !where?.id || where.id.in.includes(c.id)), findUnique: async ({where}) => categories.find(c => c.id === where.id) },
    partner: { findUnique: async () => structuredClone(partner), update: async ({data}) => Object.assign(partner, structuredClone(data)) },
    partnerCategory: {
      findMany: async () => links.map(link => ({ ...link, category: categories.find(c => c.id === link.categoryId) })),
      upsert: async ({ where, create, update }) => { const existing=links.find(l => l.categoryId === where.partnerId_categoryId.categoryId); if(existing) return Object.assign(existing,update); links.push(structuredClone(create)); return create; },
      createMany: async ({data}) => { links.push(...data); },
    },
    foodConfigurationChange: { create: async ({data}) => changes.push(data) },
  };
  return db;
}
async function serve(t, router, role = 'global_admin') {
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.webSession={role};next();});app.use(router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return (path,body) => fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

test('burger + kebab combines categories, excludes pizza, and shared drinks survive package removal', async () => {
  const db=database(); const config=await snapshotPackages(db,[2,3]);
  const preview=await foodAssignmentPreview(db,db.partnerRow,config);
  assert.deepEqual(preview.enabled.map(c=>c.id),[2,3,4]);assert.deepEqual(preview.disabled.map(c=>c.id),[1]);
  assert.deepEqual(preview.features,{pizzaBuilder:false,halfAndHalf:false});
  await applyFoodConfiguration(db,db.partnerRow,config);
  assert.equal(db.links.find(l=>l.categoryId===1).enabled,false);
  const drinks=db.links.find(l=>l.categoryId===4);drinks.enabled=false;drinks.customBasePrices={M:3};
  await applyFoodConfiguration(db,db.partnerRow,await snapshotPackages(db,[3],db.partnerRow.foodConfiguration));
  assert.equal(drinks.enabled,false);assert.deepEqual(drinks.customBasePrices,{M:3});
  assert.equal(categoryAllowed(db.partnerRow,4),true);assert.equal(categoryAllowed(db.partnerRow,2),false);
  assert.equal(db.changes.length,2);assert.equal(db.changes[1].actor,'global_admin');
});

test('legacy businesses retain access until explicitly assigned; mixed packages support renamed pizza categories', async () => {
  const db=database();assert.equal(categoryAllowed(db.partnerRow,999),true);
  const config=await snapshotPackages(db,[1,2]);const preview=await foodAssignmentPreview(db,db.partnerRow,config);
  assert.deepEqual(preview.features,{pizzaBuilder:true,halfAndHalf:true});
  await applyFoodConfiguration(db,db.partnerRow,config);
  assert.equal(categoryAllowed(db.partnerRow,3),false);
  const before=structuredClone(db.links);await applyFoodConfiguration(db,db.partnerRow,config);
  assert.deepEqual(db.links,before);
});

test('first package assignment preserves hidden legacy categories and their base prices', async () => {
  const db=database();
  db.links.push({partnerId:7,categoryId:4,enabled:false,position:9,customBasePrices:{M:3}});
  await applyFoodConfiguration(db,db.partnerRow,await snapshotPackages(db,[2]));
  assert.deepEqual(db.links.find(l=>l.categoryId===4),{partnerId:7,categoryId:4,enabled:false,position:9,customBasePrices:{M:3}});
  assert.equal(db.links.find(l=>l.categoryId===2).enabled,true);
  assert.equal(db.links.find(l=>l.categoryId===1).enabled,false);
});

test('assigned snapshots survive edits and retirement; new assignments reject unavailable or malformed packages', async () => {
  const db=database();const config=await snapshotPackages(db,[2]);
  db.packages[1].categoryIds=[1];db.packages[1].active=false;
  assert.deepEqual((await snapshotPackages(db,[2,3],config)).packages[0].categoryIds,[2,4]);
  for(const ids of [[2],[999],[],[true],['1'],{},'1,2']) await assert.rejects(()=>snapshotPackages(db,ids),e=>e.status===400);
  assert.deepEqual((await snapshotPackages(db,[],null,{allowEmpty:true})).packages,[]);
});

test('admin assignment preview does not mutate; apply rejects stale edits and preserves the reviewed configuration', async t => {
  const db=database();const request=await serve(t,foodPackagesRoutes(db));
  const body={packageIds:[2,3],expectedConfiguration:null};
  const preview=await request('/partners/7/preview',body);assert.equal(preview.status,200);assert.equal(db.partnerRow.foodConfiguration,null);
  body.previewConfiguration=(await preview.json()).configuration;
  const response=await request('/partners/7/apply',body);assert.equal(response.status,200);assert.equal(db.links.length,4);
  assert.equal((await request('/partners/7/apply',body)).status,409);
});

test('food package catalog and assignment are restricted to global administration', async t => {
  const request=await serve(t,foodPackagesRoutes(database()),'backoffice');
  assert.equal((await request('/')).status,403);assert.equal((await request('/partners/7/apply',{packageIds:[1]})).status,403);
  assert.equal(isPublicWebRoute('GET','/food-packages'),false);
  await assert.rejects(()=>authorizeBackoffice({}, {webSession:{role:'backoffice',partnerId:7},method:'GET',query:{},body:{}}, '/food-packages/partners/7'),e=>e.status===403);
});

test('editing a package after preview cannot silently apply a different set of categories', async t => {
  const db=database();const request=await serve(t,foodPackagesRoutes(db));
  const body={packageIds:[2],expectedConfiguration:null};
  body.previewConfiguration=(await (await request('/partners/7/preview',body)).json()).configuration;
  db.packages[1].categoryIds=[1,4];
  assert.equal((await request('/partners/7/apply',body)).status,409);
  assert.equal(db.partnerRow.foodConfiguration,null);
});

test('managed category sync adds new global categories disabled and never falls back to all categories on failure', async t => {
  const db=database();await applyFoodConfiguration(db,db.partnerRow,await snapshotPackages(db,[2]));
  db.categories.push({id:5,name:'Nueva pizza',position:4});
  const request=await serve(t,partnerCategoriesRoutes(db));
  const rows=await (await request('/partners/7/categories')).json();
  assert.equal(rows.find(c=>c.id===5).enabled,false);assert.equal(rows.find(c=>c.id===5).assigned,false);
  db.partnerCategory.findMany=async()=>{throw Error('database offline');};
  assert.equal((await request('/partners/7/categories')).status,503);
});

test('public menu and checkout loader exclude unassigned, disabled and missing-link products', async () => {
  const config={version:1,packages:[{id:2,categoryIds:[2,4]}]};
  const row={id:1,categoryId:2,categoryEnabled:1,foodConfiguration:JSON.stringify(config),selectSize:'["M"]',priceBySize:'{"M":9}',productActive:1,builderType:'NONE',customizable:0};
  const rows=[row,{...row,id:2,categoryId:1,customizable:1,builderType:'PIZZA'},{...row,id:3,categoryEnabled:null},{...row,id:4,categoryEnabled:0}];
  const products=await loadStoreMenuProducts({$queryRawUnsafe:async()=>rows},7,1);
  assert.deepEqual(products.map(p=>p.id),[1]);assert.equal(products[0].categoryRef.builderType,'NONE');
  const legacy=await loadStoreMenuProducts({$queryRawUnsafe:async()=>[{...row,foodConfiguration:null,categoryEnabled:null,builderType:'PIZZA',customizable:1}]},7,1);
  assert.equal(legacy[0].categoryRef.customizable,true);
});

test('extras remain valid on burgers while forged visual builds and halves are rejected', () => {
  const burger={id:2,categoryId:2,category:'Burger',selectSize:['M'],priceBySize:{M:9},categoryRef:{customizable:false,builderType:'NONE',halfAndHalf:false},ingredients:[]};
  const line={cartLineId:'burger',pizzaId:2,size:'M',qty:1,price:9,subtotal:11,extras:[{ingredientId:7,price:2}]};
  const context={menu:[burger],extras:[{ingredientId:7,categoryId:2,status:'ACTIVE',price:2}]};
  assert.equal(priceCheckoutLines([line],context)[0].subtotal,11);
  assert.throws(()=>priceCheckoutLines([{...line,extras:[],type:'CUSTOM_BUILD',ingredients:[{ingredientId:7}]}],context),e=>e.message==='cart_item_unavailable');
  assert.throws(()=>priceCheckoutLines([{...line,type:'HALF_HALF',leftPizzaId:2,rightPizzaId:2}],context),e=>e.message==='cart_item_unavailable');
});
