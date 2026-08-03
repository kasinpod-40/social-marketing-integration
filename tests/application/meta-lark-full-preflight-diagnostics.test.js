import test from 'node:test';
import assert from 'node:assert/strict';

import { processMetaEndToEndGeneration } from '../../packages/application/src/use-cases/process-meta-end-to-end-generation.js';
import { serializeRowsForLark } from '../../packages/connectors/src/lark/lark-field-serializer.js';

const TABLES = Object.freeze({
  mktAdsAccounts: 'tbl_accounts',
  mktAdsCampaigns: 'tbl_campaigns',
  mktAdsAdGroups: 'tbl_ad_groups',
  mktAdsAds: 'tbl_ads',
});

const FIELDS = Object.freeze({
  tbl_accounts: Object.freeze([
    field('ads_account_key', 1),
    field('status', 3, ['active', 'paused', 'removed', 'unknown']),
    field('last_sync_at', 1001),
  ]),
  tbl_campaigns: Object.freeze([
    field('ads_campaign_key', 1),
    field('start_date', 5),
  ]),
  tbl_ad_groups: Object.freeze([
    field('ads_ad_group_key', 1),
    field('status', 3, ['active', 'paused', 'removed', 'deleted', 'unknown']),
  ]),
  tbl_ads: Object.freeze([
    field('ads_ad_key', 1),
    field('landing_page_url', 15),
  ]),
});

function field(fieldName, type, options = null) {
  return Object.freeze({
    fieldName,
    type,
    property: options === null
      ? null
      : Object.freeze({
        options: Object.freeze(options.map((name) => Object.freeze({ name }))),
      }),
  });
}

function writeSet() {
  return {
    operationId: 'meta_operation_full_preflight',
    connectorKey: 'meta_ads',
    context: {
      customerKey: 'chemistry_k',
      platform: 'meta_ads',
      accountKey: 'chemistry_k2',
      sourceAccountId: 'account_1',
      sourceTimezone: 'Asia/Bangkok',
      fetchedAt: 1785769599090,
      syncRunId: 'sync_full_preflight',
      sourceRevision: 'revision_full_preflight',
    },
    raw: {
      organicAccounts: [],
      organicContent: [],
      organicMetrics: [],
      adsEntities: [],
      adsDaily: [],
    },
    canonical: {
      accounts: [],
      accountDaily: [],
      content: [],
      contentDaily: [],
      adsAccounts: [{
        ads_account_key: 'meta_ads:account_1:account:account_1',
        status: 'SOURCE_ACTIVE',
        last_sync_at: 1785769599090,
      }],
      adsCampaigns: [{
        ads_campaign_key: 'meta_ads:account_1:campaign:campaign_1',
        start_date: '2026-07-01',
      }],
      adsAdGroups: [{
        ads_ad_group_key: 'meta_ads:account_1:ad_group:ad_group_1',
        status: 'SOURCE_PAUSED',
      }],
      adsAds: [{
        ads_ad_key: 'meta_ads:account_1:ad:ad_1',
        landing_page_url: 'not-an-absolute-url',
      }],
      adsCreatives: [],
      adsDaily: [],
    },
    d1: {
      organicHistoryBatch: null,
      accountDailyFacts: [],
      adsEntities: [],
      adsDailyFacts: [],
      coverageRuns: [],
      coverageEntities: [],
    },
    reconciliation: { sourceStatus: 'complete' },
  };
}

function workStore() {
  const phases = new Map();
  return {
    phases,
    async loadPhase({ workKey, phase }) {
      return phases.get(`${workKey}:${phase}`) ?? null;
    },
    async savePhase(value) {
      phases.set(`${value.workKey}:${value.phase}`, structuredClone(value));
      return value;
    },
    async completeWork() {
      throw new Error('completeWork must not run when preflight fails');
    },
  };
}

function historyStore(counters) {
  const blocked = async () => {
    counters.historyWrites += 1;
    throw new Error('D1 write must not run when Lark preflight fails');
  };
  return {
    upsertOrganicAccountDailyFact: blocked,
    upsertAdsEntityState: blocked,
    upsertAdsDailyFact: blocked,
    saveCoverageRun: blocked,
    saveCoverageEntities: blocked,
  };
}

test('reports every invalid field across all four Meta Ads Lark tables before planning or writing', async () => {
  const counters = { planCalls: 0, executeCalls: 0, historyWrites: 0 };
  const store = workStore();
  const repository = {
    async getTableFields(tableId) {
      return FIELDS[tableId];
    },
    async prepareRows(tableId, rows, context) {
      return serializeRowsForLark(rows, FIELDS[tableId], {
        tableId,
        keyField: context.keyField,
      });
    },
  };
  const syncEngine = {
    async planByKey() {
      counters.planCalls += 1;
      throw new Error('planByKey must not run when payload inspection fails');
    },
    async executePlan() {
      counters.executeCalls += 1;
      throw new Error('executePlan must not run when payload inspection fails');
    },
  };

  await assert.rejects(
    processMetaEndToEndGeneration({
      writeSet: writeSet(),
      resumableWorkStore: store,
      historyStore: historyStore(counters),
      repository,
      syncEngine,
      tables: TABLES,
      workKey: 'meta:work:full-preflight',
      d1WriteEnabled: true,
      larkWriteEnabled: true,
      maxD1RowsPerInvocation: 250,
      maxLarkTablesPerInvocation: 4,
    }),
    (error) => {
      assert.equal(error.code, 'LARK_PREFLIGHT_FAILED');
      assert.equal(error.details.tablesChecked, 4);
      assert.equal(error.details.rowsChecked, 4);
      assert.equal(error.details.issueCount, 4);
      assert.equal(error.details.issuesTruncated, false);
      assert.deepEqual(
        error.details.issues.map(({ tableKey, fieldName, reasonCode, destinationType, incomingType }) => ({
          tableKey,
          fieldName,
          reasonCode,
          destinationType,
          incomingType,
        })),
        [
          {
            tableKey: 'mktAdsAccounts',
            fieldName: 'last_sync_at',
            reasonCode: 'DESTINATION_TYPE_UNSUPPORTED',
            destinationType: 1001,
            incomingType: 'number',
          },
          {
            tableKey: 'mktAdsAccounts',
            fieldName: 'status',
            reasonCode: 'SELECT_OPTION_INVALID',
            destinationType: 3,
            incomingType: 'string',
          },
          {
            tableKey: 'mktAdsAdGroups',
            fieldName: 'status',
            reasonCode: 'SELECT_OPTION_INVALID',
            destinationType: 3,
            incomingType: 'string',
          },
          {
            tableKey: 'mktAdsAds',
            fieldName: 'landing_page_url',
            reasonCode: 'URL_INVALID',
            destinationType: 15,
            incomingType: 'string',
          },
          {
            tableKey: 'mktAdsCampaigns',
            fieldName: 'start_date',
            reasonCode: 'DATE_TIME_INVALID',
            destinationType: 5,
            incomingType: 'string',
          },
        ],
      );
      return true;
    },
  );

  assert.equal(counters.planCalls, 0);
  assert.equal(counters.executeCalls, 0);
  assert.equal(counters.historyWrites, 0);
  assert.equal(store.phases.size, 0);
});
