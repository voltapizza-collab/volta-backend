// Read-only source export. This command never imports a dump or changes the source database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import prisma from '../services/prisma.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.resolve('.cache', 'ingredient-taxonomy', stamp);
try {
  const source = new URL(process.env.DATABASE_URL);
  if (source.protocol !== 'mysql:') throw new Error('Expected MySQL source');
  fs.mkdirSync(directory, { recursive: true });
  const executable = process.env.TAXONOMY_MYSQLDUMP || 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe';
  const dump = path.join(directory, 'source.sql');
  const result = spawnSync(executable, [
    '--protocol=TCP', `--host=${source.hostname}`, `--port=${source.port || '3306'}`,
    `--user=${decodeURIComponent(source.username)}`, '--single-transaction', '--skip-lock-tables',
    '--no-tablespaces', '--set-gtid-purged=OFF', '--column-statistics=0', '--hex-blob',
    '--skip-add-locks', '--skip-comments', `--result-file=${dump}`,
    decodeURIComponent(source.pathname.slice(1)),
  ], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(source.password) }, windowsHide: true, timeout: 300000 });
  if (result.error || result.status !== 0) {
    let diagnostic = String(result.stderr || result.error?.code || '').slice(0, 1000);
    for (const secret of [source.href, source.hostname, decodeURIComponent(source.username), decodeURIComponent(source.password)].filter(Boolean)) diagnostic = diagnostic.replaceAll(secret, '[redacted]');
    throw new Error(`Source export failed (exit ${result.status}); no source writes were attempted. ${diagnostic}`);
  }
  const bytes = fs.readFileSync(dump);
  const metadata = { capturedAt: new Date().toISOString(), method: 'mysqldump --single-transaction',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    sourceWasLoopback: ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname),
    sourceConnectionCredentialsStored: false, privateBusinessData: true };
  fs.writeFileSync(path.join(directory, 'snapshot.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify({ directory, ...metadata }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
