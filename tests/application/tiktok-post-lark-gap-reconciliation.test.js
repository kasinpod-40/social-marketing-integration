import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTikTokAdmissionStatusSql,
  buildTikTokPostLarkReconciliationEnvelope,
  buildTikTokPostLarkReconciliationWranglerConfig,
  classifyTikTokPostLarkAuditForReconciliation,
  normalizeTikTokAdmissionStatusRow,
  readPreviousCompletedBangkokDate,
  validateTikTokAdmissionIdempotentReplay,
  validateTikTokPostLarkReconciledAudit,
} from '../../scripts/lib/tiktok-post-lark-gap-reconciliation.js';

const WATERMARK = 'a'.repeat(64);

function gap(count = 0, ids = []) {
  return {
    count,
    externalContentIds: ids,
    truncated: count > ids.length,
  };
}

function audit(options = {}) {
  const gaps = {
    rawMissingInD1: gap(),
    rawMissingInContent: gap(),
    d1MissingInContent: gap(),
    contentMissingInDaily: gap(),
    contentNotInRaw: gap(),
    ...(options.gaps ?? {}),
  };
  const issues = options.issues ?? Object.entries(gaps)
    .filter(([name, value]) => name !== 'contentNotInRaw' && value.count > 0)
    .map(([name, value]) => ({
      code: 'TIKTOK_CROSS_LAYER_GAP',
      gap: name,
      count: value.count,
    }));
  return {
    mode: 'read_only',
    platform: 'tiktok',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    raw: {
      recordCount: options.rawRecordCount ?? 2024,
      sourceWatermark: options.sourceWatermark ?? WATERMARK,
    },
    d1: {
      state: {},
      observations: {},
    },
    canonical: {
      content: {},
      daily: {},
    },
    gaps,
    issues,
    readyForManualProcessing: options.readyForManualProcessing ?? issues.length === 0,
  };
}

function configText() {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: 'apps/sync-worker/src/index.js',
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
      database_id: '11111111-1111-4111-8111-111111111111',
    }],
    queues: {
      producers: [{ binding: 'MKT_SYNC_QUEUE', queue: 'social-mkt-sync-jobs' }],
      consumers: [{ queue: 'social-mkt-sync-jobs' }],
    },
    vars: {
      MKT_CONNECTION_PUBLIC_ORIGIN: 'https://worker.example',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
    },
  }, null, 2);
}

function admission(overrides = {}) {
  return {
    admission_key: 'tiktok-admission:one',
    status: 'completed',
    source_watermark: WATERMARK,
    metric_date: '2026-07-27',
    source_record_count: 2024,
    sync_run_id: 'tiktok-post-lark:watermark:one',
    error_code: null,
    requested_at: 1_785_100_000_000,
    completed_at: 1_785_100_300_000,
    updated_at: 1_785_100_300_000,
    ...overrides,
  };
}

test('classifies the three verified cross-layer categories as additive full reconciliation', () => {
  const result = classifyTikTokPostLarkAuditForReconciliation(audit({
    gaps: {
      rawMissingInD1: gap(3, ['1', '2', '3']),
      rawMissingInContent: gap(2002, ['1', '2']),
      d1MissingInContent: gap(1999, ['4', '5']),
    },
  }));

  assert.equal(result.mode, 'additive_full_reconciliation');
  assert.equal(result.requiresFullReconciliation, true);
  assert.equal(result.additiveGapCount, 3);
  assert.equal(result.additiveMissingEntityTotal, 4004);
  assert.deepEqual(result.additiveGaps.map((item) => item.name), [
    'rawMissingInD1',
    'rawMissingInContent',
    'd1MissingInContent',
  ]);
});

test('blocks destructive or non-additive audit conflicts', () => {
  const result = classifyTikTokPostLarkAuditForReconciliation(audit({
    gaps: { contentNotInRaw: gap(1, ['legacy']) },
    issues: [{ code: 'TIKTOK_CANONICAL_CONTENT_KEY_INVALID' }],
    readyForManualProcessing: false,
  }));

  assert.equal(result.mode, 'blocked');
  assert.equal(result.blocked, true);
  assert.deepEqual(result.blockers.map((item) => item.code).sort(), [
    'CANONICAL_CONTENT_NOT_IN_RAW',
    'NON_ADDITIVE_AUDIT_ISSUE',
  ]);
});

test('requires exact same RAW watermark and zero issues after reconciliation', () => {
  const before = audit({
    gaps: { rawMissingInD1: gap(3, ['1', '2', '3']) },
  });
  const after = audit({ readyForManualProcessing: true });
  const result = validateTikTokPostLarkReconciledAudit(before, after);
  assert.equal(result.initial.requiresFullReconciliation, true);
  assert.equal(result.final.ready, true);

  assert.throws(
    () => validateTikTokPostLarkReconciledAudit(before, audit({
      readyForManualProcessing: true,
      sourceWatermark: 'b'.repeat(64),
    })),
    (error) => error.code === 'TIKTOK_GAP_RECONCILIATION_SOURCE_CHANGED',
  );
});

test('builds safe and reconciliation configs without enabling schedules or unrelated connectors', () => {
  const safe = JSON.parse(buildTikTokPostLarkReconciliationWranglerConfig(configText(), { mode: 'safe' }));
  const active = JSON.parse(buildTikTokPostLarkReconciliationWranglerConfig(configText(), { mode: 'reconcile' }));

  assert.deepEqual(safe.version_metadata, { binding: 'CF_VERSION_METADATA' });
  assert.equal(safe.vars.MKT_TIKTOK_AUDIT_HTTP_ENABLED, 'false');
  assert.equal(safe.vars.MKT_CONNECTOR_TIKTOK_ENABLED, 'false');
  assert.equal(safe.vars.MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED, 'false');
  assert.equal(safe.vars.MKT_TIME_SERIES_D1_WRITE_ENABLED, 'false');

  assert.equal(active.vars.MKT_TIKTOK_AUDIT_HTTP_ENABLED, 'true');
  assert.equal(active.vars.MKT_CONNECTOR_TIKTOK_ENABLED, 'true');
  assert.equal(active.vars.MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED, 'true');
  assert.equal(active.vars.MKT_TIME_SERIES_D1_WRITE_ENABLED, 'true');
  assert.equal(active.vars.MKT_TIME_SERIES_D1_BACKFILL_ENABLED, 'false');
  assert.equal(active.vars.MKT_TIKTOK_INCREMENTAL_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_TIKTOK_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED, 'false');
  assert.equal(active.vars.MKT_CONNECTOR_GOOGLE_ADS_ENABLED, 'false');
  assert.equal(active.vars.MKT_CONNECTOR_WOOCOMMERCE_ENABLED, 'false');
});

test('builds one exact JSON Queue envelope for the previous completed Bangkok day', () => {
  const metricDate = readPreviousCompletedBangkokDate('2026-07-28T02:30:00+07:00');
  const envelope = buildTikTokPostLarkReconciliationEnvelope({
    requestedAt: 1_785_200_000_000,
    metricDate,
  });

  assert.equal(metricDate, '2026-07-27');
  assert.deepEqual(envelope, {
    body: {
      schemaVersion: 1,
      type: 'tiktok.creator.native.probe',
      trigger: 'manual_reconciliation',
      requestedAt: new Date(1_785_200_000_000).toISOString(),
      metricDate: '2026-07-27',
    },
    content_type: 'json',
  });
});

test('builds bounded admission lookup and proves same-operation replay did not mutate admission', () => {
  const sql = buildTikTokAdmissionStatusSql({
    sourceWatermark: WATERMARK,
    metricDate: '2026-07-27',
  });
  assert.match(sql, /FROM tiktok_source_admissions/u);
  assert.match(sql, new RegExp(WATERMARK, 'u'));
  assert.doesNotMatch(sql, /\b(?:DELETE|UPDATE|INSERT)\b/iu);

  const normalized = normalizeTikTokAdmissionStatusRow(admission(), {
    sourceWatermark: WATERMARK,
    metricDate: '2026-07-27',
  });
  assert.equal(normalized.status, 'completed');
  assert.equal(normalized.sourceRecordCount, 2024);

  const replay = validateTikTokAdmissionIdempotentReplay(admission(), admission());
  assert.equal(replay.idempotent, true);
  assert.throws(
    () => validateTikTokAdmissionIdempotentReplay(
      admission(),
      admission({ updated_at: 1_785_100_300_001 }),
    ),
    (error) => error.code === 'TIKTOK_GAP_RECONCILIATION_REPLAY_DRIFT',
  );
});
