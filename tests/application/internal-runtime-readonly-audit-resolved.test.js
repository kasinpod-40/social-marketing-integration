import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SCRIPT = new URL('../../scripts/internal-runtime-readonly-audit-resolved.mjs', import.meta.url);

test('resolved internal audit plan is read-only and exact-name scoped', () => {
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
  assert.equal(payload.resolutionMode, 'wrangler-d1-list-exact-name');
  assert.equal(payload.localConfigWrites, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.customerBaseWrites, 0);
});

test('resolved internal audit only resolves exact internal D1 and uses an ephemeral config', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /const TARGET_DATABASE = 'social-mkt-state-dev'/u);
  assert.match(source, /const TARGET_BINDING = 'MKT_STATE_DB'/u);
  assert.match(source, /'wrangler', 'd1', 'list', '--json'/u);
  assert.match(source, /item\?\.name === TARGET_DATABASE/u);
  assert.match(source, /exact\.length !== 1/u);
  assert.match(source, /database_id: resolvedId/u);
  assert.match(source, /\.tmp-internal-runtime-audit-/u);
  assert.match(source, /await rm\(tempConfigPath, \{ force: true \}\)/u);
  assert.match(source, /persistentConfigChanged:\s*false/u);
  assert.doesNotMatch(source, /sync_work_units/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /chemistry_k/u);
});

test('resolved internal audit delegates to the existing reviewed audit instead of duplicating business queries', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /internal-runtime-readonly-audit\.mjs/u);
  assert.match(source, /CONFIRM_INTERNAL_RUNTIME_READONLY_AUDIT:\s*'AUDIT_INTERNAL_RUNTIME_READONLY'/u);
  assert.match(source, /WRANGLER_CONFIG:\s*tempConfigPath/u);
  assert.doesNotMatch(source, /FROM\s+sync_work_runs/iu);
  assert.doesNotMatch(source, /FROM\s+data_coverage_runs/iu);
  assert.doesNotMatch(source, /FROM\s+report_materializations/iu);
});
