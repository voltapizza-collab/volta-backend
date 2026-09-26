import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';

const config = JSON.parse(fs.readFileSync(new URL('../.cache/ingredient-taxonomy-sandbox/local.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(validateSandboxUrl(config.url));
const result = spawnSync('C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqladmin.exe', [
  '--protocol=TCP', `--host=${url.hostname}`, `--port=${url.port}`, `--user=${decodeURIComponent(url.username)}`, 'shutdown',
], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, windowsHide: true, timeout: 30000 });
if (result.error || result.status !== 0) { console.error('Could not stop the isolated MySQL sandbox.'); process.exitCode = 1; }
else console.log('Isolated taxonomy MySQL stopped. The source database was not contacted.');
