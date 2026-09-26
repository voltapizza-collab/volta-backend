import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';

const url = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
const destination = new URL(url);
const directory = process.argv[2];
assert.ok(directory, 'Pass the private snapshot directory');
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'snapshot.json'), 'utf8'));
const bytes = fs.readFileSync(path.join(directory, 'source.sql'));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), metadata.sha256, 'Snapshot checksum mismatch');
assert.equal(metadata.method, 'mysqldump --single-transaction');
// The source export deliberately does not use --databases or --all-databases.
assert.ok(!/^\s*(?:CREATE|DROP)\s+DATABASE\b|^\s*USE\s+/im.test(bytes.toString('utf8')), 'Refusing cross-database SQL');
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  assert.equal((await prisma.$queryRawUnsafe('SHOW TABLES')).length, 0, 'Refusing to overwrite an existing sandbox database');
  const result = spawnSync(process.env.TAXONOMY_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe', [
    '--protocol=TCP', '--host=127.0.0.1', `--port=${destination.port || '3306'}`,
    `--user=${decodeURIComponent(destination.username)}`, '--default-character-set=utf8mb4', 'ingredient_taxonomy_rehearsal',
  ], { input: bytes, env: { ...process.env, MYSQL_PWD: decodeURIComponent(destination.password) }, windowsHide: true, timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`Sandbox import failed (exit ${result.status}); inspect this isolated database before retrying`);
  console.log(JSON.stringify({ imported: true, tables: (await prisma.$queryRawUnsafe('SHOW TABLES')).length, sourceSha256: metadata.sha256 }));
} finally { await prisma.$disconnect(); }
