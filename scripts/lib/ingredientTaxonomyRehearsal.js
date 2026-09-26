import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digest } from './ingredientTaxonomyPlan.js';

const tableName = name => { assert.match(name, /^[A-Za-z0-9_]+$/); return '`' + name + '`'; };
const sorted = rows => rows.map(row => digest(row)).sort();
export async function captureTables(prisma) {
  const tables = (await prisma.$queryRawUnsafe('SHOW TABLES')).map(row => Object.values(row)[0]).sort();
  const data = {};
  const schema = fs.readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
  const names = new Map([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(match => [match[1].toLowerCase(), match[1]]));
  // Windows MySQL stores names in lower case; use Prisma names consistently in reports.
  for (const table of tables) data[names.get(table.toLowerCase()) || table] = await prisma.$queryRawUnsafe(`SELECT * FROM ${tableName(table)}`);
  return data;
}
export const tableDigests = data => Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, { count: rows.length, sha256: digest(sorted(rows)) }]));

export function verifyForward(before, after, changes, categoriesCreated) {
  assert.deepEqual(Object.keys(after), Object.keys(before), 'Unexpected schema change');
  const byId = new Map(changes.map(row => [row.id, row]));
  for (const [name, rows] of Object.entries(before)) {
    if (name === 'Ingredient') {
      assert.equal(rows.length, after[name].length, 'Ingredient count changed');
      const actual = new Map(after[name].map(row => [row.id, row]));
      for (const row of rows) {
        const change = byId.get(row.id);
        const expected = change ? { ...row, category: change.to.category, semanticCategoryId: categoriesCreated.get(change.to.semanticKey) } : row;
        assert.deepEqual(actual.get(row.id), expected, `Unexpected ingredient changes for ID ${row.id}`);
      }
    } else if (name === 'IngredientSemanticCategory') {
      const old = after[name].filter(row => ![...categoriesCreated.values()].includes(row.id));
      assert.equal(after[name].length, rows.length + categoriesCreated.size);
      assert.deepEqual(sorted(old), sorted(rows), 'Existing semantic categories changed');
    } else assert.deepEqual(sorted(after[name]), sorted(rows), `Protected table changed: ${name}`);
  }
}

export async function applyOnCopy(prisma, plan, changes, { failAfter = null } = {}) {
  return prisma.$transaction(async tx => {
    const created = new Map();
    for (const category of plan.categories) {
      const existing = await tx.ingredientSemanticCategory.findUnique({ where: { canonicalKey: category.semanticKey } });
      assert.ok(!existing, `Sandbox already contains target category ${category.semanticKey}`);
      const row = await tx.ingredientSemanticCategory.create({ data: { canonicalKey: category.semanticKey, defaultName: category.name, position: category.position } });
      created.set(category.semanticKey, row.id);
    }
    let written = 0;
    for (const change of changes) {
      // Change classification only; preserve identities, timestamps and every other field.
      const count = await tx.$executeRawUnsafe('UPDATE Ingredient SET category = ?, semanticCategoryId = ? WHERE id = ? AND category = ? AND semanticCategoryId <=> ?',
        change.to.category, created.get(change.to.semanticKey), change.id, change.from.category, change.from.semanticCategoryId);
      assert.equal(count, 1, `Stale ingredient snapshot for ID ${change.id}`);
      written++;
      if (failAfter === written) throw new Error('INJECTED_REHEARSAL_FAILURE');
    }
    return created;
  }, { timeout: 60000 });
}

export async function rollbackCopy(prisma, changes, created) {
  return prisma.$transaction(async tx => {
    for (const change of changes) {
      const count = await tx.$executeRawUnsafe('UPDATE Ingredient SET category = ?, semanticCategoryId = ? WHERE id = ? AND category = ? AND semanticCategoryId = ?',
        change.from.category, change.from.semanticCategoryId, change.id, change.to.category, created.get(change.to.semanticKey));
      assert.equal(count, 1, `Cannot roll back an ingredient edited after migration: ${change.id}`);
    }
    const deleted = await tx.ingredientSemanticCategory.deleteMany({ where: { id: { in: [...created.values()] } } });
    assert.equal(deleted.count, created.size);
  }, { timeout: 60000 });
}
