import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import routes from '../routes/ingredientExtras.js';
test('public extras immediately exclude disabled global ingredients and store stock',async t=>{
  let active=true, status='ACTIVE';
  const prisma={store:{findFirst:async ({where})=>where.id===3&&where.partnerId===7?{id:3}:null},ingredientExtra:{findMany:async query=>{
    assert.equal(query.include.ingredient.select.storeStocks.where.storeId,3);
    return [{ingredientId:11,price:2,ingredient:{name:'Cheese',status,allergens:[],storeStocks:[{active}]}},
      {ingredientId:12,price:2,ingredient:{name:'Unassigned',status:'ACTIVE',storeStocks:[]}}];
  }}};
  const app=express();app.use(routes(prisma));const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const get=()=>fetch(`http://127.0.0.1:${server.address().port}/?partnerId=7&storeId=3&categoryId=1`);
  let response=await get();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).length,1);
  active=false;assert.deepEqual(await(await get()).json(),[]);
  active=true;status='INACTIVE';assert.deepEqual(await(await get()).json(),[]);
  status='ACTIVE';assert.equal((await(await get()).json()).length,1);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/?partnerId=8&storeId=3&categoryId=1`)).status,404);
});
