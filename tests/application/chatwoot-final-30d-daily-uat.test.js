import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
  CHATWOOT_FINAL_UAT_CONFIRMATION,
  CHATWOOT_FINAL_UAT_LOCKED_VARS,
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  CHATWOOT_FINAL_UAT_TABLES,
  assertChatwootFinalUatBaselineCompatible,
  assertChatwootFinalUatBaselinePreserved,
  assertChatwootFinalUatControllerResume,
  assertChatwootFinalUatConfirmation,
  assertChatwootFinalUatPreflight,
  assertChatwootFinalUatResumeIdentity,
  buildChatwootFinalUatConfigWindow,
  buildChatwootFinalUatJob,
  buildChatwootFinalUatPreflightSql,
  buildChatwootFinalUatSnapshotSql,
  classifyChatwootFinalUatCompletion,
  compareChatwootD1LarkParity,
  compareChatwootFinalUatReplay,
  createChatwootFinalUatSession,
  mapChatwootFinalUatD1BaselineCounts,
  normalizeChatwootFinalUatPreflight,
  normalizeChatwootFinalUatSnapshot,
} from '../../scripts/lib/chatwoot-final-30d-daily-uat.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';

const HEAD = '95fe279d6ef46978d95acb1611ec859ae35cba64';
const INITIAL_AT = Date.parse('2026-07-31T03:30:00Z');
const DAILY_AT = INITIAL_AT + 1_000;

function sourceConfig() {
  const vars = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_MAIN_QUEUE_NAME: 'social-mkt-sync-jobs',
    MKT_DLQ_QUEUE_NAME: 'social-mkt-sync-dlq',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
    MKT_CONNECTOR_CHATWOOT_ENABLED: 'false',
    MKT_CHATWOOT_D1_WRITE_ENABLED: 'false',
    MKT_CHATWOOT_LARK_WRITE_ENABLED: 'false',
    MKT_CHATWOOT_REPORT_WRITE_ENABLED: 'false',
    MKT_CHATWOOT_WEBHOOK_ENABLED: 'false',
    MKT_SCHEDULE_CHATWOOT_ENABLED: 'false',
    ...CHATWOOT_FINAL_UAT_LOCKED_VARS,
  };
  CHATWOOT_FINAL_UAT_TABLES.forEach((spec, index) => {
    vars[spec.envName] = `tbl_chatwoot_${String(index).padStart(2, '0')}_real`;
  });
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: './apps/sync-worker/src/index.js',
    compatibility_date: '2026-07-15',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    triggers: { crons: ['*/5 * * * *', '30 18 * * *'] },
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
      database_id: '11111111-1111-4111-8111-111111111111',
      migrations_dir: './migrations',
    }],
    queues: {
      producers: [{ binding: 'MKT_SYNC_QUEUE', queue: 'social-mkt-sync-jobs' }],
      consumers: [
        {
          queue: 'social-mkt-sync-jobs',
          max_concurrency: 1,
          max_batch_size: 10,
          max_batch_timeout: 30,
          max_retries: 5,
          dead_letter_queue: 'social-mkt-sync-dlq',
        },
        {
          queue: 'social-mkt-sync-dlq',
          max_concurrency: 1,
          max_batch_size: 10,
          max_batch_timeout: 30,
          max_retries: 10,
        },
      ],
    },
    vars,
  }, null, 2);
}

function session() {
  return createChatwootFinalUatSession({
    repositoryHead: HEAD,
    createdAt: INITIAL_AT,
    initialRequestedAt: INITIAL_AT,
    dailyRequestedAt: DAILY_AT,
  });
}

function completedRow(operation, overrides = {}) {
  const days = operation.mode === 'initial' ? 30 : 3;
  const d1 = Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [spec.key, 2]));
  return {
    work_lifecycle_status: 'completed',
    work_completed_at: operation.originalRequestedAt + 10_000,
    completion_json_present: 1,
    completion_status: 'completed',
    completion_sync_run_id: operation.syncRunId,
    completion_mode: operation.mode === 'initial' ? 'initial_30_day_uat' : 'daily_incremental',
    window_start_at: operation.originalRequestedAt - days * 86_400_000,
    window_end_at: operation.originalRequestedAt,
    automatic_backfill_expansion: 0,
    include_updated_older_conversations: 1,
    conversation_pages_processed: 2,
    reporting_pages_processed: 6,
    rollup_pages_processed: 31,
    checkpoint_complete: 1,
    active_stage: null,
    active_next_sequence: 0,
    active_conversation_pages: 0,
    active_reporting_pages: 0,
    active_rollup_pages: 0,
    active_lock_count: 0,
    main_queue_attempts: 10,
    unit_sync_runs: 9,
    failed_unit_sync_runs: 0,
    coverage_runs: 20,
    failed_coverage_runs: 0,
    failed_coverage_rows: 0,
    dlq_records: 0,
    open_chatwoot_alerts: 0,
    cursor_sync_type: operation.mode === 'initial' ? 'initial_30_day_uat' : 'daily_incremental',
    cursor_last_full_sync_at: operation.mode === 'initial' ? operation.originalRequestedAt : INITIAL_AT,
    cursor_last_successful_sync_at: operation.originalRequestedAt,
    cursor_incremental_run_count: operation.mode === 'initial' ? 1 : 2,
    cursor_last_sync_run_id: operation.syncRunId,
    cursor_generation: operation.originalRequestedAt,
    cursor_generation_work_key: operation.workKey,
    cursor_requested_at: operation.originalRequestedAt,
    ...d1,
    ...overrides,
  };
}

test('confirmation and success marker are exact and explicit', () => {
  assert.equal(CHATWOOT_FINAL_UAT_CONFIRMATION.envName, 'CONFIRM_CHATWOOT_FINAL_UAT');
  assert.equal(CHATWOOT_FINAL_UAT_CONFIRMATION.value, 'EXECUTE_CHATWOOT_30D_DAILY_UAT');
  assert.equal(CHATWOOT_FINAL_UAT_SUCCESS_MARKER, 'CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE');
  assert.throws(() => assertChatwootFinalUatConfirmation({}), (error) => error?.code === 'CHATWOOT_FINAL_UAT_CONFIRMATION_REQUIRED');
  assert.equal(assertChatwootFinalUatConfirmation({
    CONFIRM_CHATWOOT_FINAL_UAT: 'EXECUTE_CHATWOOT_30D_DAILY_UAT',
  }), true);
});

test('generated config changes only the exact four Chatwoot flags and keeps Schedule/Webhook false', () => {
  const window = buildChatwootFinalUatConfigWindow(sourceConfig());
  const safe = JSON.parse(window.safeText);
  const active = JSON.parse(window.activeText);
  assert.deepEqual(window.safeTrueFlags, []);
  assert.deepEqual(window.activeTrueFlags, [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort());
  assert.equal(active.vars.MKT_SCHEDULE_CHATWOOT_ENABLED, 'false');
  assert.equal(active.vars.MKT_CHATWOOT_WEBHOOK_ENABLED, 'false');
  assert.equal(active.vars.CHATWOOT_INITIAL_BACKFILL_DAYS, '30');
  assert.equal(active.vars.CHATWOOT_INCREMENTAL_OVERLAP_DAYS, '3');
  assert.equal(active.vars.CHATWOOT_AUTO_EXPAND_BACKFILL, 'false');
  assert.equal(safe.workers_dev, false);
  assert.equal(Object.keys(window.tableIds).length, 15);
});

test('config refuses 90-day expansion, Schedule activation and placeholder Lark mappings', () => {
  const expanded = JSON.parse(sourceConfig());
  expanded.vars.CHATWOOT_INITIAL_BACKFILL_DAYS = '90';
  assert.throws(() => buildChatwootFinalUatConfigWindow(JSON.stringify(expanded)), (error) => error?.code === 'CHATWOOT_FINAL_UAT_TARGET_INVALID');
  const scheduled = JSON.parse(sourceConfig());
  scheduled.vars.MKT_SCHEDULE_CHATWOOT_ENABLED = 'true';
  assert.throws(() => buildChatwootFinalUatConfigWindow(JSON.stringify(scheduled)), (error) => error?.code === 'CHATWOOT_FINAL_UAT_TARGET_INVALID');
  const placeholder = JSON.parse(sourceConfig());
  placeholder.vars.LARK_TABLE_RAW_CHATWOOT_ACCOUNTS = 'replace-with-table-id';
  assert.throws(() => buildChatwootFinalUatConfigWindow(JSON.stringify(placeholder)), (error) => error?.code === 'CHATWOOT_FINAL_UAT_TABLE_MAPPING_INVALID');
});

test('session creates immutable Initial and newer Daily stable identities', () => {
  const value = session();
  assert.equal(value.repositoryHead, HEAD);
  assert.equal(value.initial.mode, 'initial');
  assert.equal(value.initial.workKey, `chatwoot:chemistry_k:${value.initial.operationId}`);
  assert.equal(value.daily.mode, 'daily');
  assert.ok(value.daily.generation > value.initial.generation);
  assert.equal(value.daily.generation, value.daily.originalRequestedAt);
});

test('Initial and Daily Queue jobs use shared schema and trigger contracts', () => {
  const value = session();
  const initial = buildChatwootFinalUatJob(value.initial);
  const daily = buildChatwootFinalUatJob(value.daily);
  assert.equal(initial.type, JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC);
  assert.equal(initial.trigger, JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT);
  assert.equal(daily.trigger, JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL);
  assert.equal(initial.accountKey, 'chemistry_k');
  assert.equal(initial.workKey, value.initial.workKey);
  assert.equal(initial.generation, initial.originalRequestedAt);
  assert.equal(daily.continuationSequence, 0);
});

test('preflight accepts existing Business baseline while retaining exact schema and idle-state gates', () => {
  const row = {
    active_chatwoot_work: 0,
    active_chatwoot_locks: 0,
    prior_chatwoot_operations: 1,
    chatwoot_table_count: 14,
    chatwoot_index_count: 15,
  };
  for (const spec of CHATWOOT_FINAL_UAT_TABLES) row[spec.d1Table] = 0;
  row.chatwoot_account_state = 4;
  row.chatwoot_conversation_state = 8;
  const normalized = normalizeChatwootFinalUatPreflight(row);
  assert.equal(assertChatwootFinalUatPreflight(normalized).totalBusinessRows, 12);
  row.active_chatwoot_work = 1;
  assert.throws(
    () => assertChatwootFinalUatPreflight(normalizeChatwootFinalUatPreflight(row)),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_PREFLIGHT_BLOCKED',
  );
});

test('baseline contract allows Lark to lag D1, blocks Lark excess and prevents row loss', () => {
  const d1Business = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((spec) => spec.d1Table))]
      .map((tableName) => [tableName, 2]),
  );
  const d1 = mapChatwootFinalUatD1BaselineCounts(d1Business);
  const lark = Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [spec.key, 1]));
  const compatible = assertChatwootFinalUatBaselineCompatible(d1, lark);
  assert.ok(compatible.d1Rows > compatible.larkRows);
  assert.equal(assertChatwootFinalUatBaselinePreserved(
    d1,
    Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [
      spec.key,
      d1[spec.key] + 1,
    ])),
    'initial:d1',
  ).accepted, true);
  assert.throws(
    () => assertChatwootFinalUatBaselineCompatible(d1, {
      ...lark,
      rawChatwootAccounts: d1.rawChatwootAccounts + 1,
    }),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_BASELINE_MISMATCH',
  );
  assert.throws(
    () => assertChatwootFinalUatBaselinePreserved(d1, {
      ...d1,
      rawChatwootAccounts: d1.rawChatwootAccounts - 1,
    }, 'initial:d1'),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_BASELINE_REGRESSION',
  );
});

test('D1 SQL is read-only, scoped and covers every Chatwoot target', () => {
  const value = session();
  const preflight = buildChatwootFinalUatPreflightSql();
  const snapshot = buildChatwootFinalUatSnapshotSql(value.initial);
  assert.doesNotMatch(`${preflight} ${snapshot}`, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/iu);
  assert.match(snapshot, /chatwoot_runtime_30d_daily_v1/u);
  assert.match(snapshot, /queue_operation_attempts/u);
  assert.match(snapshot, /sync_cursors/u);
  assert.match(snapshot, /status IN \('failed', 'partial_success'\)/u);
  assert.doesNotMatch(snapshot, /status NOT IN \('success', 'completed'\)/u);
  for (const spec of CHATWOOT_FINAL_UAT_TABLES) assert.match(snapshot, new RegExp(spec.d1Table, 'u'));
});

test('completion verifies exact 30-day and three-day windows, checkpoint and bounded units', () => {
  const value = session();
  const initial = normalizeChatwootFinalUatSnapshot(completedRow(value.initial));
  const daily = normalizeChatwootFinalUatSnapshot(completedRow(value.daily));
  assert.equal(classifyChatwootFinalUatCompletion(initial, value.initial).complete, true);
  assert.equal(classifyChatwootFinalUatCompletion(daily, value.daily).complete, true);
  const expanded = normalizeChatwootFinalUatSnapshot(completedRow(value.initial, {
    window_start_at: value.initial.originalRequestedAt - 90 * 86_400_000,
  }));
  assert.equal(classifyChatwootFinalUatCompletion(expanded, value.initial).complete, false);
});

test('same-operation replay requires attempt growth and no Business/Coverage/cursor drift', () => {
  const operation = session().initial;
  const before = normalizeChatwootFinalUatSnapshot(completedRow(operation));
  const after = normalizeChatwootFinalUatSnapshot(completedRow(operation, { main_queue_attempts: 11 }));
  assert.equal(compareChatwootFinalUatReplay(before, after).accepted, true);
  const drift = normalizeChatwootFinalUatSnapshot(completedRow(operation, {
    main_queue_attempts: 11,
    rawChatwootConversations: 3,
  }));
  assert.throws(() => compareChatwootFinalUatReplay(before, drift), (error) => error?.code === 'CHATWOOT_FINAL_UAT_REPLAY_INVALID');
});

test('controller resume is poll-only for the exact advanced Initial operation', () => {
  const operation = session().initial;
  const active = normalizeChatwootFinalUatSnapshot(completedRow(operation, {
    work_lifecycle_status: 'active',
    work_completed_at: null,
    completion_json_present: 0,
    completion_status: null,
    completion_sync_run_id: null,
    completion_mode: null,
    active_stage: 'conversations',
    active_next_sequence: 3,
    main_queue_attempts: 20,
    failed_unit_sync_runs: 0,
    dlq_records: 8,
    open_chatwoot_alerts: 14,
  }));
  const accepted = assertChatwootFinalUatControllerResume(active, operation);
  assert.equal(accepted.pollOnly, true);
  assert.equal(accepted.queueSend, false);
  assert.equal(accepted.minimumAttempts, 20);
  assert.throws(
    () => assertChatwootFinalUatControllerResume({ ...active, mainQueueAttempts: 16 }, operation),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
  );
  assert.throws(
    () => assertChatwootFinalUatControllerResume({ ...active, failedCoverageRows: 1 }, operation),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
  );
});

test('controller resume replaces the active Worker and sends one continuation after exact retry exhaustion', () => {
  const operation = session().initial;
  const active = normalizeChatwootFinalUatSnapshot(completedRow(operation, {
    work_lifecycle_status: 'active',
    work_completed_at: null,
    completion_json_present: 0,
    completion_status: null,
    completion_sync_run_id: null,
    completion_mode: null,
    active_stage: 'conversations',
    active_next_sequence: 3,
    main_queue_attempts: 25,
    failed_unit_sync_runs: 0,
    dlq_records: 9,
    open_chatwoot_alerts: 15,
  }));
  const accepted = assertChatwootFinalUatControllerResume(active, operation);
  assert.equal(accepted.pollOnly, false);
  assert.equal(accepted.queueSend, true);
  assert.equal(accepted.replaceActiveDeployment, true);
  assert.equal(accepted.minimumAttempts, 25);
});

test('controller resume identity binds both retained Initial and Daily operations', () => {
  const value = session();
  assert.equal(assertChatwootFinalUatResumeIdentity(value.initial, { ...value.initial }), true);
  assert.equal(assertChatwootFinalUatResumeIdentity(value.daily, { ...value.daily }), true);
  assert.throws(
    () => assertChatwootFinalUatResumeIdentity(value.initial, {
      ...value.initial,
      operationId: `${value.initial.operationId}-drift`,
    }),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
  );
});

test('D1/Lark parity validates all 15 targets and preserves duplicate logical sinks', () => {
  const counts = Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [spec.key, 2]));
  const parity = compareChatwootD1LarkParity(counts, counts);
  assert.equal(parity.exact, true);
  assert.equal(parity.tableCount, 15);
  assert.throws(
    () => compareChatwootD1LarkParity(counts, { ...counts, mktConversations: 1 }),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_PARITY_MISMATCH',
  );
});

test('one-command operator is plan-only by default and owns automatic Safe restore', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-final-30d-daily-uat.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /if \(!args\.includes\('--execute'\)\) return printPlan\(\)/u);
  assert.match(source, /finally \{[\s\S]*restoreAllFalse/u);
  assert.match(source, /head !== main/u);
  assert.match(source, /d1Backup/u);
  assert.match(source, /operationFlow\(target, session\.initial/u);
  assert.match(source, /operationFlow\(target, session\.daily/u);
  assert.match(source, /compareChatwootD1LarkParity/u);
  assert.match(source, /assertChatwootFinalUatBaselineCompatible/u);
  assert.match(source, /assertChatwootFinalUatBaselinePreserved/u);
  assert.doesNotMatch(source, /CHATWOOT_FINAL_UAT_LARK_NOT_EMPTY/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_SUCCESS_MARKER/u);
  assert.match(source, /freshQueueBearer\(target\)/u);
  assert.match(source, /target\.cf\.wranglerEnv/u);
  assert.match(source, /MKT_CHATWOOT_FINAL_UAT_DEPLOYMENT_CHECK_EVERY_POLLS/u);
  assert.match(source, /queueSend:\s*false/u);
  assert.doesNotMatch(source, /target\.cf\.env\.CLOUDFLARE_API_TOKEN/u);
  assert.doesNotMatch(source, /MKT_SCHEDULE_CHATWOOT_ENABLED[^\n]*['"]true['"]/u);
  assert.doesNotMatch(source, /MKT_CHATWOOT_WEBHOOK_ENABLED[^\n]*['"]true['"]/u);
  assert.doesNotMatch(source, /production:\s*true/u);
});

test('D1 backup integrity is streamed without child-process buffering', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-final-30d-daily-uat.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /const backup = await d1Backup\(target\)/u);
  assert.match(source, /for await \(const chunk of createReadStream\(path\)\)/u);
  assert.match(source, /backupBytes: metadata\.size/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_BACKUP_HASH_FAILED/u);
  assert.doesNotMatch(source, /execFileSync\('cat'/u);
});
