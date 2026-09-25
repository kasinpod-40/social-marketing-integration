#!/usr/bin/env node
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { buildRuntimeConfigCutoverPlan } from './lib/runtime-config-d1-cutover.js';

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(args.config ?? 'wrangler.sync.jsonc');
const sourceText = await readFile(configPath, 'utf8');
const extraValues = {};
if (args.tiktokAppId) extraValues.TIKTOK_ADS_APP_ID = args.tiktokAppId;
const plan = buildRuntimeConfigCutoverPlan({ sourceText, extraValues });

console.log(JSON.stringify({
  ok: true,
  mode: args.execute ? 'execute' : 'preview',
  configPath,
  databaseName: plan.databaseName,
  environment: plan.environment,
  customerKey: plan.customerKey,
  d1Rows: plan.rows.length,
  bindingsFreed: plan.removableKeys.length,
  keys: plan.rows.map((row) => row.configKey),
}, null, 2));

if (!args.execute) process.exit(0);

await run('npx', [
  'wrangler', 'd1', 'migrations', 'apply', plan.databaseName,
  '--remote', '--config', configPath,
]);

const tempDir = await mkdtemp(join(tmpdir(), 'mkt-runtime-config-'));
const sqlPath = join(tempDir, 'runtime-config-cutover.sql');
await writeFile(sqlPath, plan.sql, { encoding: 'utf8', mode: 0o600 });
await run('npx', [
  'wrangler', 'd1', 'execute', plan.databaseName,
  '--remote', '--config', configPath, '--file', sqlPath,
]);

const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const backupPath = join(dirname(configPath), `${basename(configPath)}.pre-d1-runtime-${stamp}.bak`);
await writeFile(backupPath, sourceText, { encoding: 'utf8', mode: 0o600 });
const tempConfigPath = join(dirname(configPath), `.${basename(configPath)}.runtime-config.tmp`);
await writeFile(tempConfigPath, plan.prunedSourceText, { encoding: 'utf8', mode: 0o600 });
await rename(tempConfigPath, configPath);

console.log(JSON.stringify({
  ok: true,
  mode: 'execute_complete',
  backupPath,
  configPath,
  d1Rows: plan.rows.length,
  bindingsFreed: plan.removableKeys.length,
  productionTrafficChanged: false,
  next: 'Run wrangler versions upload, then put TIKTOK_ADS_APP_SECRET, then verify before deploy.',
}, null, 2));

function parseArgs(argv) {
  const result = { execute: false, config: null, tiktokAppId: null };
  for (const arg of argv) {
    if (arg === '--execute') result.execute = true;
    else if (arg.startsWith('--config=')) result.config = arg.slice('--config='.length);
    else if (arg.startsWith('--tiktok-app-id=')) result.tiktokAppId = arg.slice('--tiktok-app-id='.length);
    else throw new TypeError(`Unknown argument: ${arg}`);
  }
  return result;
}

function run(command, argv) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argv, { stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
