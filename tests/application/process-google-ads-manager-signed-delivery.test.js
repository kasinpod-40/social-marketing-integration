import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleAdsQueueReference } from '../../packages/application/src/google-ads/google-ads-queue-reference.js';
import { processGoogleAdsManagerSignedDelivery } from '../../packages/application/src/use-cases/process-google-ads-manager-signed-delivery.js';
import {
  createGoogleAdsDeliveryEnvelope,
  createGoogleAdsDeliveryManifest,
  googleAdsDatasetRows,
} from '../helpers/google-ads-manager-delivery-fixture.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const RUN_STARTED_AT = Date.parse('2026-07-25T04:00:00.000Z');

const EXPECTED_LARK_KEY_CONTRACT = Object.freeze([
  Object.freeze({ tableId: 'accounts', keyField: 'ads_account_key' }),
  Object.freeze({ tableId: 'campaigns', keyField: 'ads_campaign_key' }),
  Object.freeze({ tableId: 'asset-groups', keyField: 'ads_asset_group_key' }),
  Object.freeze({ tableId: 'ad-groups', keyField: 'ads_ad_group_key' }),
  Object.freeze({ tableId: 'ads', keyField: 'ads_ad_key' }),
  Object.freeze({ tableId: 'creatives', keyField: 'ads_creative_key' }),
  Object.freeze({ tableId: 'daily', keyField: 'ads_daily_key' }),
]);

function liveEnvelopes() {
  const manifest = createGoogleAdsDeliveryManifest(Object.fromEntries([
    'campaigns', 'assetGroups', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics',
  ].map((key) => [key, { totalRows: 1, chunkCount: 1 }])));
  return ['account', 'campaigns', 'assetGroups', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics']
    .map((datasetKey) => createGoogleAdsDeliveryEnvelope({
      mode: 'LIVE',
      datasetKey,
      rows: googleAdsDatasetRows(datasetKey),
      manifest,
    }));
}

function createFixture() {
  const envelopes = liveEnvelopes();
  const phases = new Map();
  const continuations = [];
  const historyCalls = [];
  const planCalls = [];
  let completion = null;
  const admission = {
    operationId: RUN_ID,
    workKey: `google_ads:${RUN_ID}`,
    generation: RUN_STARTED_AT,
    originalRequestedAt: RUN_STARTED_AT,
    status: 'queued',
    reconciliation: null,
  };
  const admissionStore = {
    async getByOperationId() { return { ...admission }; },
    async markProcessing() { admission.status = 'processing'; return { ...admission }; },
    async markFailed(input) { admission.status = input.retryable ? 'failed_retryable' : 'failed_permanent'; admission.lastErrorCode = input.errorCode; return { ...admission }; },
    async markCompleted(input) { admission.status = 'completed'; admission.reconciliation = input.reconciliation; return { ...admission }; },
  };
  const deliveryStore = {
    async getRun() {
      return {
        runId: RUN_ID,
        mode: 'LIVE',
        runStartedAt: RUN_STARTED_AT,
        receivedChunkCount: envelopes.length,
        expectedChunkCount: envelopes.length,
        receivedRowCount: envelopes.length,
        expectedRowCount: envelopes.length,
        payloadRedactedAt: null,
        manifestDigest: 'a'.repeat(64),
      };
    },
    async listRunChunks() {
      return envelopes.map((envelope) => ({ payloadJson: JSON.stringify(envelope) }));
    },
  };
  const resumableWorkStore = {
    async beginWork() {
      return completion
        ? { completed: true, completion, resumed: true, superseded: false }
        : { completed: false, resumed: phases.size > 0, superseded: false };
    },
    async loadPhase({ phase }) { return phases.get(phase) ?? null; },
    async savePhase(input) {
      const value = {
        state: structuredClone(input.state),
        expectedItems: input.expectedItems,
        processedItems: input.processedItems,
        pagesProcessed: input.pagesProcessed,
        chunksProcessed: input.chunksProcessed,
        complete: input.complete,
      };
      phases.set(input.phase, value);
      return value;
    },
    async completeWork(input) { completion = input.completion; return true; },
  };
  const historyStore = {
    async upsertAdsEntityState(row) { historyCalls.push(['entity', row.entity_key]); return { status: 'created' }; },
    async upsertAdsDailyFact(row) { historyCalls.push(['daily', row.ads_fact_key]); return { status: 'created' }; },
    async saveCoverageRun(row) { historyCalls.push(['coverage_run', row.coverage_run_id]); return { status: 'created' }; },
    async saveCoverageEntities(rows) { historyCalls.push(['coverage_entity', rows[0].coverage_entity_key]); return [{ status: 'created' }]; },
  };
  const syncEngine = {
    async planByKey(input) {
      for (const [index, row] of input.rows.entries()) {
        assert.equal(
          typeof row[input.keyField],
          'string',
          `${input.tableId}[${index}] must contain string key ${input.keyField}`,
        );
        assert.notEqual(
          row[input.keyField].trim(),
          '',
          `${input.tableId}[${index}] must contain non-empty key ${input.keyField}`,
        );
      }
      planCalls.push(Object.freeze({
        tableId: input.tableId,
        keyField: input.keyField,
        rowCount: input.rows.length,
      }));
      return {
        repository: input.repository,
        tableId: input.tableId,
        keyField: input.keyField,
        createRows: input.rows,
        updateRows: [],
        skipped: 0,
        duplicateInputRows: 0,
      };
    },
    async executePlan(plan) {
      return { created: plan.createRows.length, updated: 0, skipped: plan.skipped, duplicateInputRows: 0 };
    },
  };
  return {
    admission,
    continuations,
    historyCalls,
    planCalls,
    input: {
      queueReference: buildGoogleAdsQueueReference({ runId: RUN_ID, runStartedAt: RUN_STARTED_AT }),
      admissionStore,
      deliveryStore,
      historyStore,
      resumableWorkStore,
      repository: {},
      syncEngine,
      continuationQueue: { async send(body) { continuations.push(structuredClone(body)); } },
      tables: {
        rawAdsEntities: 'raw-entities',
        rawAdsDaily: 'raw-daily',
        mktAdsAccounts: 'accounts',
        mktAdsCampaigns: 'campaigns',
        mktAdsAssetGroups: 'asset-groups',
        mktAdsAdGroups: 'ad-groups',
        mktAdsAds: 'ads',
        mktAdsCreatives: 'creatives',
        mktAdsDaily: 'daily',
      },
      syncRunId: 'sync-run-attempt',
      cursorKey: 'google_ads:fixture_account',
      businessWriteEnabled: true,
      larkWriteEnabled: true,
      maxD1RowsPerInvocation: 100,
      now: () => Date.parse('2026-07-25T04:05:00.000Z'),
    },
  };
}

test('durable processor completes D1 first then one Lark table per continuation', async () => {
  const fixture = createFixture();
  let result;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    result = await processGoogleAdsManagerSignedDelivery(fixture.input);
    if (result.status === 'completed') break;
  }
  assert.equal(result.status, 'completed');
  assert.equal(fixture.admission.status, 'completed');
  assert.equal(fixture.historyCalls.length, 18);
  assert.equal(fixture.continuations.length, 6);
  assert.equal(fixture.continuations.every((body) => body.operationId === RUN_ID), true);
  assert.equal(result.reconciliation.failed, 0);
  assert.equal(result.reconciliation.lark.length, 7);

  const normalizedCalls = fixture.planCalls.map(({ tableId, keyField }) => ({ tableId, keyField }));
  assert.equal(normalizedCalls.length, EXPECTED_LARK_KEY_CONTRACT.length * 2);
  assert.deepEqual(
    normalizedCalls.slice(0, EXPECTED_LARK_KEY_CONTRACT.length),
    EXPECTED_LARK_KEY_CONTRACT,
    'destination preflight must use the exact customer-facing stable-key contract',
  );
  assert.deepEqual(
    normalizedCalls.slice(EXPECTED_LARK_KEY_CONTRACT.length),
    EXPECTED_LARK_KEY_CONTRACT,
    'one-table-per-continuation Lark writes must reuse the exact preflight key contract',
  );
});

test('completed admission returns idempotently without another business write', async () => {
  const fixture = createFixture();
  fixture.admission.status = 'completed';
  fixture.admission.reconciliation = { schemaVersion: 'google_ads_business_reconciliation_v1' };
  const result = await processGoogleAdsManagerSignedDelivery(fixture.input);
  assert.equal(result.status, 'completed_idempotent');
  assert.equal(fixture.historyCalls.length, 0);
  assert.equal(fixture.continuations.length, 0);
  assert.equal(fixture.planCalls.length, 0);
});

test('processor fails closed before reading admission when either write gate is false', async () => {
  const fixture = createFixture();
  await assert.rejects(
    () => processGoogleAdsManagerSignedDelivery({ ...fixture.input, larkWriteEnabled: false }),
    (error) => error.code === 'GOOGLE_ADS_PROCESSING_GATES_DISABLED',
  );
  assert.equal(fixture.historyCalls.length, 0);
  assert.equal(fixture.planCalls.length, 0);
});
