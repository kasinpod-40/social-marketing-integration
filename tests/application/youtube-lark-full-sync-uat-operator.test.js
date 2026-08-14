import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { resolveQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';
import {
  assertYouTubeLarkFullSyncUatOperation,
} from '../../apps/sync-worker/src/youtube-organic-job-router.js';
import {
  YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS,
  YOUTUBE_LARK_UAT_CONFIRMATIONS,
  assertYouTubeLarkUatConfirmation,
  buildYouTubeLarkFullSyncJob,
  buildYouTubeLarkUatConfigWindow,
  buildYouTubeLarkUatSnapshotSql,
  classifyYouTubeLarkCounts,
  classifyYouTubeLarkUatCompletion,
  compareYouTubeLarkUatRerun,
  createYouTubeLarkUatEvidence,
  loadYouTubeLarkUatTarget,
  normalizeYouTubeLarkUatSnapshot,
  parseYouTubeLarkUatArgs,
  validateYouTubeLarkUatEvidence,
} from '../../scripts/lib/youtube-lark-full-sync-uat-operator.js';

const CHANNEL_ID = 'UC1NVIjalyZhB2hqf3sl9GMA';
const OPERATION_ID = 'youtube-lark-uat-20260728';
const REQUESTED_AT = Date.UTC(2026, 6, 28, 3, 0, 0);
const REPOSITORY_HEAD = '1'.repeat(40);
const TARGET_FINGERPRINT = '2'.repeat(64);

test('operator is plan-only by default and requires phase confirmation', () => {
  assert.deepEqual(parseYouTubeLarkUatArgs([]), { phase: 'plan', execute: false });
  assert.throws(
    () => parseYouTubeLarkUatArgs(['--execute']),
    (error) => error.code === 'YOUTUBE_LARK_UAT_PLAN_EXECUTE_INVALID',
  );
  const confirmation = YOUTUBE_LARK_UAT_CONFIRMATIONS['send-full-sync'];
  assert.throws(
    () => assertYouTubeLarkUatConfirmation('send-full-sync', {}),
    (error) => error.code === 'YOUTUBE_LARK_UAT_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertYouTubeLarkUatConfirmation('send-full-sync', {
    [confirmation.envName]: confirmation.value,
  }), true);
});

test('target accepts exact numeric-string generation from environment', () => {
  const target = loadYouTubeLarkUatTarget({
    MKT_YOUTUBE_LARK_UAT_OPERATION_ID: OPERATION_ID,
    MKT_YOUTUBE_LARK_UAT_ORIGINAL_REQUESTED_AT: String(REQUESTED_AT),
    MKT_YOUTUBE_LARK_UAT_REPOSITORY_HEAD: REPOSITORY_HEAD,
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_YOUTUBE_LARK_UAT_ACCOUNT_KEY: 'chemistry_k',
    MKT_YOUTUBE_LARK_UAT_EXPECTED_CHANNEL_ID: CHANNEL_ID,
  });
  assert.equal(target.originalRequestedAt, REQUESTED_AT);
  assert.equal(target.generation, REQUESTED_AT);
  assert.equal(target.workKey, `youtube:${OPERATION_ID}`);
});

test('config window enables exactly four reviewed flags', async () => {
  const window = buildYouTubeLarkUatConfigWindow(await reviewedConfig(), {
    channelId: CHANNEL_ID,
  });
  assert.deepEqual(window.safeTrueFlags, []);
  assert.deepEqual(window.activeTrueFlags, [...YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS].sort());
  assert.match(window.activeText, /"MKT_YOUTUBE_LARK_WRITE_ENABLED": "true"/u);
  assert.match(window.activeText, /"MKT_TIME_SERIES_D1_WRITE_ENABLED": "true"/u);
  assert.match(window.activeText, /"MKT_YOUTUBE_ANALYTICS_ENABLED": "false"/u);
  assert.match(window.activeText, /"MKT_SCHEDULE_YOUTUBE_ENABLED": "false"/u);
  assert.equal(Object.keys(window.tableIds).length, 5);
  assert.notEqual(window.safeSha256, window.activeSha256);
});

test('full-sync job has deterministic stable identity and public-data scope', () => {
  const job = buildYouTubeLarkFullSyncJob({
    operationId: OPERATION_ID,
    originalRequestedAt: REQUESTED_AT,
  });
  assert.equal(job.type, JOB_TYPES.YOUTUBE_ORGANIC_SYNC);
  assert.equal(job.trigger, JOB_TRIGGERS.YOUTUBE_LARK_FULL_SYNC_UAT);
  assert.equal(job.dryRun, false);
  assert.equal(job.syncMode, 'full');
  assert.equal(job.analyticsEnabled, false);
  assert.equal(job.metricDate, '2026-07-28');
  assert.equal(job.operationId, OPERATION_ID);
  assert.equal(job.workKey, `youtube:${OPERATION_ID}`);
  assert.equal(job.generation, REQUESTED_AT);
  assert.equal(job.originalRequestedAt, REQUESTED_AT);

  const first = resolveQueueOperation({ job: { body: job }, message: { id: 'delivery-a' } });
  const replay = resolveQueueOperation({ job: { body: job }, message: { id: 'delivery-b' } });
  assert.deepEqual(first, replay);
  assert.equal(first.stable, true);
});

test('router accepts only stable Integration Workspace Lark UAT identity', () => {
  const body = buildYouTubeLarkFullSyncJob({
    operationId: OPERATION_ID,
    originalRequestedAt: REQUESTED_AT,
  });
  const operation = resolveQueueOperation({ job: { body }, message: { id: 'delivery-a' } });
  const accepted = assertYouTubeLarkFullSyncUatOperation({
    body,
    operation,
    env: {
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'false',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'false',
    },
    d1WriteEnabled: true,
    larkWriteEnabled: true,
  });
  assert.equal(accepted.syncRunId, `youtube-lark-uat:${OPERATION_ID}`);
  assert.equal(accepted.workKey, `youtube:${OPERATION_ID}`);

  assert.throws(
    () => assertYouTubeLarkFullSyncUatOperation({
      body: { ...body, analyticsEnabled: true }, operation, env: {},
      d1WriteEnabled: true, larkWriteEnabled: true,
    }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_OPERATION_INVALID'
      && error.details.invalid.includes('analyticsEnabled'),
  );
  assert.throws(
    () => assertYouTubeLarkFullSyncUatOperation({
      body, operation, env: { MKT_SCHEDULE_YOUTUBE_ENABLED: 'true' },
      d1WriteEnabled: true, larkWriteEnabled: true,
    }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_OPERATION_INVALID'
      && error.details.invalid.includes('youtubeSchedule'),
  );
});

test('snapshot SQL resolves durable storage IDs and Provider count', () => {
  const sql = buildYouTubeLarkUatSnapshotSql({
    operationId: OPERATION_ID,
    workKey: `youtube:${OPERATION_ID}`,
    syncRunId: `youtube-lark-uat:${OPERATION_ID}`,
  });
  assert.match(sql, /json_extract\(completion_json, '\$\.endToEnd\.storage\.historySyncRunId'\)/u);
  assert.match(sql, /json_extract\(completion_json, '\$\.endToEnd\.storage\.contentCoverageRunId'\)/u);
  assert.match(sql, /json_extract\(completion_json, '\$\.endToEnd\.storage\.accountCoverageRunId'\)/u);
  assert.match(sql, /json_extract\(details_json, '\$\.providerRequestCount'\)/u);
  assert.match(sql, /last_sync_run_id = \(SELECT history_sync_run_id FROM storage_ids\)/u);
  assert.match(sql, /coverage_run_id = \(SELECT content_coverage_run_id FROM storage_ids\)/u);
  assert.doesNotMatch(sql, /organic_content_state WHERE last_sync_run_id = 'youtube-lark-uat:/u);
});

test('completion requires storage IDs, terminal success, D1 facts and no lock or DLQ', () => {
  const complete = classifyYouTubeLarkUatCompletion(completeSnapshot(1, 4));
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);
  assert.equal(complete.snapshot.providerRequests, 4);

  const normalizedAgain = normalizeYouTubeLarkUatSnapshot(complete.snapshot);
  assert.deepEqual(normalizedAgain, complete.snapshot);
  assert.equal(classifyYouTubeLarkUatCompletion(normalizedAgain).complete, true);

  const missingStorageId = classifyYouTubeLarkUatCompletion({
    ...completeSnapshot(1, 4), history_sync_run_id_present: 0,
  });
  assert.equal(missingStorageId.complete, false);
  assert.ok(missingStorageId.missing.includes('historySyncRunIdPresent'));

  const incomplete = classifyYouTubeLarkUatCompletion({
    ...completeSnapshot(1, 4), data_coverage_entities: 0,
  });
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missing.includes('dataCoverageEntities'));

  assert.throws(
    () => classifyYouTubeLarkUatCompletion({ ...completeSnapshot(1, 4), dlq_records: 1 }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_DLQ_DETECTED',
  );
  assert.throws(
    () => classifyYouTubeLarkUatCompletion({
      ...completeSnapshot(1, 4), sync_run_status: 'failed',
      sync_run_error_code: 'YOUTUBE_TEST_FAILURE',
    }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_SYNC_FAILED',
  );
});

test('completion parser accepts numeric D1 epoch timestamps from live Wrangler JSON', () => {
  const snapshot = completeSnapshot(1, 35);
  snapshot.sync_run_finished_at = 1785227174174;
  snapshot.work_completed_at = 1785227173381;
  const result = classifyYouTubeLarkUatCompletion(snapshot);
  assert.equal(result.complete, true);
  assert.equal(result.snapshot.syncRunFinishedAt, 1785227174174);
  assert.equal(result.snapshot.workCompletedAt, 1785227173381);
});

test('Lark counts require customer-facing targets while Analytics is stored in D1', () => {
  const counts = classifyYouTubeLarkCounts(larkCounts());
  assert.equal(counts.complete, true);
  assert.equal('rawYouTubeAnalyticsDaily' in counts.counts, false);
  assert.equal(counts.analyticsStoredInD1, true);
  const missing = classifyYouTubeLarkCounts({ ...larkCounts(), mktContent: 0 });
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.missingPositive, ['mktContent']);
});

test('same-operation rerun preserves business counts and performs no Provider requests', () => {
  const before = classifyYouTubeLarkUatCompletion(completeSnapshot(1, 4)).snapshot;
  const after = classifyYouTubeLarkUatCompletion(completeSnapshot(2, 0)).snapshot;
  const result = compareYouTubeLarkUatRerun({
    before, after, beforeLark: larkCounts(), afterLark: larkCounts(),
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.providerReplayVerified, true);
  assert.equal(result.firstRunProviderRequests, 4);
  assert.equal(result.rerunProviderRequests, 0);
  assert.equal(result.mainQueueAttempts, 2);

  assert.throws(
    () => compareYouTubeLarkUatRerun({
      before,
      after: { ...after, providerRequests: 1 },
      beforeLark: larkCounts(), afterLark: larkCounts(),
    }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_PROVIDER_REPLAY_FAILED',
  );
  assert.throws(
    () => compareYouTubeLarkUatRerun({
      before,
      after: { ...after, organicContentObservations: 3 },
      beforeLark: larkCounts(), afterLark: larkCounts(),
    }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_IDEMPOTENCY_FAILED',
  );
});

test('evidence is tamper-evident and target-bound', () => {
  const evidence = createYouTubeLarkUatEvidence({
    phase: 'lark-preflight', repositoryHead: REPOSITORY_HEAD,
    targetFingerprint: TARGET_FINGERPRINT, operationId: OPERATION_ID,
    data: { tableCount: 8 }, createdAt: '2026-07-28T03:00:00.000Z',
  });
  const validated = validateYouTubeLarkUatEvidence(evidence, {
    repositoryHead: REPOSITORY_HEAD,
    targetFingerprint: TARGET_FINGERPRINT,
    operationId: OPERATION_ID,
  });
  assert.equal(validated.evidenceSha256, evidence.evidenceSha256);
  assert.throws(
    () => validateYouTubeLarkUatEvidence({ ...evidence, data: { tableCount: 7 } }, {
      repositoryHead: REPOSITORY_HEAD,
      targetFingerprint: TARGET_FINGERPRINT,
      operationId: OPERATION_ID,
    }),
    (error) => error.code === 'YOUTUBE_LARK_UAT_EVIDENCE_SHA_INVALID',
  );
});

test('source wiring records UAT Provider metrics and keeps generated configs alive', async () => {
  const [source, emergencyRestore, helper, router] = await Promise.all([
    readFile(new URL('../../scripts/youtube-lark-full-sync-uat-operator.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/youtube-lark-full-sync-uat-emergency-restore.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/lib/youtube-lark-full-sync-uat-operator.js', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/sync-worker/src/youtube-organic-job-router.js', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /if \(options\.phase === 'plan'\)[\s\S]*return;/u);
  assert.match(source, /await writePrivateJson\(attemptPath,[\s\S]*await fetch\(/u);
  assert.match(source, /await writePrivateJson\(attemptPath,[\s\S]*wrangler\(\[\s*'deploy'/u);
  assert.match(source, /return await operation\(path\);[\s\S]*finally \{[\s\S]*await rm\(directory/u);
  assert.match(emergencyRestore, /return await operation\(path\);[\s\S]*finally \{[\s\S]*await rm\(directory/u);
  assert.match(helper, /'MKT_SCHEDULE_YOUTUBE_ENABLED'/u);
  assert.match(helper, /'MKT_YOUTUBE_ANALYTICS_ENABLED'/u);
  assert.match(router, /providerRequestCount:\s*Number\(clients\.requestMetrics\?\.publicRequests/u);
  assert.match(router, /if \(!publicApiKeyOnly\) return syncResult/u);
  assert.doesNotMatch(source, /d1',\s*'migrations',\s*'apply'/u);
  assert.doesNotMatch(source, /batchDelete|deleteRecords|deleteTable/u);
});

async function reviewedConfig() {
  const source = await readFile(new URL('../../wrangler.sync.example.jsonc', import.meta.url), 'utf8');
  const mappings = [
    'LARK_TABLE_MKT_ACCOUNTS', 'LARK_TABLE_RAW_YOUTUBE_CHANNELS',
    'LARK_TABLE_RAW_YOUTUBE_VIDEOS', 'LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY',
    'LARK_TABLE_MKT_CONTENT', 'LARK_TABLE_MKT_CONTENT_DAILY',
    'LARK_TABLE_MKT_SYNC_LOG', 'LARK_TABLE_MKT_SYSTEM_ALERTS',
  ];
  let text = source
    .replace('"database_name": "replace-with-environment-specific-d1-name"', '"database_name": "social-mkt-state-dev"')
    .replace('"database_id": "00000000-0000-0000-0000-000000000000"', '"database_id": "12345678-1234-4234-9234-123456789abc"')
    .replace('"YOUTUBE_CHANNEL_ID": "replace-with-youtube-channel-id"', `"YOUTUBE_CHANNEL_ID": "${CHANNEL_ID}"`);
  let index = 0;
  text = text.replaceAll('"replace-with-table-id"', () => `"tbl_real_${index += 1}"`);
  for (const [mappingIndex, name] of mappings.entries()) {
    text = text.replace(
      new RegExp(`"${name}"\\s*:\\s*"[^"]+"`, 'u'),
      `"${name}": "tbl_youtube_${mappingIndex + 1}"`,
    );
  }
  return text;
}

function completeSnapshot(mainQueueAttempts, providerRequests) {
  return {
    sync_run_status: 'success',
    sync_run_finished_at: '2026-07-28T03:01:00.000Z',
    sync_run_error_code: null,
    sync_work_status: 'completed',
    work_lifecycle_status: 'completed',
    work_completed_at: '2026-07-28T03:01:00.000Z',
    completion_json_present: 1,
    history_sync_run_id_present: 1,
    content_coverage_run_id_present: 1,
    account_coverage_run_id_present: 1,
    active_lock_count: 0,
    queue_operation_attempts: mainQueueAttempts,
    main_queue_attempts: mainQueueAttempts,
    dlq_records: 0,
    provider_requests: providerRequests,
    organic_content_state: 2,
    organic_content_observations: 2,
    organic_account_daily_facts: 1,
    data_coverage_runs: 2,
    data_coverage_entities: 2,
    sync_cursors: 1,
    source_record_states: 2,
  };
}

function larkCounts() {
  return {
    rawYouTubeChannels: 1,
    rawYouTubeVideos: 2,
    rawYouTubeAnalyticsDaily: 0,
    mktAccounts: 1,
    mktContent: 2,
    mktContentDaily: 2,
    mktSyncLog: 0,
    mktSystemAlerts: 0,
  };
}
