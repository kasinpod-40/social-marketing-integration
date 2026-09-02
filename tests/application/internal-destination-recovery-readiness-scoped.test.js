import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SCRIPT = new URL('../../scripts/internal-destination-recovery-readiness-scoped.mjs', import.meta.url);

test('scoped destination readiness preserves the non-mutating plan contract', () => {
  const result = spawnSync(process.execPath, [SCRIPT.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      TIKTOK_SOURCE_HANDLE: 'legacy-unrelated-handle',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.status, 'INTERNAL_DESTINATION_RECOVERY_READINESS_PLAN');
  assert.equal(payload.providerReads, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.larkWrites, 0);
  assert.equal(payload.queueSends, 0);
  assert.equal(payload.customerBaseReads, 0);
  assert.equal(payload.customerBaseWrites, 0);
  assert.equal(payload.persistentConfigWrites, 0);
});

test('scoped destination readiness shadows only the unrelated TikTok source handle', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /internal-destination-recovery-readiness\.mjs/u);
  assert.match(source, /TIKTOK_SOURCE_HANDLE:\s*'chemistry_k'/u);
  assert.match(source, /\.\.\.process\.env/u);
  assert.match(source, /spawnSync\(process\.execPath/u);
  assert.doesNotMatch(source, /MKT_CUSTOMER_PROFILE:\s*['"]/u);
  assert.doesNotMatch(source, /MKT_ENV:\s*['"]/u);
  assert.doesNotMatch(source, /MKT_CONNECTOR_(?:FACEBOOK|YOUTUBE)_ENABLED/u);
  assert.doesNotMatch(source, /providerReads:\s*[1-9]/u);
  assert.doesNotMatch(source, /d1Writes:\s*[1-9]/u);
  assert.doesNotMatch(source, /larkWrites:\s*[1-9]/u);
  assert.doesNotMatch(source, /queueSends:\s*[1-9]/u);
  assert.doesNotMatch(source, /customerBaseReads:\s*[1-9]/u);
  assert.doesNotMatch(source, /customerBaseWrites:\s*[1-9]/u);
  assert.doesNotMatch(source, /persistentConfigWrites:\s*[1-9]/u);
});
