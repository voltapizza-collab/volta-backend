import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import {
  configureCloudinaryFromEnv,
  hasCloudinaryCredentials,
  assertCloudinaryConfigured,
} from "../services/cloudinaryConfig.js";

const CLOUDINARY_ENV_KEYS = [
  "CLOUDINARY_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const snapshotEnv = () =>
  Object.fromEntries(CLOUDINARY_ENV_KEYS.map((key) => [key, process.env[key]]));

const restoreEnv = (snapshot) => {
  CLOUDINARY_ENV_KEYS.forEach((key) => {
    if (snapshot[key] == null) delete process.env[key];
    else process.env[key] = snapshot[key];
  });
  cloudinary.config(true);
};

const clearCloudinaryEnv = () => {
  CLOUDINARY_ENV_KEYS.forEach((key) => delete process.env[key]);
};

test("cloudinary config supports CLOUDINARY_URL", () => {
  const env = snapshotEnv();
  try {
    clearCloudinaryEnv();
    process.env.CLOUDINARY_URL = "cloudinary://key:secret@demo-cloud";

    const config = configureCloudinaryFromEnv();

    assert.equal(config.cloud_name, "demo-cloud");
    assert.equal(config.api_key, "key");
    assert.equal(config.api_secret, "secret");
    assert.equal(hasCloudinaryCredentials(), true);
  } finally {
    restoreEnv(env);
  }
});

test("cloudinary config supports separate credential variables", () => {
  const env = snapshotEnv();
  try {
    clearCloudinaryEnv();
    process.env.CLOUDINARY_CLOUD_NAME = "separate-cloud";
    process.env.CLOUDINARY_API_KEY = "separate-key";
    process.env.CLOUDINARY_API_SECRET = "separate-secret";

    const config = configureCloudinaryFromEnv();

    assert.equal(config.cloud_name, "separate-cloud");
    assert.equal(config.api_key, "separate-key");
    assert.equal(config.api_secret, "separate-secret");
    assert.equal(hasCloudinaryCredentials(), true);
  } finally {
    restoreEnv(env);
  }
});

test("cloudinary config throws a typed error when credentials are missing", () => {
  const env = snapshotEnv();
  try {
    clearCloudinaryEnv();

    assert.throws(
      () => assertCloudinaryConfigured(),
      (error) =>
        error.status === 503 &&
        error.code === "IMAGE_UPLOAD_NOT_CONFIGURED" &&
        error.message === "Cloudinary not configured"
    );
  } finally {
    restoreEnv(env);
  }
});
