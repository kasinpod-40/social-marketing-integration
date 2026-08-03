import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  describeMetaK2PersistedError,
  replayMetaK2SourceCompleteValidation,
  selectMetaK2AuditColumn,
  summarizeMetaK2StagedUnits,
} from '../../scripts/lib/meta-k2-source-complete-failure-audit.js';

const identity = Object.freeze({
  connectorKey: 'meta_ads',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k_meta_ads',
  operationId: 'meta-operation-fixture',
  workKey: 'meta_ads:chemistry_k2:meta-operation-fixture',
  syncRunId: 'meta:meta_ads:chemistry_k2:meta-operation-fixture',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
});

function accountPayload() {
  return {
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey: 'meta_ads.account.latest',
    sourceEntityId: null,
    sourceStatus: 'complete',
    sourceWatermark: '2026-07-31T00:00:00Z',
    pageNumber: 1,
    rows: [{
      id: 'act_987650001',
      account_id: '987650001',
      name: 'Fixture Account',
      account_status: 1,
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
    }],
  };
}

function dailyPayload(overrides = {}) {
  return {
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey: 'meta_ads.performance.daily',
    sourceEntityId: null,
    sourceStatus: 'complete',
    sourceWatermark: '2026-07-31T00:00:00Z',
    pageNumber: 1,
    rows: [{
      account_id: '987650001',
      account_currency: 'THB',
      campaign_id: 'campaign_1',
      campaign_name: 'Campaign 1',
      adset_id: 'adset_1',
      adset_name: 'Ad Set 1',
      ad_id: 'ad_1',
      ad_name: 'Ad 1',
      date_start: '2026-07-31',
      date_stop: '2026-07-31',
      publisher_platform: 'facebook',
      spend: '1.000000',
      impressions: '10',
      reach: '8',
      clicks: '2',
      ...overrides,
    }],
  };
}

function completeState(unitCount, rowCount) {
  return {
    stage: 'complete',
    pageState: null,
    contentIds: [],
    contentIndex: 0,
    unitCount,
    rowCount,
    sourceWatermark: '2026-07-31T00:00:00Z',
  };
}

test('summarizes staged datasets without exposing staged rows', () => {
  const summary = summarizeMetaK2StagedUnits([accountPayload(), dailyPayload()]);
  assert.deepEqual(summary, {
    unitCount: 2,
    rowCount: 2,
    datasets: [
      { datasetKey: 'meta_ads.account.latest', unitCount: 1, rowCount: 1 },
      { datasetKey: 'meta_ads.performance.daily', unitCount: 1, rowCount: 1 },
    ],
  });
  assert.equal(JSON.stringify(summary).includes('campaign_1'), false);
});

test('persisted error descriptor keeps error semantics and redacts identity-shaped values', () => {
  const descriptor = describeMetaK2PersistedError({
    error_code: 'UNHANDLED_SYNC_ERROR',
    error_message: 'Entity 123456789012345 failed at https://example.invalid/path',
    error_details_json: JSON.stringify({
      code: 'META_ADS_ACTIVITY_IDENTITY_DRIFT',
      message: 'Hierarchy changed',
      entityId: '123456789012345',
      field: 'campaign_id',
    }),
  });
  assert.equal(descriptor.descriptor.error_code, 'UNHANDLED_SYNC_ERROR');
  assert.equal(descriptor.descriptor.error_message.includes('[IDENTIFIER_REDACTED]'), true);
  assert.equal(descriptor.descriptor.error_message.includes('[URL_REDACTED]'), true);
  assert.equal(descriptor.descriptor.error_details_json.entityId, '[REDACTED]');
  assert.equal(descriptor.descriptor.error_details_json.code, 'META_ADS_ACTIVITY_IDENTITY_DRIFT');
  assert.match(descriptor.fingerprint, /^[0-9a-f]{64}$/u);
});

test('column selection accepts only an available reviewed candidate', () => {
  assert.equal(
    selectMetaK2AuditColumn(['work_key', 'payload_json'], ['payload_json', 'payload'], 'payload'),
    'payload_json',
  );
  assert.throws(
    () => selectMetaK2AuditColumn(['work_key'], ['payload_json'], 'payload'),
    (error) => error?.code === 'META_K2_FAILURE_AUDIT_SCHEMA_INVALID',
  );
});

test('replays complete staged source through the real write-set builder without remote writes', async () => {
  const payloads = [accountPayload(), dailyPayload()];
  const result = await replayMetaK2SourceCompleteValidation({
    payloads,
    sourceState: completeState(2, 2),
    identity,
    generation: Date.parse('2026-07-31T10:00:00Z'),
    originalRequestedAt: Date.parse('2026-07-31T10:00:00Z'),
  });
  assert.equal(result.sourceAssemblyAccepted, true);
  assert.equal(result.writeSetAccepted, true);
  assert.equal(result.providerRequestCount, 0);
  assert.equal(result.localWriteSentinelCount, 1);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.replayError, null);
});

test('replay surfaces exact activity hierarchy drift before any remote write', async () => {
  const payloads = [
    accountPayload(),
    dailyPayload(),
    dailyPayload({ campaign_id: 'campaign_2', campaign_name: 'Campaign 2' }),
  ];
  const result = await replayMetaK2SourceCompleteValidation({
    payloads,
    sourceState: completeState(3, 3),
    identity,
    generation: Date.parse('2026-07-31T10:00:00Z'),
    originalRequestedAt: Date.parse('2026-07-31T10:00:00Z'),
  });
  assert.equal(result.sourceAssemblyAccepted, false);
  assert.equal(result.writeSetAccepted, false);
  assert.equal(result.providerRequestCount, 0);
  assert.equal(result.localWriteSentinelCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.replayError.code, 'META_ADS_ACTIVITY_IDENTITY_DRIFT');
  assert.deepEqual(result.replayError.safeDetails, { field: 'campaign_id' });
});

test('operator is read-only and never contains Worker or Queue mutation commands', async () => {
  const source = await readFile(
    new URL('../../scripts/meta-k2-source-complete-failure-audit.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /method: 'GET'/u);
  assert.doesNotMatch(source, /method: 'POST'/u);
  assert.doesNotMatch(source, /'versions',\s*'upload'/u);
  assert.doesNotMatch(source, /'wrangler',\s*'deploy'/u);
  assert.doesNotMatch(source, /queue.*send/iu);
  assert.match(source, /PRAGMA table_info/u);
  assert.match(source, /\bSELECT\b/u);
  assert.doesNotMatch(source, /[`'"]\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
  assert.match(source, /d1ReadCount: 8/u);
  assert.match(source, /recoveryAuthorized: false/u);
  assert.match(source, /rawPayloadPrinted: false/u);
});
