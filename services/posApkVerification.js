import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { MAX_APK_BYTES } from './posReleaseStorage.js';

export function validatePublication(metadata, bytes, expectedCertificate) {
  if (!/^[a-f0-9]{64}$/.test(expectedCertificate || '')) throw Error('Set POS_APK_CERTIFICATE_SHA256 to the approved signing certificate');
  if (metadata.packageName !== 'com.volta.poslab' || !Number.isSafeInteger(metadata.versionCode) || metadata.versionCode < 1 ||
      typeof metadata.versionName !== 'string' || !metadata.versionName.trim() || metadata.versionName.length > 80 ||
      typeof metadata.title !== 'string' || !metadata.title.trim() || metadata.title.length > 160 ||
      typeof metadata.releaseNotes !== 'string' || !metadata.releaseNotes.trim() || metadata.releaseNotes.length > 6000 ||
      bytes.length <= 0 || bytes.length > MAX_APK_BYTES || metadata.certificateSha256 !== expectedCertificate)
    throw Error('Invalid release metadata or signing certificate');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if ((metadata.sha256 && metadata.sha256 !== sha256) || (metadata.size != null && metadata.size !== bytes.length))
    throw Error('APK does not match release metadata');
  return { packageName: metadata.packageName, versionCode: metadata.versionCode, versionName: metadata.versionName,
    title: metadata.title.trim(), releaseNotes: metadata.releaseNotes.trim(), certificateSha256: expectedCertificate,
    sha256, size: bytes.length };
}

export function verifyApkFile(apkPath, release, { buildTools, java = 'java' }) {
  if (!buildTools) throw Error('Set ANDROID_BUILD_TOOLS to the Android SDK build-tools directory');
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (result.error || result.status !== 0) throw Error('Android APK verification failed');
    return result.stdout;
  };
  const cert = run(java, ['-jar', path.join(buildTools, 'lib', 'apksigner.jar'), 'verify', '--print-certs', apkPath]);
  const digests = [...cert.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)/gi)].map(match => match[1].toLowerCase());
  if (digests.length !== 1 || digests[0] !== release.certificateSha256) throw Error('APK signer does not match the approved certificate');
  const badging = run(path.join(buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'), ['dump', 'badging', apkPath]);
  const info = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  if (!info || info[1] !== release.packageName || Number(info[2]) !== release.versionCode || info[3] !== release.versionName)
    throw Error('APK package/version does not match release metadata');
}
