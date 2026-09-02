import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SCRIPT = new URL('../../scripts/internal-destination-recovery-readiness.mjs', import.meta.url);

test('internal destination readiness plan is non-mutating', () => {
  const result = spawnSync(process.execPath, [SCRIPT.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.status, 'INTERNAL_DESTINATION_RECOVERY_READINESS_PLAN');
  assert.deepEqual(payload.requiredRuntime, {
    environment: 'development',
    profileKey: 'integration_workspace',
    infrastructureOwner: 'developer',
  });
  assert.equal(payload.providerReads, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.larkWrites, 0);
  assert.equal(payload.queueSends, 0);
  assert.equal(payload.customerBaseReads, 0);
  assert.equal(payload.customerBaseWrites, 0);
  assert.equal(payload.persistentConfigWrites, 0);
});

test('internal destination readiness proves developer Integration Workspace before Lark read', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /env\.MKT_ENV !== 'development'/u);
  assert.match(source, /env\.MKT_CUSTOMER_PROFILE !== 'integration_workspace'/u);
  assert.match(source, /runtime\.infrastructureOwner !== 'developer'/u);
  assert.match(source, /integration_workspace_mixed_sources/u);
  assert.match(source, /createLarkBitableClientFromEnv/u);
  assert.match(source, /await client\.listTables\(\)/u);
  assert.match(source, /LARK_TABLE_ENV/u);
  assert.match(source, /mktAccounts/u);
  assert.match(source, /mktContentDaily/u);
  assert.match(source, /INTERNAL_DESTINATION_READINESS_LARK_IDENTITY_MISMATCH/u);
  assert.doesNotMatch(source, /client\.(?:create|update|delete|batchCreate|batchUpdate)/u);
});

test('internal destination readiness locks exact current Facebook and YouTube Work state', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /chemistry_k:facebook:chemistry_k:scheduled_end_to_end/u);
  assert.match(source, /facebook\.page\.organic\.sync/u);
  assert.match(source, /meta_end_to_end_source_staging_v1/u);
  assert.match(source, /meta_end_to_end_d1_write_v1/u);
  assert.match(source, /meta_end_to_end_lark_write_v1/u);
  assert.match(source, /chemistry_k:youtube:chemistry_k:organic_sync/u);
  assert.match(source, /workType: 'youtube_organic_sync'/u);
  assert.match(source, /jobType: 'youtube\.channel\.organic\.sync'/u);
  assert.match(source, /youtube_d1_storage_v1/u);
  assert.match(source, /youtube_destination_content_v1/u);
  assert.match(source, /youtube_destination_daily_v1/u);
  assert.match(source, /sync_generation_fences/u);
  assert.match(source, /active_lock_count/u);
  assert.match(source, /currentFence:\s*true/u);
});

test('internal destination readiness reads only exact queue envelope identity and never emits raw payload', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /dead_letter_jobs/u);
  assert.match(source, /json_extract\(replay_json, '\$\.workKey'\)/u);
  assert.match(source, /json_extract\(payload_json_valid, '\$\.workKey'\)/u);
  assert.match(source, /WHERE work_key IN/u);
  assert.match(source, /operation_id/u);
  assert.match(source, /durableQueueIdentityAvailable/u);
  assert.match(source, /businessPayloadReads:\s*0/u);
  assert.doesNotMatch(source, /replayJson:\s*row/u);
  assert.doesNotMatch(source, /payloadJson:\s*row/u);
  assert.doesNotMatch(source, /providerReads:\s*[1-9]/u);
  assert.doesNotMatch(source, /larkWrites:\s*[1-9]/u);
  assert.doesNotMatch(source, /queueSends:\s*[1-9]/u);
  assert.doesNotMatch(source, /customerBaseReads:\s*[1-9]/u);
  assert.doesNotMatch(source, /customerBaseWrites:\s*[1-9]/u);
});

test('internal destination readiness keeps D1 access read-only and ephemeral', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /const CONFIGURED_DATABASE_NAME = 'social-mkt-state-dev'/u);
  assert.match(source, /sqlite_master/u);
  assert.match(source, /databases\.length === 1/u);
  assert.match(source, /schemaFingerprintMatched:\s*true/u);
  assert.match(source, /temporaryConfigUsed:\s*true/u);
  assert.match(source, /persistentConfigChanged:\s*false/u);
  assert.match(source, /await rm\(tempConfigPath, \{ force: true \}\)/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA)\b[^'"`]*--command/iu);
});
