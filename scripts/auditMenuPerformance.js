import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import { performance } from 'node:perf_hooks';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';
process.env.DATABASE_URL = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
process.env.TELNYX_API_KEY = ''; process.env.STRIPE_SECRET_KEY = '';
const { PrismaClient } = await import('@prisma/client');
const { default: stores } = await import('../routes/stores.js');
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const before = tableDigests(await captureTables(prisma));
let queries = [];
prisma.$on('query', event => queries.push({ durationMs: event.duration, operation: event.query.trim().split(/\s+/)[0] }));
const app = express(); app.use('/stores', stores(prisma));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const target = await prisma.store.findFirst({ where: { active: true, latitude: { not: null }, longitude: { not: null } }, include: { partner: { select: { slug: true } } } });
const url = `http://127.0.0.1:${server.address().port}/stores/${target.partner.slug}/${target.slug}/menu`;
const request = async () => {
  const start = performance.now(); const response = await fetch(url); const payload = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  return { durationMs: Math.round(performance.now() - start), dishes: payload.menu.length };
};
try {
  queries = []; const cold = await request(); const coldQueries = queries;
  queries = []; const warm = await request(); const warmQueries = queries;
  queries = []; const started = performance.now();
  const concurrent = await Promise.all(Array.from({ length: 12 }, request));
  const batchMs = Math.round(performance.now() - started);
  const durations = concurrent.map(row => row.durationMs).sort((a,b) => a-b);
  const report = { verifiedAt: new Date().toISOString(), environment: 'isolated_loopback_copy', cold: { ...cold, sqlQueries: coldQueries.length }, warm: { ...warm, sqlQueries: warmQueries.length }, concurrent: { requests: 12, batchMs, p50: durations[5], p95: durations[11], sqlQueries: queries.length }, writesObserved: [...coldQueries, ...warmQueries, ...queries].filter(q => !['SELECT', 'SHOW'].includes(q.operation)).map(q => q.operation) };
  const label = process.argv[2] || 'current'; assert.match(label, /^[a-z-]+$/);
  fs.writeFileSync(new URL(`../docs/menu-performance-${label}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  assert.deepEqual(tableDigests(await captureTables(prisma)), before);
  await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
}
