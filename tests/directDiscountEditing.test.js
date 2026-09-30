import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import directDiscountsRoutes from '../routes/directDiscounts.js';

const payload={partnerId:1,title:'Ravioli Frito',discountType:'FIXED_AMOUNT',value:2,targetType:'PRODUCT',productIds:[63,64],storeIds:[1],isClearance:true};
async function fixture(t,{previous=[63,64],products=[{id:63,partnerId:1}]}={}) {
  let saved=null;
  const db={
    $queryRawUnsafe:async(sql,partnerId,...ids)=>sql.includes('FROM MenuPizza')?products.filter(product=>product.partnerId===partnerId&&ids.includes(product.id)):[{Field:'present'}],
    partner:{findUnique:async()=>({id:1})},store:{count:async()=>1},
    menuPizza:{
      findMany:async({where})=>products.filter(product=>where.id.in.includes(product.id)),
      count:async({where})=>products.filter(product=>where.id.in.includes(product.id)&&product.partnerId===where.partnerId).length,
    },
    directDiscount:{
      findFirst:async()=>({id:14,partnerId:1,productIds:previous}),
      update:async({data})=>(saved={id:14,...data}),
      create:async({data})=>(saved={id:15,...data}),
    },
  };
  db.$transaction=async work=>work(db);
  const app=express();app.use(express.json());app.use(directDiscountsRoutes(db));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {saved:()=>saved,request:async(body=payload,method='PUT')=>{
    const res=await fetch(`http://127.0.0.1:${server.address().port}${method==='PUT'?'/14':'/'}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:res.status,data:await res.json()};
  }};
}
test('editing an existing deal removes a deleted reference and saves clearance',async t=>{
  const app=await fixture(t);const response=await app.request();
  assert.equal(response.status,200);assert.deepEqual(response.data.removedProductIds,[64]);
  assert.deepEqual(app.saved().productIds,[63]);assert.equal(response.data.discount.isClearance,true);
});
test('an unknown newly added product is rejected rather than silently removed',async t=>{
  const app=await fixture(t);const response=await app.request({...payload,productIds:[63,64,999]});
  assert.equal(response.status,400);assert.equal(response.data.error,'bad_product_ids');assert.equal(app.saved(),null);
});
test('existing references cannot bypass ownership when a product belongs to another partner',async t=>{
  const app=await fixture(t,{products:[{id:63,partnerId:1},{id:64,partnerId:2}]});
  const response=await app.request();assert.equal(response.data.error,'bad_product_ids');assert.equal(app.saved(),null);
});
test('a deal cannot be saved without any surviving product',async t=>{
  const app=await fixture(t,{products:[]});const response=await app.request();
  assert.equal(response.status,400);assert.equal(response.data.error,'missing_products');assert.match(response.data.message,/Selecciona/);assert.equal(app.saved(),null);
});
test('create still rejects deleted or nonexistent products',async t=>{
  const app=await fixture(t);const response=await app.request(payload,'POST');
  assert.equal(response.data.error,'bad_product_ids');assert.equal(app.saved(),null);
});
test('valid selections survive unchanged, including explicitly disabling clearance',async t=>{
  const app=await fixture(t,{products:[{id:63,partnerId:1},{id:64,partnerId:1}]});
  const response=await app.request({...payload,isClearance:false});
  assert.equal(response.status,200);assert.deepEqual(response.data.removedProductIds,[]);
  assert.deepEqual(app.saved().productIds,[63,64]);assert.equal(response.data.discount.isClearance,false);
});
