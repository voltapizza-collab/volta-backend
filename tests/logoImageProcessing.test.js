import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareLogo, LOGO_MAX_BYTES } from "../services/logoImageProcessing.js";

async function fixture({ transparent = false, background = [255, 255, 255], complex = false } = {}) {
  const size = 100;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const inside = x >= 25 && x < 75 && y >= 25 && y < 75;
    const whiteLetter = x >= 40 && x < 60 && y >= 40 && y < 60;
    const colour = inside ? (whiteLetter ? [255, 255, 255] : [170, 0, 80]) : complex ? [x * 2, y * 2, 100] : background;
    pixels.set([...colour, transparent && !inside ? 0 : 255], i);
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}
const decoded = buffer => sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test("only connected exterior background is removed; enclosed white lettering and colours survive the crop", async () => {
  const input = await fixture();
  const before = Buffer.from(input);
  const result = await prepareLogo(input);
  assert.equal(result.status, "background_removed");
  assert.equal(result.width, 54);
  assert.equal(result.height, 54);
  const { data, info } = await decoded(result.buffer);
  assert.equal(data[3], 0);
  assert.deepEqual([...data.subarray((27 * info.width + 27) * 4, (27 * info.width + 27) * 4 + 4)], [255, 255, 255, 255]);
  assert.deepEqual([...data.subarray((10 * info.width + 10) * 4, (10 * info.width + 10) * 4 + 4)], [170, 0, 80, 255]);
  assert.deepEqual(input, before);
});

test("coloured uniform backgrounds can be removed without a brand-specific rule", async () => {
  assert.equal((await prepareLogo(await fixture({ background: [0, 200, 80] }))).status, "background_removed");
});

test("rounded artwork touching every edge loses white corners but keeps its outline and enclosed whites", async () => {
  const size = 100;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const corner = Math.hypot(x - Math.max(20, Math.min(79, x)), y - Math.max(20, Math.min(79, y))) > 20;
    const letter = x >= 40 && x < 60 && y >= 40 && y < 60;
    pixels.set([...(corner || letter ? [255, 255, 255] : [255, 230, 0]), 255], (y * size + x) * 4);
  }
  const input = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const result = await prepareLogo(input);
  assert.equal(result.status, "background_removed");
  const { data, info } = await decoded(result.buffer);
  const at = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.equal(at(3, 3)[3], 0);
  assert.deepEqual(at(52, 3), [255, 230, 0, 255]);
  assert.deepEqual(at(52, 52), [255, 255, 255, 255]);

  // One white corner alone must not cause a colourful background to be erased.
  pixels.set([0, 30, 180, 255], 0);
  const uncertain = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  assert.equal((await prepareLogo(uncertain)).status, "needs_review");
});

test("existing transparency protects white artwork and still trims empty margins", async () => {
  const result = await prepareLogo(await fixture({ transparent: true }));
  assert.equal(result.status, "transparent");
  assert.equal(result.width, 54);
  const { data, info } = await decoded(result.buffer);
  assert.equal(data[(27 * info.width + 27) * 4 + 3], 255);
});

test("ambiguous backgrounds are kept and marked for review", async () => {
  const result = await prepareLogo(await fixture({ complex: true }));
  assert.equal(result.status, "needs_review");
  assert.equal(result.width, 100);
  assert.equal((await decoded(result.buffer)).data[3], 255);
});

test("the user can preserve a uniform background", async () => {
  const result = await prepareLogo(await fixture(), { removeBackground: false });
  assert.equal(result.status, "original");
  assert.equal(result.width, 100);
  assert.equal((await decoded(result.buffer)).data[3], 255);
});

test("invalid, oversized, animated/unsupported and empty images fail before upload", async () => {
  for (const input of [Buffer.from("not an image"), Buffer.alloc(LOGO_MAX_BYTES + 1), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')]) {
    await assert.rejects(prepareLogo(input), error => [400, 413].includes(error.status));
  }
  const empty = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(prepareLogo(empty), /vacía/);
  const white = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  assert.equal((await prepareLogo(white)).status, "needs_review");
});

test("EXIF orientation is applied before preparing the output", async () => {
  const input = await sharp(await fixture()).resize(100, 50).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepareLogo(input, { removeBackground: false });
  assert.equal(result.width, 50);
  assert.equal(result.height, 100);
});
