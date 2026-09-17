import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveCatalogIngredient, saveCatalogIngredient } from '../services/ingredientCatalog.js';
import { getMasterIngredient } from '../services/ingredientMasterCatalogue.js';

const locales = ['es', 'en', 'it', 'fr', 'pt', 'ar', 'zh'];
const fixture = () => ({ id: 42, isSystem: true, name: 'Pollo frito', canonicalKey: 'pollo_frito', category: 'CARNES',
  status: 'ACTIVE', image: 'https://example.test/original.jpg', imagePublicId: 'original', imageVersion: 3,
  allergens: ['gluten'], translations: locales.map(locale => ({ locale, name: locale === 'es' ? 'Pollo frito' : `Saved ${locale}`, description: 'Saved description' })),
  aliases: [{ locale: 'es', alias: 'Pollo frito', normalizedAlias: 'pollo frito', source: 'MANUAL', isReviewed: true }] });
const payload = item => ({ name: item.name, canonicalKey: item.canonicalKey, category: item.category,
  translations: item.translations.map(({ locale, name }) => ({ locale, name })), aliases: ['Pollo frito'] });
function database(initial = fixture(), usage = {}) {
  let item = structuredClone(initial);
  let writes = 0;
  const prisma = {
    $queryRawUnsafe: async () => [{ id: item.id }],
    ingredient: {
      findUnique: async () => structuredClone(item), findMany: async () => [],
      update: async ({ data }) => { writes++; item = { ...item, ...data }; return structuredClone(item); },
      delete: async () => assert.fail('Physical deletion is forbidden'),
    },
    ingredientCatalogState: { upsert: async ({ create, update }) => {
      writes++; item.catalogState = item.catalogState ? { ...item.catalogState, ...update } : { ...create };
    } },
    ingredientSemanticCategory: { findUnique: async () => ({ id: 7 }) },
    ingredientTranslation: { upsert: async ({ create, update }) => {
      writes++; item.translations = item.translations.map(row => row.locale === create.locale ? { ...row, ...update } : row);
    } },
    ingredientAlias: { findFirst: async () => item.aliases[0], create: async () => assert.fail('Saved alias must be retained') },
  };
  for (const name of ['storeIngredientStock', 'menuPizzaIngredient', 'ingredientExtra', 'ingredientCategoryUse', 'partnerIngredientProfile', 'ingredientLocalSemanticMapping']) {
    prisma[name] = { count: async ({ where }) => {
      assert.equal(JSON.stringify(where).includes('active'), false, 'Inactive references must also block removal');
      return usage[name] || 0;
    } };
  }
  prisma.$transaction = async fn => {
    const before = structuredClone(item);
    try { return await fn(prisma); } catch (error) { item = before; throw error; }
  };
  return { prisma, item: () => structuredClone(item), writes: () => writes };
}

test('return to pool requires explicit confirmation and preserves the entire saved identity', async () => {
  const db = database();
  await assert.rejects(archiveCatalogIngredient(db.prisma, 42, false), { status: 400 });
  assert.equal(db.writes(), 0);
  await archiveCatalogIngredient(db.prisma, 42, true);
  const archived = db.item();
  assert.equal(archived.status, 'INACTIVE');
  assert.equal(archived.catalogState.masterCanonicalKey, 'pollo_frito');
  assert.ok(archived.catalogState.archivedAt);
  assert.deepEqual(archived.translations, fixture().translations);
  assert.deepEqual(archived.aliases, fixture().aliases);
  assert.equal(archived.imagePublicId, 'original');
  assert.deepEqual(getMasterIngredient('pollo_frito').canonicalKey, 'pollo_frito');
  const writes = db.writes();
  await archiveCatalogIngredient(db.prisma, 42, true);
  assert.equal(db.writes(), writes, 'Repeated removal is idempotent');
});

for (const relation of ['storeIngredientStock', 'menuPizzaIngredient', 'ingredientExtra', 'ingredientCategoryUse', 'partnerIngredientProfile', 'ingredientLocalSemanticMapping']) {
  test(`blocks removal while linked through ${relation}`, async () => {
    const db = database(fixture(), { [relation]: 1 });
    await assert.rejects(archiveCatalogIngredient(db.prisma, 42, true), error => error.status === 409 && Object.values(error.usage).includes(1));
    assert.equal(db.writes(), 0);
    assert.deepEqual(db.item(), fixture());
  });
}

test('restoring reuses the ID, original photo, descriptions, aliases, allergens and previous status', async () => {
  const db = database();
  await archiveCatalogIngredient(db.prisma, 42, true);
  const result = await saveCatalogIngredient({ prisma: db.prisma, id: 42, body: payload(db.item()), restore: true });
  assert.equal(result.id, 42);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.catalogState.archivedAt, null);
  assert.equal(result.image, fixture().image);
  assert.deepEqual(result.aliases, fixture().aliases);
  assert.deepEqual(result.allergens, fixture().allergens);
  assert.ok(result.translations.every(row => row.description === 'Saved description' && row.isReviewed));
});

test('protects existing identity, rejects unknown master links and disallows editing archived entries', async () => {
  const db = database();
  await assert.rejects(saveCatalogIngredient({ prisma: db.prisma, id: 42, body: { ...payload(db.item()), canonicalKey: 'huevo' } }), { status: 409 });
  assert.equal(db.writes(), 0);
  const unknown = database({ ...fixture(), canonicalKey: 'unknown_private', name: 'Unknown private', translations: [], aliases: [] });
  await assert.rejects(archiveCatalogIngredient(unknown.prisma, 42, true), { status: 409 });
  await archiveCatalogIngredient(db.prisma, 42, true);
  await assert.rejects(saveCatalogIngredient({ prisma: db.prisma, id: 42, body: payload(db.item()) }), { status: 409 });
});

test('an upload failure cannot modify the saved ingredient', async () => {
  const db = database();
  await assert.rejects(saveCatalogIngredient({ prisma: db.prisma, id: 42, body: payload(db.item()), file: {},
    uploadImage: async () => { throw new Error('Upload failed'); }, deleteImage: async () => assert.fail('No uploaded image') }), /Upload failed/);
  assert.deepEqual(db.item(), fixture());
  assert.equal(db.writes(), 0);
});

test('a failed database save cleans only the new upload and keeps the original image and names', async () => {
  const db = database(); const removed = [];
  db.prisma.ingredientSemanticCategory.findUnique = async () => null;
  await assert.rejects(saveCatalogIngredient({ prisma: db.prisma, id: 42, body: payload(db.item()), file: {},
    uploadImage: async () => ({ image: 'new.jpg', imagePublicId: 'new' }), deleteImage: async id => removed.push(id) }), { status: 409 });
  assert.deepEqual(removed, ['new']);
  assert.deepEqual(db.item(), fixture());
});

test('a successful image replacement cleans the old image only after saving the complete record', async () => {
  const db = database(); const removed = [];
  const result = await saveCatalogIngredient({ prisma: db.prisma, id: 42, body: payload(db.item()), file: {},
    uploadImage: async () => ({ image: 'new.jpg', imagePublicId: 'new' }),
    deleteImage: async id => { assert.equal(db.item().imagePublicId, 'new'); removed.push(id); } });
  assert.equal(result.imageVersion, 4);
  assert.deepEqual(removed, ['original']);
  assert.deepEqual(result.allergens, fixture().allergens);
});
