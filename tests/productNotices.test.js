import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pizzasRoutes, { parseProductTags } from '../routes/pizzas.js';

test('accepts all six notices together from JSON/multipart and discards duplicates and unknown labels', () => {
  const tags = ['spicy','vegan','vegetarian','gluten_free','kosher','halal'];
  assert.deepEqual(parseProductTags(tags), tags);
  assert.deepEqual(parseProductTags(JSON.stringify([...tags,'kosher','unknown'])), tags);
  assert.deepEqual(parseProductTags(['halal']), ['halal']);
  assert.deepEqual(parseProductTags(['kosher']), ['kosher']);
  for(const bad of [null, '', '{}', 'bad JSON']) assert.deepEqual(parseProductTags(bad), []);
});

test('HTTP creation and editing preserve all notices; omitted tags survive and explicit empty selection clears them', async t => {
  let row;
  const prisma = {
    $executeRawUnsafe: async () => {}, $queryRaw: async () => [],
    partner: { findUnique: async () => ({id:7}) }, category:{findUnique:async()=>({id:3,name:'Pizzas'})},
    store:{findMany:async()=>[]}, partnerIngredientProfile:{findMany:async()=>[]},
    menuPizza:{
      create:async({data})=>(row={...data,id:42,ingredients:[]}), findUnique:async()=>row,
      update:async({data})=>(row={...row,...data}),
    },
    menuPizzaIngredient:{findMany:async()=>[],count:async()=>0,deleteMany:async()=>({count:0})},
  };
  prisma.$transaction = async fn => fn(prisma);
  const app=express();app.use(express.json());app.use('/pizzas',pizzasRoutes(prisma));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const send=(method,suffix,body)=>fetch(`http://127.0.0.1:${server.address().port}/pizzas${suffix}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const tags=['spicy','vegan','vegetarian','gluten_free','kosher','halal'];
  const created=await send('POST','',{partnerId:7,categoryId:3,name:'Test',sizes:['M'],priceBySize:{M:12},productTags:tags});
  assert.equal(created.status,200,JSON.stringify(await created.clone().json()));
  assert.deepEqual((await created.json()).productTags,tags);
  const form = new FormData();
  form.append('name', 'Edited');
  form.append('productTags', JSON.stringify(['spicy','halal']));
  const edit=await fetch(`http://127.0.0.1:${server.address().port}/pizzas/42`, {method:'PUT', body:form});
  assert.equal(edit.status,200,JSON.stringify(await edit.clone().json()));
  assert.deepEqual(row.productTags,['spicy','halal']);
  assert.equal((await send('PUT','/42',{name:'Still edited'})).status,200);
  assert.deepEqual(row.productTags,['spicy','halal']);
  assert.equal((await send('PUT','/42',{productTags:[]})).status,200);
  assert.deepEqual(row.productTags,[]);
});
