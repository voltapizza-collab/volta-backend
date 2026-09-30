import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProductLinks, deleteUnlinkedProduct, withProductReferences, promoProductIds } from '../services/productLinks.js';
const product={id:63,partnerId:1,name:'Ravioli',categoryId:2,category:'Pizza',imagePublicId:'image-to-keep'};
function database({deals=[],promos=[],incentives=[],rules=[],missing=false}={}) {
  const events=[];
  const db={events,
    $queryRawUnsafe:async(sql,...args)=>{events.push(['lock',sql,args]);return missing?[]:[{id:63}];},
    menuPizza:{findUnique:async()=>missing?null:product,delete:async()=>{events.push(['delete']);return product;}},
    directDiscount:{findMany:async({where})=>{assert.equal(where.partnerId,1);return deals;}},
    promo:{findMany:async({where})=>{assert.equal(where.partnerId,1);return promos;}},
    incentive:{findMany:async({where})=>{assert.equal(where.rewardPizzaId,63);return incentives;}},
    partner:{findUnique:async()=>({priceAdjustmentRules:rules})},
  };
  db.$transaction=async run=>run(db);return db;
}
test('counts each linked offer once, including inactive and serialized references',async()=>{
  const db=database({deals:[{id:1,title:'Liquidación',status:'INACTIVE',productIds:'[63]'}],
    promos:[{id:2,title:'Doble',items:[{pizzaId:63},{type:'CHOICE',optionProductIds:[63,80]}]}],
    incentives:[{id:3,name:'Regalo'}],rules:[{id:'rule',title:'Precio especial',productIds:[63]}]});
  const links=await getProductLinks(db,product);
  assert.deepEqual(links.map(x=>[x.type,x.count]),[['TOP_DEAL',1],['PROMO',1],['INCENTIVE',1],['PRICE_RULE',1]]);
  assert.equal(links[1].items[0].name,'Doble');
  await assert.rejects(deleteUnlinkedProduct(db,63),e=>e.status===409&&e.links.length===4&&e.productName==='Ravioli');
  assert.equal(db.events.some(([event])=>event==='delete'),false);
});
test('category targets and category choices count, explicit choices do not include unrelated dishes',async()=>{
  const db=database({deals:[{id:1,targetType:'CATEGORY',categoryIds:[2]},{id:2,targetType:'CATEGORY',categoryNames:['pizza']}],
    promos:[{id:3,items:[{type:'CATEGORY',categoryId:2}]},{id:4,items:[{type:'CHOICE',categoryName:'Pizza'}]},
      {id:5,items:[{type:'CHOICE',choiceType:'PRODUCTS',categoryId:2,optionProductIds:[99]}]}]});
  assert.deepEqual((await getProductLinks(db,product)).map(x=>[x.type,x.count]),[['TOP_DEAL',2],['PROMO',2]]);
});
test('unlinked deletion locks before checking and returns image info only after deleting',async()=>{
  const db=database();assert.deepEqual(await deleteUnlinkedProduct(db,63),product);
  assert.equal(db.events[0][0],'lock');assert.match(db.events[0][1],/FOR UPDATE$/);
  assert.equal(db.events[1][0],'delete');
});
test('missing products cannot be deleted or introduced by concurrent offer writes',async()=>{
  const db=database({missing:true});let saved=false;
  await assert.rejects(deleteUnlinkedProduct(db,63),e=>e.status===404);
  await assert.rejects(withProductReferences(db,1,[63],async()=>{saved=true;}),e=>e.status===400&&e.message==='bad_product_ids');
  assert.equal(saved,false);
});
test('offer writes acquire product locks and keep them through the save',async()=>{
  const db=database();let saved=false;
  await withProductReferences(db,1,[63,63],async tx=>{assert.equal(tx,db);assert.equal(db.events[0][0],'lock');saved=true;});
  assert.equal(saved,true);assert.deepEqual(db.events[0][2],[1,63]);
  assert.deepEqual(promoProductIds([{pizzaId:'63'},{type:'CHOICE',optionProductIds:[63,64]}]),[63,64]);
});
