import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DIAG = new URL('../../scripts/internal-d1-read-diagnosis.mjs', import.meta.url);

test('internal D1 diagnosis plan is explicit about zero mutations and customer Base isolation', () => {
  const result = spawnSync(process.execPath, [DIAG.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.status, 'INTERNAL_D1_READ_DIAGNOSIS_PLAN');
  assert.equal(payload.targetDatabase, 'social-mkt-state-dev');
  assert.equal(payload.providerReads, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.larkReads, 0);
  assert.equal(payload.larkWrites, 0);
  assert.equal(payload.queueSends, 0);
  assert.equal(payload.customerBaseReads, 0);
  assert.equal(payload.customerBaseWrites, 0);
});

test('internal D1 diagnosis is pinned to one safe remote SELECT probe', async () => {
  const source = await readFile(DIAG, 'utf8');
  assert.match(source, /const TARGET_DATABASE = 'social-mkt-state-dev'/u);
  assert.match(source, /const TARGET_BINDING = 'MKT_STATE_DB'/u);
  assert.match(source, /const PROBE_SQL = 'SELECT 1 AS audit_probe'/u);
  assert.match(source, /'wrangler', 'd1', 'execute', TARGET_DATABASE/u);
  assert.match(source, /'--remote', '--json'/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM)\b/u);
  assert.doesNotMatch(source, /sync_work_units/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /LARK_APP_SECRET/u);
  assert.doesNotMatch(source, /chemistry_k/u);
});

test('internal D1 diagnosis sanitizes command output before surfacing it', async () => {
  const source = await readFile(DIAG, 'utf8');
  assert.match(source, /Bearer \[REDACTED\]/u);
  assert.match(source, /slice\(-4000\)/u);
  assert.match(source, /spawnError: result\.error \? safeText/u);
  assert.match(source, /stderr: safeText\(result\.stderr\)/u);
  assert.match(source, /stdout: safeText\(result\.stdout\)/u);
});
