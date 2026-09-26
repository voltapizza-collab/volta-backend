import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';
import { ingredientNameRepairs, applyReviewedIngredientNameRepairs } from '../data/ingredientNameRepairs.js';
process.env.DATABASE_URL=validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
const {PrismaClient}=await import('@prisma/client');const prisma=new PrismaClient();
const before=await captureTables(prisma);
const rollback=new Error('ROLLBACK_REVIEWED_NAMES');
try {
  await assert.rejects(prisma.$transaction(async tx=>{
    await applyReviewedIngredientNameRepairs(tx);
    await applyReviewedIngredientNameRepairs(tx); // idempotent
    const expected={...before,Ingredient:before.Ingredient.map(row=>({...row}))};
    for(const repair of ingredientNameRepairs)expected.Ingredient.find(row=>row.id===repair.id).name=repair.to;
    assert.deepEqual(tableDigests(await captureTables(tx)),tableDigests(expected),'Unexpected change outside reviewed names');
    throw rollback;
  },{timeout:20000}),error=>error===rollback);
  assert.deepEqual(tableDigests(await captureTables(prisma)),tableDigests(before));
  const report={verifiedAt:new Date().toISOString(),environment:'isolated_loopback_copy',repairs:ingredientNameRepairs,onlyNameChanged:true,idsKeysRecipesStocksPricesPreserved:true,idempotent:true,transactionRolledBack:true,tablesRestored:Object.keys(before).length,productionApplied:false};
  fs.writeFileSync(new URL('../docs/ingredient-name-repair-rehearsal.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await prisma.$disconnect();}
