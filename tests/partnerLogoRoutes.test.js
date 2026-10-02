import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { createPartnerLogoRouter } from "../routes/partnerLogo.js";

const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: "white" } })
  .composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 3, background: "red" } }).png().toBuffer(), left: 20, top: 20 }]).png().toBuffer();

async function fixture(t, fail) {
  let partner = { id: 7, brandLogoUrl: "https://example.com/old.png", brandLogoPublicId: "old", brandLogoOriginalPublicId: "old-original", brandLogoOriginalUrl: "https://example.com/original.png" };
  const uploaded = [], removed = [], saved = [], loaded = [];
  const app = express();
  app.use("/partners/by-id/:partnerId/logo", createPartnerLogoRouter({
    getPartner: async id => id === 7 ? partner : null,
    loadOriginal: async value => { loaded.push(value); return { buffer: image }; },
    saveLogo: async (id, logo) => {
      if (fail === "save") throw new Error("database unavailable");
      saved.push(logo);
      partner = { ...partner, brandLogoUrl: logo.url, brandLogoPublicId: logo.publicId,
        brandLogoOriginalUrl: logo.originalUrl, brandLogoOriginalPublicId: logo.originalPublicId, brandLogoProcessing: logo.status };
    },
    uploadAsset: async (buffer, id, kind) => {
      if (fail === kind) throw new Error("upload unavailable");
      uploaded.push({ buffer, kind, id });
      return { url: `https://example.com/${kind}.png`, publicId: kind };
    },
    removeAsset: async id => removed.push(id),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/partners/by-id/7/logo`;
  const post = (suffix = "", body) => {
    if (!body) { body = new FormData(); body.set("logo", new Blob([image], { type: "image/png" }), "logo.png"); }
    return fetch(`${base}${suffix}`, { method: "POST", body });
  };
  return { base, post, uploaded, removed, saved, loaded, setPartner: value => { partner = value; } };
}

test("preview processes actual pixels without uploading assets or saving the business", async t => {
  const f = await fixture(t);
  const res = await f.post("/preview");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.equal(body.status, "background_removed");
  const png = Buffer.from(body.previewUrl.split(",")[1], "base64");
  assert.equal((await sharp(png).metadata()).format, "png");
  assert.equal(f.uploaded.length + f.saved.length + f.removed.length, 0);
});

test("saving retains the exact original and stores the prepared PNG as the canonical logo", async t => {
  const f = await fixture(t);
  const res = await f.post();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(f.uploaded[0].buffer, image);
  assert.equal(f.uploaded[1].kind, "prepared");
  assert.equal(body.brandLogoUrl, "https://example.com/prepared.png");
  assert.equal(body.brandLogoOriginalUrl, "https://example.com/originals.png");
  assert.equal(body.brandLogoProcessing, "background_removed");
  assert.deepEqual(f.removed, ["old"]);
});

for (const fail of ["prepared", "save"]) test(`failure at ${fail} cleans up new assets and preserves the current logo`, async t => {
  const f = await fixture(t, fail);
  const res = await f.post();
  assert.equal(res.status, 500);
  assert.equal(f.saved.length, 0);
  assert.ok(!f.removed.includes("old"));
  assert.ok(f.removed.includes("originals"));
  if (fail === "save") assert.ok(f.removed.includes("prepared"));
});

test("existing logos use their saved original and reject a stale preview", async t => {
  const f = await fixture(t);
  const preview = await (await f.post("/preview-current", new URLSearchParams())).json();
  assert.equal(preview.sourceId, "old-original");
  const stale = await fetch(`${f.base}/process-current`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: "changed" }) });
  assert.equal(stale.status, 409);
  const res = await fetch(`${f.base}/process-current`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: preview.sourceId }) });
  assert.equal(res.status, 200);
  assert.deepEqual(f.uploaded.map(item => item.kind), ["prepared"]);
  assert.equal((await res.json()).brandLogoOriginalPublicId, "old-original");
});

test("legacy originals are retained rather than deleted on their first processing", async t => {
  const f = await fixture(t);
  f.setPartner({ id: 7, brandLogoUrl: "https://example.com/old.png", brandLogoPublicId: "old" });
  const res = await fetch(`${f.base}/process-current`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: "old" }) });
  assert.equal(res.status, 200);
  assert.deepEqual(f.removed, []);
  assert.equal((await res.json()).brandLogoOriginalPublicId, "old");
});

test("missing and corrupt files do not replace the current logo", async t => {
  const f = await fixture(t);
  assert.equal((await f.post("", new FormData())).status, 400);
  const body = new FormData(); body.set("logo", new Blob(["corrupt"]), "logo.png");
  assert.equal((await f.post("", body)).status, 400);
  assert.equal(f.uploaded.length, 0);
});
