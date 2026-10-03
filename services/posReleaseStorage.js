import crypto from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fail } from './posIdentity.js';

export const MAX_APK_BYTES = 100 * 1024 * 1024;
export const artifactId = sha => `pos/releases/${sha}.apk`;
const cache = new Map();
const inflight = new Map();
const CACHE_BYTES = 64 * 1024 * 1024;
let cachedBytes = 0;
let client;

function storage() {
  const { POS_S3_ENDPOINT: endpoint, POS_S3_BUCKET: bucket, POS_S3_ACCESS_KEY_ID: accessKeyId,
    POS_S3_SECRET_ACCESS_KEY: secretAccessKey, POS_S3_REGION: region = 'auto' } = process.env;
  if (!endpoint?.startsWith('https://') || !bucket || !accessKeyId || !secretAccessKey) throw fail(503, 'update_storage_not_configured');
  if (!client) client = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  return { client, bucket };
}

export function verifyArtifact(bytes, release) {
  if (bytes.length !== release.size || bytes.length > MAX_APK_BYTES ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw fail(503, 'update_artifact_changed');
  return bytes;
}

export async function fetchReleaseArtifact(release, source = storage()) {
  if (!/^[a-f0-9]{64}$/.test(release.sha256) || release.artifactKey !== artifactId(release.sha256) ||
      !Number.isSafeInteger(release.size) || release.size <= 0 || release.size > MAX_APK_BYTES) throw fail(503, 'update_storage_invalid');
  const response = await source.client.send(new GetObjectCommand({ Bucket: source.bucket, Key: release.artifactKey }),
    { abortSignal: AbortSignal.timeout(60000) });
  if (!response.Body) throw fail(503, 'update_storage_unavailable');
  if (response.ContentLength !== release.size) {
    response.Body.destroy?.(); throw fail(503, 'update_artifact_changed');
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.Body) {
    size += chunk.length;
    if (size > release.size) throw fail(503, 'update_artifact_changed');
    chunks.push(chunk);
  }
  return verifyArtifact(Buffer.concat(chunks), release);
}

export async function loadReleaseArtifact(release) {
  const key = release.sha256;
  if (cache.has(key)) {
    const bytes = cache.get(key); cache.delete(key); cache.set(key, bytes);
    return verifyArtifact(bytes, release);
  }
  if (inflight.has(key)) return verifyArtifact(await inflight.get(key), release);
  if (inflight.size >= 2) throw fail(503, 'update_storage_busy');
  const pending = fetchReleaseArtifact(release);
  inflight.set(key, pending);
  try {
    const bytes = await pending;
    if (bytes.length <= CACHE_BYTES) {
      while (cachedBytes + bytes.length > CACHE_BYTES && cache.size) {
        const oldest = cache.keys().next().value;
        cachedBytes -= cache.get(oldest).length; cache.delete(oldest);
      }
      cache.set(key, bytes); cachedBytes += bytes.length;
    }
    return bytes;
  } finally { inflight.delete(key); }
}

export async function uploadReleaseArtifact(bytes, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256) || bytes.length <= 0 || bytes.length > MAX_APK_BYTES) throw fail(400, 'invalid_update_artifact');
  verifyArtifact(bytes, { sha256, size: bytes.length });
  const source = storage();
  const artifactKey = artifactId(sha256);
  try {
    await source.client.send(new PutObjectCommand({ Bucket: source.bucket, Key: artifactKey, Body: bytes,
      ContentType: 'application/vnd.android.package-archive', ContentLength: bytes.length,
      IfNoneMatch: '*', Metadata: { sha256 } }), { abortSignal: AbortSignal.timeout(60000) });
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 412) throw error;
  }
  await fetchReleaseArtifact({ sha256, size: bytes.length, artifactKey }, source);
  return { artifactKey };
}

export async function migrationDownloadUrl(release) {
  if (release.artifactKey !== artifactId(release.sha256)) throw fail(503, 'update_storage_invalid');
  const source = storage();
  return getSignedUrl(source.client, new GetObjectCommand({ Bucket: source.bucket, Key: release.artifactKey,
    ResponseContentDisposition: `attachment; filename="volta-pos-${release.versionCode}.apk"` }), { expiresIn: 3600 });
}
