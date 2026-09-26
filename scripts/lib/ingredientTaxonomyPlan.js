import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { categories, decisionFor, overrides, reviewRequired, taxonomyVersion } from './ingredientTaxonomyRules.js';
import { legacyDatabaseClassifications, legacyDatabaseReviews, operationalKeys } from './ingredientTaxonomyLegacyDatabase.js';

export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  typeof item === 'bigint' ? item.toString() : item)).digest('hex');

export function buildPlan(master) {
  assert.ok(Array.isArray(master) && master.length, 'Empty master');
  const keys = new Set(master.map(row => row.canonicalKey));
  assert.equal(keys.size, master.length, 'Duplicate master identity');
  for (const key of [...overrides.keys(), ...reviewRequired.keys()]) assert.ok(keys.has(key), `Decision references missing identity: ${key}`);
  const targets = new Map(categories.map(row => [row.key, row]));
  const rows = master.map(row => {
    const decision = decisionFor(row);
    if (decision.category) assert.ok(targets.has(decision.category), `Unknown target: ${decision.category}`);
    return { canonicalKey: row.canonicalKey, name: row.defaultName,
      from: { category: row.category, semanticKey: row.semanticCategoryKey },
      to: decision.category ? { category: decision.category, semanticKey: targets.get(decision.category).semanticKey } : null,
      status: decision.status, rule: decision.rule || 'manual_review', reason: decision.reason };
  });
  return { version: taxonomyVersion, sourceSha256: digest(master), categories, rows,
    counts: { total: rows.length, proposed: rows.filter(row => row.to).length, reviewRequired: rows.filter(row => !row.to).length },
    readyForProduction: false };
}

export function validatePlan(plan, master) {
  assert.equal(plan.version, taxonomyVersion, 'Unsupported taxonomy proposal');
  assert.equal(plan.sourceSha256, digest(master), 'Master changed since plan generation');
  assert.deepEqual(plan.categories, categories, 'Category definitions changed');
  const expected = buildPlan(master);
  assert.deepEqual(plan.rows, expected.rows, 'Manifest differs from reviewed rules');
  assert.deepEqual(plan.counts, expected.counts, 'Manifest counts changed');
  assert.equal(plan.readyForProduction, false, 'A rehearsal manifest cannot authorize a rollout');
  return plan;
}

export function validateSandboxUrl(value) {
  assert.ok(value, 'TAXONOMY_REHEARSAL_DATABASE_URL is required; DATABASE_URL is never a fallback');
  const url = new URL(value);
  assert.equal(url.protocol, 'mysql:', 'Sandbox must use MySQL');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Refusing non-loopback database');
  assert.equal(url.pathname, '/ingredient_taxonomy_rehearsal', 'Refusing a database without the dedicated rehearsal name');
  assert.equal(url.search, '', 'Connection parameter overrides are not permitted for the sandbox');
  return value;
}

export function bindDatabaseRows(plan, master, ingredients, catalogStates = []) {
  const rowByKey = new Map(plan.rows.map(row => [row.canonicalKey, row]));
  const redirects = new Map();
  for (const row of master) for (const legacy of row.legacyCanonicalKeys || []) {
    assert.ok(!rowByKey.has(legacy) && !redirects.has(legacy), `Ambiguous legacy identity: ${legacy}`);
    redirects.set(legacy, row.canonicalKey);
  }
  const canonical = key => redirects.get(key) || key;
  const states = new Map(catalogStates.map(row => [row.ingredientId, row.masterCanonicalKey]));
  const usedKeys = new Set();
  const changes = [], held = [], local = [], operational = [];
  for (const ingredient of ingredients) {
    if (!ingredient.isSystem) { local.push(ingredient.id); continue; }
    const directKey = canonical(ingredient.canonicalKey);
    const protectedKey = canonical(states.get(ingredient.id));
    if (directKey && protectedKey && directKey !== protectedKey) {
      held.push({ id: ingredient.id, reason: 'identity_conflict', canonicalKey: ingredient.canonicalKey }); continue;
    }
    const key = protectedKey || directKey;
    if (!protectedKey && operationalKeys.has(key) && ingredient.category === 'Random selection') {
      operational.push(ingredient.id); continue;
    }
    if (!rowByKey.has(key)) {
      const legacy = legacyDatabaseClassifications.get(key);
      if (legacy && !protectedKey && ingredient.category === legacy.from) {
        const target = categories.find(row => row.key === legacy.to);
        assert.ok(target, `Unknown legacy classification target: ${legacy.to}`);
        changes.push({ id: ingredient.id, canonicalKey: ingredient.canonicalKey, rule: 'legacy_database_classification_only',
          from: { category: ingredient.category, semanticCategoryId: ingredient.semanticCategoryId },
          to: { category: target.key, semanticKey: target.semanticKey } });
      } else held.push({ id: ingredient.id, reason: legacyDatabaseReviews.has(key) ? 'legacy_composition_requires_review' : legacy ? 'legacy_classification_drift' : 'identity_not_in_master', canonicalKey: ingredient.canonicalKey });
      continue;
    }
    // Check duplicates before emitting any changes, including duplicates of held rows.
    assert.ok(!usedKeys.has(key), `Two database ingredients claim the same master identity: ${key}`);
    usedKeys.add(key);
    const row = rowByKey.get(key);
    if (!row.to) { held.push({ id: ingredient.id, reason: 'classification_requires_review', canonicalKey: key }); continue; }
    changes.push({ id: ingredient.id, canonicalKey: key, from: { category: ingredient.category, semanticCategoryId: ingredient.semanticCategoryId }, to: row.to });
  }
  return { changes, held, local, operational };
}
