import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { validateSandboxUrl, validatePlan, bindDatabaseRows } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests, verifyForward, applyOnCopy, rollbackCopy } from './lib/ingredientTaxonomyRehearsal.js';

const url = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url } } });
const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
try {
  const master = read('../../volta-storefront/src/data/ingredientMasterSource.json');
  const plan = validatePlan(read('../docs/ingredient-taxonomy-v2-plan.json'), master);
  const before = await captureTables(prisma);
  for (const table of ['Ingredient', 'IngredientCatalogState', 'IngredientLocalSemanticMapping', 'IngredientSemanticCategory']) {
    assert.ok(Array.isArray(before[table]), `Required table missing from the copied schema: ${table}`);
  }
  const bindings = bindDatabaseRows(plan, master, before.Ingredient, before.IngredientCatalogState);
  const sourceDirectory = process.argv[2];
  assert.ok(sourceDirectory, 'Pass the private source snapshot directory to identify the rehearsal evidence');
  const snapshot = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'snapshot.json'), 'utf8'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceDirectory, 'source.sql'))).digest('hex'), snapshot.sha256, 'Source snapshot checksum mismatch');
  assert.ok(bindings.changes.length, 'No confidently identified ingredients to rehearse');
  // Prove transaction atomicity by failing after the first actual ingredient update.
  await assert.rejects(applyOnCopy(prisma, plan, bindings.changes, { failAfter: 1 }), /INJECTED_REHEARSAL_FAILURE/);
  assert.deepEqual(tableDigests(await captureTables(prisma)), tableDigests(before), 'Injected failure left changes behind');
  const created = await applyOnCopy(prisma, plan, bindings.changes);
  let verified = false;
  try {
    const after = await captureTables(prisma);
    verifyForward(before, after, bindings.changes, created);
    verified = true;
  } finally {
    // Always return the copied data to its previous classification, even if verification fails.
    await rollbackCopy(prisma, bindings.changes, created);
  }
  const rolledBack = await captureTables(prisma);
  assert.deepEqual(tableDigests(rolledBack), tableDigests(before), 'Rollback did not restore every copied table row');
  const report = { generatedAt: new Date().toISOString(), version: plan.version, sourceMasterSha256: plan.sourceSha256,
    sourceSnapshotSha256: snapshot.sha256, sourceSnapshotCapturedAt: snapshot.capturedAt,
    scope: 'Isolated MySQL copy; classification changes only; not an application rollout',
    readyForProduction: false, master: plan.counts,
    database: { totalIngredients: before.Ingredient.length, systemIngredients: before.Ingredient.filter(row => row.isSystem).length,
      reclassified: bindings.changes.length, legacyClassificationsReviewed: bindings.changes.filter(row => row.rule === 'legacy_database_classification_only').length,
      localIngredientsPreserved: bindings.local.length, operationalPlaceholdersPreserved: bindings.operational.length, heldForReview: bindings.held.length,
      recipes: before.MenuPizzaIngredient.length, storeStocks: before.StoreIngredientStock.length,
      extras: before.IngredientExtra.length, categoryUses: before.IngredientCategoryUse.length,
      partnerProfiles: before.PartnerIngredientProfile.length, sales: before.Sale.length, tablesCompared: Object.keys(before).length },
    checks: { forwardClassificationOnly: verified, failureIsAtomic: true, rollbackRowsIdentical: true },
    held: bindings.held.map(({ id, canonicalKey, reason }) => ({ id, name: before.Ingredient.find(row => row.id === id).name, canonicalKey, reason })),
    limitations: ['Incomplete classification decisions remain blocked.', 'Database-held identities require explicit review; no name-based matching was applied.',
      'Frontend/backend category dictionaries, translations, onboarding and cost suggestions have not been migrated.',
      'This verifies stored data, not checkout or POS end-to-end behavior.', 'Rollback restores all rows; MySQL auto-increment counters can advance after rolled-back inserts.'] };
  fs.writeFileSync(new URL('../docs/ingredient-taxonomy-v2-rehearsal.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const databasePlan = { version: plan.version, snapshotSha256: snapshot.sha256, readyForProduction: false,
    changes: bindings.changes, held: report.held, localIdsPreserved: bindings.local, operationalIdsPreserved: bindings.operational };
  fs.writeFileSync(new URL('../docs/ingredient-taxonomy-v2-database-plan.json', import.meta.url), JSON.stringify(databasePlan, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await prisma.$disconnect(); }
