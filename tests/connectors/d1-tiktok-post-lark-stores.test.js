import test from 'node:test';
import assert from 'node:assert/strict';
import { D1TikTokPostLarkStore } from '../../packages/connectors/src/tiktok/d1-tiktok-post-lark-store.js';
import {
  D1TikTokReportRequestStore,
} from '../../packages/connectors/src/tiktok/d1-tiktok-report-request-store.js';
import { D1ReportRequestStore } from '../../packages/connectors/src/d1-report-request-store.js';

function createD1() {
  const admissions = new Map();
  const requests = new Map();
  return {
    admissions,
    requests,
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async run() {
              if (sql.includes('INSERT INTO tiktok_source_admissions')) {
                const key = bindings[0];
                if (admissions.has(key)) return { meta: { changes: 0 } };
                admissions.set(key, {
                  admission_key: key,
                  customer_profile: bindings[1],
                  customer_key: bindings[2],
                  account_key: bindings[3],
                  source_handle: bindings[4],
                  source_watermark: bindings[5],
                  metric_date: bindings[6],
                  source_record_count: bindings[7],
                  source_max_modified_at: bindings[8],
                  generation: bindings[9],
                  work_key: bindings[10],
                  status: 'pending',
                  sync_run_id: null,
                  report_request_id: null,
                  error_code: null,
                  requested_at: bindings[11],
                  queued_at: null,
                  started_at: null,
                  completed_at: null,
                  created_at: bindings[12],
                  updated_at: bindings[13],
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE tiktok_source_admissions')) {
                return updateRow(sql, bindings, admissions, 'admission_key');
              }
              if (sql.includes('INSERT INTO report_requests')) {
                const key = bindings[0];
                if (requests.has(key)) return { meta: { changes: 0 } };
                const platformBinding = sql.includes("VALUES (?, ?, ?, 'tiktok'")
                  ? null
                  : bindings[3];
                const offset = platformBinding === null ? 0 : 1;
                requests.set(key, {
                  request_id: key,
                  customer_key: bindings[1],
                  account_key: bindings[2],
                  platform_scope: platformBinding ?? 'tiktok',
                  period_start: bindings[3 + offset],
                  period_end: bindings[4 + offset],
                  comparison_mode: bindings[5 + offset],
                  status: 'pending',
                  result_report_id: null,
                  requested_at: bindings[6 + offset],
                  started_at: null,
                  finished_at: null,
                  error_code: null,
                  created_at: bindings[7 + offset],
                  updated_at: bindings[8 + offset],
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE report_requests')) {
                return updateRow(sql, bindings, requests, 'request_id');
              }
              throw new Error(`Unexpected run SQL: ${sql}`);
            },
            async first() {
              if (sql.includes('FROM tiktok_source_admissions')) {
                if (sql.includes('status = \'completed\'')) {
                  return [...admissions.values()]
                    .filter((row) => row.customer_key === bindings[0]
                      && row.account_key === bindings[1]
                      && row.status === 'completed')
                    .sort((left, right) => Number(right.completed_at) - Number(left.completed_at))[0] ?? null;
                }
                return admissions.get(bindings[0]) ?? null;
              }
              if (sql.includes('FROM report_requests')) {
                return requests.get(bindings[0]) ?? null;
              }
              throw new Error(`Unexpected first SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

function updateRow(sql, bindings, rows, keyField) {
  const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
  const fields = [...setClause.matchAll(/([a-z_]+)\s*=\s*\?/gu)].map((match) => match[1]);
  const rowKey = bindings[fields.length];
  const allowed = bindings.slice(fields.length + 1);
  const row = rows.get(rowKey);
  if (!row || !allowed.includes(row.status)) return { meta: { changes: 0 } };
  for (let index = 0; index < fields.length; index += 1) {
    row[fields[index]] = bindings[index];
  }
  rows.set(rowKey, row);
  return { meta: { changes: 1 } };
}

const admissionInput = Object.freeze({
  admissionKey: 'tiktok-admission:1',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  sourceHandle: 'chemistry_k',
  sourceWatermark: 'watermark-1',
  metricDate: '2026-07-25',
  sourceRecordCount: 2021,
  sourceMaxModifiedAt: 1_780_000_000_000,
  generation: 1_780_000_100_000,
  workKey: 'tiktok:watermark:1',
  requestedAt: 1_780_000_100_000,
});

test('TikTok source admission claim and lifecycle are idempotent', async () => {
  const d1 = createD1();
  let now = 1_780_000_100_100;
  const store = new D1TikTokPostLarkStore({ db: d1, now: () => now });
  const first = await store.claimAdmission(admissionInput);
  const second = await store.claimAdmission(admissionInput);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.admission.generation, admissionInput.generation);

  now += 1;
  const queued = await store.markQueued({ admissionKey: admissionInput.admissionKey });
  assert.equal(queued.status, 'queued');
  now += 1;
  const processing = await store.markProcessing({
    admissionKey: admissionInput.admissionKey,
    syncRunId: 'tiktok-post-lark:1',
  });
  assert.equal(processing.status, 'processing');
  const processingReplay = await store.markProcessing({
    admissionKey: admissionInput.admissionKey,
    syncRunId: 'tiktok-post-lark:1',
  });
  assert.equal(processingReplay.status, 'processing');
  now += 1;
  const completed = await store.markCompleted({
    admissionKey: admissionInput.admissionKey,
    syncRunId: 'tiktok-post-lark:1',
    reportRequestId: 'report-request:1',
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.reportRequestId, 'report-request:1');
  const completedReplay = await store.markCompleted({
    admissionKey: admissionInput.admissionKey,
    syncRunId: 'tiktok-post-lark:1',
    reportRequestId: 'report-request:1',
  });
  assert.equal(completedReplay.status, 'completed');

  const latest = await store.readLatestCompletedAdmission({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
  });
  assert.equal(latest.admissionKey, admissionInput.admissionKey);
});

test('TikTok source admission rejects Stable-key identity reuse', async () => {
  const d1 = createD1();
  const store = new D1TikTokPostLarkStore({ db: d1, now: () => 1_780_000_100_100 });
  await store.claimAdmission(admissionInput);
  await assert.rejects(() => store.claimAdmission({
    ...admissionInput,
    sourceWatermark: 'different-watermark',
  }), (error) => error.code === 'TIKTOK_SOURCE_ADMISSION_IDENTITY_CONFLICT');
});

const requestInput = Object.freeze({
  requestId: 'report-request:tiktok:1',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  periodStart: '2026-07-25',
  periodEnd: '2026-07-25',
  comparisonMode: 'previous_period',
  requestedAt: 1_780_000_200_000,
});

test('TikTok report request survives processing retry and completes once', async () => {
  const d1 = createD1();
  let now = 1_780_000_200_100;
  const store = new D1TikTokReportRequestStore({ db: d1, now: () => now });
  const first = await store.claim(requestInput);
  const second = await store.claim(requestInput);
  assert.equal(first.created, true);
  assert.equal(second.created, false);

  now += 1;
  const processing = await store.markProcessing({ requestId: requestInput.requestId });
  assert.equal(processing.status, 'processing');
  const retry = await store.markProcessing({ requestId: requestInput.requestId });
  assert.equal(retry.status, 'processing');
  now += 1;
  const completed = await store.markCompleted({
    requestId: requestInput.requestId,
    reportId: 'report:tiktok:1',
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.resultReportId, 'report:tiktok:1');
  const replay = await store.markCompleted({
    requestId: requestInput.requestId,
    reportId: 'report:tiktok:1',
  });
  assert.equal(replay.status, 'completed');
});

test('TikTok report request rejects identity drift', async () => {
  const d1 = createD1();
  const store = new D1TikTokReportRequestStore({ db: d1, now: () => 1_780_000_200_100 });
  await store.claim(requestInput);
  await assert.rejects(() => store.claim({
    ...requestInput,
    periodEnd: '2026-07-26',
  }), (error) => error.code === 'TIKTOK_REPORT_REQUEST_IDENTITY_CONFLICT');
});

test('shared report request lifecycle preserves a non-TikTok platform scope', async () => {
  const d1 = createD1();
  const store = new D1ReportRequestStore({ db: d1, now: () => 1_780_000_200_100 });
  const claim = await store.claim({
    ...requestInput,
    requestId: 'report-request:meta_ads:1',
    platformScope: 'meta_ads',
  });
  assert.equal(claim.request.platformScope, 'meta_ads');
});
