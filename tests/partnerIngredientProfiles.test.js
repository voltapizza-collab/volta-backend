import test from "node:test";
import assert from "node:assert/strict";
import { normalizePartnerIngredientProfile, loadPartnerIngredientProfiles, withPartnerIngredientProfile, savePartnerIngredientProfile } from "../services/partnerIngredientProfiles.js";

test("prices accept a decimal comma and reject inputs that could change their meaning", () => {
  assert.equal(normalizePartnerIngredientProfile({ costPrice: "1,25", description: " Tiras " }).costPrice, 1.25);
  for (const costPrice of ["", "-1", "0", "1.234", "1,2,3", "1e3", "1000000", "EUR 4", "2.50x"]) {
    assert.throws(() => normalizePartnerIngredientProfile({ costPrice, description: "" }), { status: 400 });
  }
  assert.throws(() => normalizePartnerIngredientProfile({ costPrice: 2, description: "x".repeat(421) }), { status: 400 });
});

test("profile lookup and effective prices are isolated by business and never mutate the catalog", async () => {
  const queries = [];
  const prisma = { $executeRawUnsafe: async () => {}, $queryRaw: async (query) => {
    queries.push(query); return query.values[0] === 7 ? [{ ingredientId: 10, costPrice: "2.50", description: "Mi producto" }] : [];
  } };
  const global = { id: 10, costPrice: 1, description: "Global", allergens: ["SOY"], aliases: ["Pechuga"] };
  const businessA = withPartnerIngredientProfile(global, await loadPartnerIngredientProfiles(prisma, 7));
  const businessB = withPartnerIngredientProfile(global, await loadPartnerIngredientProfiles(prisma, 8));
  assert.equal(businessA.costPrice, 2.5); assert.equal(businessB.costPrice, 1);
  assert.equal(global.description, "Global"); assert.deepEqual(businessA.allergens, ["SOY"]);
  assert.deepEqual(queries.map((query) => query.values), [[7], [8]]);
});

const fixture = ({ failStock = false } = {}) => {
  const written = []; const stocks = []; const deleted = [];
  const tx = { $queryRaw: async () => [{ imagePublicId: "own-old-image" }], $executeRaw: async (query) => written.push(query),
    storeIngredientStock: { upsert: async (args) => { stocks.push(args); if (failStock) throw new Error("stock failed"); } } };
  return { written, stocks, deleted, prisma: {
    store: { findUnique: async () => ({ partnerId: 7 }) },
    ingredient: { findUnique: async () => ({ id: 10, status: "ACTIVE" }), update: () => assert.fail("must never update global ingredient") },
    $executeRawUnsafe: async () => {}, $transaction: async (run) => run(tx),
  }, deleteImage: async (id) => deleted.push(id) };
};
test("saving uses the store's business, one transaction and the selected store's activation", async () => {
  const f = fixture();
  const result = await savePartnerIngredientProfile({ ...f, storeId: 2, ingredientId: 10,
    body: { partnerId: 999, costPrice: "3.50", description: "Mi descripción", allergens: ["changed"], aliases: ["changed"] } });
  assert.equal(result.partnerId, 7); assert.equal(f.written.length, 1); assert.equal(f.stocks.length, 1);
  assert.deepEqual(f.written[0].values.slice(0, 4), [7, 10, 3.5, "Mi descripción"]);
  assert.deepEqual(f.stocks[0].where, { storeId_ingredientId: { storeId: 2, ingredientId: 10 } });
  assert.deepEqual(f.stocks[0].update, { active: true });
  assert.deepEqual(f.deleted, []);
});
test("photo is scoped to the business, cleaned up on failure, and old personal photo replaced only after success", async () => {
  for (const failStock of [true, false]) {
    const f = fixture({ failStock });
    const options = { ...f, storeId: 2, ingredientId: 10, body: { costPrice: 2, description: "" }, file: { name: "photo.png" },
      uploadImage: async (_file, partnerId, ingredientId) => { assert.equal(partnerId, 7); assert.equal(ingredientId, 10);
        return { image: "https://example.test/photo.png", imagePublicId: "own-new-image" }; } };
    if (failStock) await assert.rejects(savePartnerIngredientProfile(options), /stock failed/);
    else await savePartnerIngredientProfile(options);
    assert.deepEqual(f.deleted, [failStock ? "own-new-image" : "own-old-image"]);
  }
});
test("invalid input and failed uploads perform no profile or stock writes", async () => {
  const f = fixture();
  await assert.rejects(savePartnerIngredientProfile({ ...f, storeId: 2, ingredientId: 10, body: { costPrice: -4, description: "" } }), { status: 400 });
  await assert.rejects(savePartnerIngredientProfile({ ...f, storeId: 2, ingredientId: 10, body: { costPrice: 2, description: "" }, file: {},
    uploadImage: async () => { throw new Error("upload failed"); } }), /upload failed/);
  assert.equal(f.written.length, 0); assert.equal(f.stocks.length, 0);
});
