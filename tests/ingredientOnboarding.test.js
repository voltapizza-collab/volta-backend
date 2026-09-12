import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeIngredientOnboarding, createIngredientOnboarding, onboardIngredientWithImage } from "../services/ingredientOnboarding.js";
import { createIngredientTranslator } from "../services/ingredientTranslation.js";

const body = () => ({ name: "Pollo frito", category: "CARNES", canonicalKey: "pollo_frito", aliases: ["POLLO FRITO"],
  translations: ["es", "en", "it", "fr", "pt", "ar", "zh"].map((locale) => ({ locale, name: locale === "es" ? "Pollo frito" : names[locale], isReviewed: true })) });
const env = { INGREDIENT_TRANSLATION_ENABLED: "true", OPENAI_API_KEY: "test-only-not-a-real-key" };
const request = { name: "Pollo frito", category: "Carnes" };
const names = { en: "Fried chicken", it: "Pollo fritto", fr: "Poulet frit", pt: "Frango frito", ar: "دجاج مقلي", zh: "炸鸡" };
const response = (value = names) => ({ ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }) });

test("requires seven unique languages, preserves Spanish and does not automatically approve translations", () => {
  const data = normalizeIngredientOnboarding(body());
  assert.equal(data.name, "Pollo frito"); assert.equal(data.category, "CARNES");
  assert.deepEqual(data.translations.map((item) => item.isReviewed), [true, false, false, false, false, false, false]);
  assert.equal(data.aliases.length, 1);
  const missing = body(); missing.translations.pop(); assert.throws(() => normalizeIngredientOnboarding(missing), /siete idiomas/);
  const duplicate = body(); duplicate.translations[4].locale = "en"; assert.throws(() => normalizeIngredientOnboarding(duplicate), /siete idiomas/);
  const changed = body(); changed.translations[0].name = "Roast chicken"; assert.throws(() => normalizeIngredientOnboarding(changed), /español/);
  assert.throws(() => normalizeIngredientOnboarding({ ...body(), name: "Pollo d�ner" }), /caracteres dañados/);
});

test("creates the ingredient, translations and aliases in one nested transaction", async () => {
  let transactionCount = 0; let creation;
  const prisma = { $transaction: async (run) => { transactionCount++; return run({
    ingredientSemanticCategory: { findUnique: async () => ({ id: 7 }) },
    ingredient: { findMany: async () => [], create: async (args) => { creation = args; return { id: 42 }; } },
  }); } };
  assert.deepEqual(await createIngredientOnboarding(prisma, body()), { id: 42 });
  assert.equal(transactionCount, 1); assert.equal(creation.data.semanticCategoryId, 7);
  assert.equal(creation.data.translations.create.length, 7); assert.equal(creation.data.semanticStatus, "NEEDS_REVIEW");
  assert.equal(creation.data.translations.create.find((item) => item.locale === "ar").name, "دجاج مقلي");
  assert.equal(creation.data.translations.create.find((item) => item.locale === "zh").name, "炸鸡");
});

test("rejects aliases already present and converts concurrent canonical-key conflicts", async () => {
  let created = false;
  const prisma = { $transaction: async (run) => run({
    ingredientSemanticCategory: { findUnique: async () => ({ id: 7 }) },
    ingredient: { findMany: async () => [{ name: "Fried chicken", aliases: [{ alias: "POLLO FRITO" }] }], create: async () => { created = true; } },
  }) };
  await assert.rejects(createIngredientOnboarding(prisma, body()), { status: 409 }); assert.equal(created, false);
  await assert.rejects(createIngredientOnboarding({ $transaction: async () => { throw { code: "P2002" }; } }, body()), { status: 409 });
});

test("missing provider is explicit and never makes a paid request", async () => {
  const translate = createIngredientTranslator({ env: { INGREDIENT_TRANSLATION_PROVIDER: "openai" }, fetchImpl: () => { assert.fail("unexpected request"); } });
  await assert.rejects(translate(request), /Falta configurar/);
});

test("translation uses culinary context and structured output, preserves Spanish and caches retries", async () => {
  let calls = 0;
  const translate = createIngredientTranslator({ env, fetchImpl: async (url, init) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses");
    const payload = JSON.parse(init.body); assert.equal(payload.store, false);
    assert.equal(payload.text.format.type, "json_schema");
    assert.deepEqual(payload.text.format.schema.required, ["en", "it", "fr", "pt", "ar", "zh"]);
    assert.deepEqual(JSON.parse(payload.input), { spanishName: "Pollo frito", category: "Carnes" });
    return response();
  } });
  const first = await translate(request); first.translations[0].name = "mutated";
  const second = await translate(request);
  assert.equal(calls, 1); assert.equal(second.translations[0].name, "Pollo frito");
  assert.equal(second.translations[4].name, "Frango frito");
  assert.ok(second.translations.every((item) => item.isReviewed === false));
});

test("incomplete responses and refusals are not accepted as translations", async () => {
  const incomplete = createIngredientTranslator({ env, fetchImpl: async () => response({ en: "Chicken" }) });
  await assert.rejects(incomplete(request), { status: 502 });
  const refusal = createIngredientTranslator({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }) }) });
  await assert.rejects(refusal(request), { status: 502 });
});

test("limits provider calls and retries failed requests without leaking provider secrets", async () => {
  const limited = createIngredientTranslator({ env: { ...env, INGREDIENT_TRANSLATION_DAILY_LIMIT: "1" }, fetchImpl: async () => response() });
  await limited(request); await assert.rejects(limited({ ...request, name: "Pollo asado" }), { status: 429 });
  let calls = 0;
  const retry = createIngredientTranslator({ env, fetchImpl: async () => { if (++calls === 1) throw new Error("provider secret data"); return response(); } });
  await assert.rejects(retry(request), (err) => !err.message.includes("secret"));
  assert.equal((await retry(request)).translations.length, 7);
});

const memoryResponse = (translatedText, extra = {}) => ({ ok: true, json: async () => ({
  responseStatus: 200, responseData: { translatedText }, quotaFinished: false, ...extra,
}) });

test("default free translator preserves Spanish, decodes text and reuses complete translations", async () => {
  const locales = [];
  const translate = createIngredientTranslator({ env: {}, fetchImpl: async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, "https://api.mymemory.translated.net/get");
    assert.equal(url.searchParams.get("q"), request.name);
    assert.equal(init.method, undefined); assert.equal(init.headers, undefined);
    const locale = url.searchParams.get("langpair").split("|")[1]; locales.push(locale);
    return memoryResponse(locale === "fr" ? "Poulet frit &#224; l&#39;huile" : names[locale === "zh-CN" ? "zh" : locale]);
  } });
  const translated = await translate(request);
  assert.equal(translated.provider, "mymemory");
  assert.equal(translated.translations[0].name, request.name);
  assert.equal(translated.translations[3].name, "Poulet frit à l'huile");
  assert.equal((await translate(request)).cached, true);
  assert.deepEqual(locales, ["en", "it", "fr", "pt", "ar", "zh-CN"]);
});

test("a partial provider failure retries only the missing language", async () => {
  const locales = []; let failed = false;
  const translate = createIngredientTranslator({ env: {}, fetchImpl: async (input) => {
    const locale = new URL(input).searchParams.get("langpair").split("|")[1]; locales.push(locale);
    if (locale === "fr" && !failed) { failed = true; throw new Error("temporary connection failure"); }
    return memoryResponse(names[locale === "zh-CN" ? "zh" : locale]);
  } });
  await assert.rejects(translate(request), { status: 503 });
  assert.equal((await translate(request)).translations[3].name, names.fr);
  assert.deepEqual(locales, ["en", "it", "fr", "pt", "ar", "zh-CN", "fr"]);
});

test("free quota is enforced, provider quota errors are not names, and cached names remain usable", async () => {
  let calls = 0;
  const translate = createIngredientTranslator({ env: { INGREDIENT_TRANSLATION_CHARACTER_LIMIT: "66" }, fetchImpl: async () => {
    calls++; return memoryResponse("Chicken");
  } });
  await translate(request);
  await assert.rejects(translate({ ...request, name: "Pollo asado" }), { status: 429 });
  assert.equal((await translate(request)).cached, true); assert.equal(calls, 6);
  const exhausted = createIngredientTranslator({ env: {}, fetchImpl: async () => memoryResponse("QUOTA EXCEEDED", { quotaFinished: true }) });
  await assert.rejects(exhausted(request), { status: 429 });
  await assert.rejects(exhausted(request), { status: 429 });
});

test("translations and daily allowance survive a server restart", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "volta-translation-test-"));
  const cacheFile = path.join(directory, "cache.json");
  try {
    const options = { cacheFile, env: { INGREDIENT_TRANSLATION_DAILY_LIMIT: "1" }, now: () => Date.UTC(2026, 8, 12) };
    const first = createIngredientTranslator({ ...options, fetchImpl: async () => memoryResponse("Chicken") });
    await first(request);
    const restarted = createIngredientTranslator({ ...options, fetchImpl: () => assert.fail("unexpected external request") });
    assert.equal((await restarted(request)).cached, true);
    await assert.rejects(restarted({ ...request, name: "Pollo asado" }), { status: 429 });
  } finally { fs.unlinkSync(cacheFile); fs.rmdirSync(directory); }
});

test("explicitly disabling translation makes no external request", async () => {
  const translate = createIngredientTranslator({ env: { INGREDIENT_TRANSLATION_ENABLED: "false" }, fetchImpl: () => assert.fail("unexpected request") });
  await assert.rejects(translate(request), /desactivada/);
});

test("an older four-language cache requests only Arabic and Simplified Chinese", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "volta-translation-upgrade-"));
  const cacheFile = path.join(directory, "cache.json");
  try {
    const oldNames = { en: names.en, it: names.it, fr: names.fr, pt: names.pt };
    fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, day: "2026-09-12", requests: 1, characters: 44,
      entries: [[JSON.stringify(["mymemory", "v1", request.name, request.category]), oldNames]],
    }));
    const pairs = [];
    const translate = createIngredientTranslator({ cacheFile, env: { INGREDIENT_TRANSLATION_CHARACTER_LIMIT: "66" }, now: () => Date.UTC(2026, 8, 12),
      fetchImpl: async (input) => {
        const pair = new URL(input).searchParams.get("langpair"); pairs.push(pair);
        return memoryResponse(pair === "es|ar" ? names.ar : names.zh);
      },
    });
    const result = await translate(request);
    assert.deepEqual(pairs, ["es|ar", "es|zh-CN"]);
    assert.deepEqual(result.translations.map((item) => item.name), [request.name, ...Object.values(names)]);
    assert.equal((await translate(request)).cached, true);
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, "utf8")).characters, 66);
  } finally { fs.unlinkSync(cacheFile); fs.rmdirSync(directory); }
});

const photo = { mimetype: "image/png", buffer: Buffer.from("test-image") };
const uploaded = { image: "https://example.test/photo.png", imagePublicId: "test-photo" };
test("onboarding saves an uploaded photo with the languages, pending visual review", async () => {
  let creation; let uploads = 0;
  const prisma = { $transaction: async (run) => run({
    ingredientSemanticCategory: { findUnique: async () => ({ id: 7 }) },
    ingredient: { findMany: async () => [], create: async (args) => { creation = args.data; return { id: 42, ...args.data }; } },
  }) };
  const result = await onboardIngredientWithImage({ prisma, body: body(), file: photo,
    uploadImage: async (file) => { uploads++; assert.equal(file, photo); return uploaded; },
    deleteImage: () => assert.fail("should retain linked image"),
  });
  assert.equal(uploads, 1); assert.equal(result.image, uploaded.image);
  assert.equal(creation.imageSource, "MANUAL_UPLOAD"); assert.equal(creation.imageStatus, "GENERATED");
  assert.equal(creation.imageReviewedAt, null); assert.equal(creation.translations.create.length, 7);
});

test("photo failures create no ingredient, while database failures remove the unlinked upload", async () => {
  let transactions = 0; const removed = [];
  const prisma = { $transaction: async () => { transactions++; throw Object.assign(new Error("duplicate"), { code: "P2002" }); } };
  await assert.rejects(onboardIngredientWithImage({ prisma, body: body(), file: photo,
    uploadImage: async () => { throw new Error("upload failed"); }, deleteImage: async (id) => removed.push(id),
  }), /upload failed/);
  assert.equal(transactions, 0); assert.deepEqual(removed, []);
  await assert.rejects(onboardIngredientWithImage({ prisma, body: body(), file: photo,
    uploadImage: async () => uploaded, deleteImage: async (id) => removed.push(id),
  }), { status: 409 });
  assert.equal(transactions, 1); assert.deepEqual(removed, [uploaded.imagePublicId]);
});

test("photo remains optional and invalid language data is rejected before uploading", async () => {
  const prisma = { $transaction: async () => ({ id: 9 }) };
  const uploadImage = () => assert.fail("unexpected photo upload");
  assert.deepEqual(await onboardIngredientWithImage({ prisma, body: body(), uploadImage }), { id: 9 });
  await assert.rejects(onboardIngredientWithImage({ prisma, body: { ...body(), translations: [] }, file: photo, uploadImage }), { status: 400 });
});
