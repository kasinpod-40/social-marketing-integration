import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SCRIPT = new URL('../../scripts/internal-runtime-readonly-audit-resolved.mjs', import.meta.url);

test('resolved internal audit plan is read-only and schema-proof scoped', () => {
  const result = spawnSync(process.execPath, [SCRIPT.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.status, 'INTERNAL_RUNTIME_RESOLVED_READONLY_AUDIT_PLAN');
  assert.equal(payload.targetDatabase, 'social-mkt-state-dev');
  assert.equal(payload.resolutionMode, 'exact-name-or-sole-schema-fingerprint');
  assert.equal(payload.schemaFingerprintTableCount, 6);
  assert.equal(payload.localConfigWrites, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.customerBaseWrites, 0);
});

test('resolved internal audit accepts a sole renamed D1 only after internal schema fingerprint proof', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /const TARGET_DATABASE = 'social-mkt-state-dev'/u);
  assert.match(source, /const TARGET_BINDING = 'MKT_STATE_DB'/u);
  assert.match(source, /'wrangler', 'd1', 'list', '--json'/u);
  assert.match(source, /item\?\.name === TARGET_DATABASE/u);
  assert.match(source, /exact\.length === 0 && databases\.length === 1/u);
  assert.match(source, /mode:\s*'wrangler-d1-list-sole-schema-fingerprint'/u);
  assert.match(source, /sync_work_runs/u);
  assert.match(source, /sync_work_phases/u);
  assert.match(source, /sync_generation_fences/u);
  assert.match(source, /sync_locks/u);
  assert.match(source, /sync_runs/u);
  assert.match(source, /d1_migrations/u);
  assert.match(source, /SELECT name FROM sqlite_master WHERE type='table'/u);
  assert.match(source, /INTERNAL_RESOLVED_AUDIT_SCHEMA_MISMATCH/u);
  assert.match(source, /schemaFingerprintMatched:\s*true/u);
});

test('resolved internal audit uses an ephemeral config and never persists the resolved id', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /database_id: resolvedId/u);
  assert.match(source, /\.tmp-internal-runtime-audit-/u);
  assert.match(source, /await rm\(tempConfigPath, \{ force: true \}\)/u);
  assert.match(source, /persistentConfigChanged:\s*false/u);
  assert.doesNotMatch(source, /writeFile\([^,]*wrangler\.sync\.jsonc/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /chemistry_k/u);
});

test('resolved internal audit delegates to the existing reviewed audit after identity proof', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /internal-runtime-readonly-audit\.mjs/u);
  assert.match(source, /CONFIRM_INTERNAL_RUNTIME_READONLY_AUDIT:\s*'AUDIT_INTERNAL_RUNTIME_READONLY'/u);
  assert.match(source, /WRANGLER_CONFIG:\s*tempConfigPath/u);
  assert.doesNotMatch(source, /FROM\s+sync_work_runs/iu);
  assert.doesNotMatch(source, /FROM\s+data_coverage_runs/iu);
  assert.doesNotMatch(source, /FROM\s+report_materializations/iu);
});
