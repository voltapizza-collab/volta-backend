import test from "node:test";
import assert from "node:assert/strict";
import { loadStoredLogo } from "../services/partnerLogoStorage.js";
import { LOGO_MAX_BYTES } from "../services/logoImageProcessing.js";

const partner = { id: 7, brandLogoPublicId: "volta/partners/7/branding/old", brandLogoUrl: "https://res.cloudinary.com/test/image/upload/v1/volta/partners/7/branding/old.jpg" };
test("only the stored asset for the requested business is fetched, with a timeout and no redirects", async () => {
  const calls = [];
  const result = await loadStoredLogo(partner, async (...args) => { calls.push(args); return new Response("image"); });
  assert.equal(result.buffer.toString(), "image");
  assert.equal(calls[0][0], partner.brandLogoUrl);
  assert.equal(calls[0][1].redirect, "error");
  assert.ok(calls[0][1].signal);
});

test("other hosts and cross-business paths cannot be fetched", async () => {
  for (const url of ["http://127.0.0.1/secret", partner.brandLogoUrl.replace("res.cloudinary.com", "example.com"), partner.brandLogoUrl.replace("/partners/7/", "/partners/8/")]) {
    await assert.rejects(loadStoredLogo({ ...partner, brandLogoUrl: url }, () => assert.fail("must not fetch")), { status: 400 });
  }
});

test("oversized stored images are bounded even when their server omits content-length", async () => {
  await assert.rejects(loadStoredLogo(partner, async () => new Response(Buffer.alloc(LOGO_MAX_BYTES + 1))), { status: 413 });
});
