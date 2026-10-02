import test from "node:test";
import assert from "node:assert/strict";
import { replacePartnerLogo } from "../services/partnerLogo.js";

function fixture(failure) {
  const events = [];
  const next = { url: "https://example.com/new.png", publicId: "new" };
  return { events, next, options: {
    partner: { brandLogoPublicId: "old", brandLogoOriginalPublicId: "old-original" },
    upload: async () => { events.push("upload"); if (failure === "upload") throw new Error(failure); return next; },
    save: async (logo) => { assert.equal(logo, next); events.push("save"); if (failure === "save") throw new Error(failure); },
    remove: async (id) => { assert.equal(id, "old"); events.push("remove"); if (failure === "remove") throw new Error(failure); },
    onCleanupError: () => events.push("cleanup-error"),
  } };
}

for (const failure of ["upload", "save"]) {
  test(`a failed ${failure} preserves the previous logo`, async () => {
    const f = fixture(failure);
    await assert.rejects(replacePartnerLogo(f.options), new RegExp(failure));
    assert.ok(!f.events.includes("remove"));
  });
}

test("the previous asset is removed only after the replacement is saved", async () => {
  const f = fixture();
  assert.equal(await replacePartnerLogo(f.options), f.next);
  assert.deepEqual(f.events, ["upload", "save", "remove"]);
});

test("cleanup failure does not report a successfully saved logo as failed", async () => {
  const f = fixture("remove");
  assert.equal(await replacePartnerLogo(f.options), f.next);
  assert.deepEqual(f.events, ["upload", "save", "remove", "cleanup-error"]);
});

test("first uploads and unchanged asset IDs do not delete an image", async () => {
  for (const brandLogoPublicId of [null, "new"]) {
    const f = fixture();
    f.options.partner.brandLogoPublicId = brandLogoPublicId;
    await replacePartnerLogo(f.options);
    assert.deepEqual(f.events, ["upload", "save"]);
  }
});
