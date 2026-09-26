import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateSandboxUrl} from './lib/ingredientTaxonomyPlan.js';
import {captureTables,tableDigests} from './lib/ingredientTaxonomyRehearsal.js';
import {loadStoreMenuProducts} from '../services/storeMenuProducts.js';
process.env.DATABASE_URL=validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
const {PrismaClient}=await import('@prisma/client');const prisma=new PrismaClient();
const before=tableDigests(await captureTables(prisma));const checks=[];
const normalize=rows=>rows.map(row=>({...row,
  productTags:row.productTags||[],selectSize:row.selectSize||[],priceBySize:row.priceBySize||{},
  categoryRef:row.categoryRef||{position:null,customizable:false,halfAndHalf:false},
  ingredients:row.ingredients.slice().sort((a,b)=>a.ingredient.id-b.ingredient.id),
})).sort((a,b)=>a.id-b.id);
try {
 for(const store of await prisma.store.findMany({where:{active:true}})) {
  const expected=await prisma.menuPizza.findMany({where:{partnerId:store.partnerId,status:'ACTIVE',type:'SELLABLE'},select:{
   id:true,name:true,category:true,categoryId:true,cookingMethod:true,selectSize:true,priceBySize:true,image:true,launchAt:true,availableUntil:true,productTags:true,
   categoryRef:{select:{position:true,customizable:true,halfAndHalf:true}},stocks:{where:{storeId:store.id},select:{active:true,stock:true}},
   ingredients:{select:{qtyBySize:true,ingredient:{select:{id:true,name:true,canonicalKey:true,allergens:true,costPrice:true,status:true,storeStocks:{where:{storeId:store.id},select:{active:true}}}}}},
  }});
  const actual=await loadStoreMenuProducts(prisma,store.partnerId,store.id);
  assert.deepEqual(normalize(actual),normalize(expected));
  checks.push({storeId:store.id,products:actual.length,graphIdentical:true});
 }
 assert.deepEqual(tableDigests(await captureTables(prisma)),before);
 const report={verifiedAt:new Date().toISOString(),environment:'isolated_loopback_copy',checks,allTablesUnchanged:true};
 fs.writeFileSync(new URL('../docs/menu-query-equivalence.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {await prisma.$disconnect();}
