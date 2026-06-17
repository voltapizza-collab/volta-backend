import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPosPinData,
  decryptPin,
  encryptPin,
  generateSixDigitPin,
  hashSecret,
  isSixDigitPin,
  verifySecret,
} from "../services/posCredentials.js";

test("generateSixDigitPin returns a six digit numeric PIN", () => {
  for (let index = 0; index < 25; index += 1) {
    assert.match(generateSixDigitPin(), /^\d{6}$/);
  }
});

test("isSixDigitPin accepts only six numeric digits", () => {
  assert.equal(isSixDigitPin("123456"), true);
  assert.equal(isSixDigitPin("012345"), true);
  assert.equal(isSixDigitPin("12345"), false);
  assert.equal(isSixDigitPin("1234567"), false);
  assert.equal(isSixDigitPin("abc123"), false);
});

test("hashSecret verifies the original PIN without storing it directly", () => {
  const hash = hashSecret("482913");

  assert.notEqual(hash, "482913");
  assert.equal(verifySecret("482913", hash), true);
  assert.equal(verifySecret("482914", hash), false);
});

test("encryptPin stores a recoverable PIN without plaintext", () => {
  const encrypted = encryptPin("482913");

  assert.notEqual(encrypted, "482913");
  assert.equal(decryptPin(encrypted), "482913");
});

test("buildPosPinData creates hash and encrypted values for the same PIN", () => {
  const data = buildPosPinData("730184");

  assert.equal(verifySecret("730184", data.posPinHash), true);
  assert.equal(decryptPin(data.posPinEncrypted), "730184");
  assert.equal(data.posCredentialsEnabled, true);
  assert.ok(data.posPinUpdatedAt instanceof Date);
});
