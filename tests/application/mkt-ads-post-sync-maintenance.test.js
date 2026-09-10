import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeCampaignSummary,
  retainAdsDailyCache,
} from '../../packages/application/src/use-cases/mkt-ads-post-sync-maintenance.js';

const NOW = Date.parse('2026-09-06T01:00:00.000Z');

function aggregateRow() {
  return {
    platform: 'google_ads',
    account_key: 'chemistry_k',
    source_account_id: '3328797186',
    external_campaign_id: 'cmp-1',
    currency: 'THB',
    campaign_name: 'Campaign One',
    status: 'ENABLED',
    spend_micros: 2_000_000,
    impressions: 1000,
    clicks: 50,
    conversions: 4,
    conversion_value_micros: 8_000_000,
    source_fetched_at: Date.parse('2026-09-06T00:30:00.000Z'),
  };
}

function summaryDb(rows = [aggregateRow()]) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM ads_daily_facts f/u);
      return {
        bind(customerKey, periodStart, periodEnd, limit) {
          assert.equal(customerKey, 'chemistry_k');
          assert.equal(periodStart, '2026-09-01');
          assert.equal(periodEnd, '2026-09-06');
          assert.equal(limit, 1001);
          return { async all() { return { results: rows }; } };
        },
      };
    },
  };
}

test('campaign summary materializes one MTD row from D1 aggregate totals', async () => {
  let plannedRows = null;
  let planCalls = 0;
  const result = await materializeCampaignSummary({
    db: summaryDb(),
    repository: {},
    syncEngine: {
      async planByKey(input) {
        planCalls += 1;
        assert.equal(input.tableId, 'campaign-summary');
        assert.equal(input.keyField, 'campaign_summary_key');
        plannedRows = input.rows;
        return planCalls === 1
          ? { duplicateInputRows: 0 }
          : { duplicateInputRows: 0, createRows: [], updateRows: [], skipped: input.rows.length };
      },
      async executePlan() {
        return { created: 1, updated: 0, skipped: 0, duplicateInputRows: 0 };
      },
    },
    tableId: 'campaign-summary',
    customerKey: 'chemistry_k',
    timezone: 'Asia/Bangkok',
    now: NOW,
  });

  assert.equal(result.campaigns, 1);
  assert.equal(result.created, 1);
  assert.equal(result.readback.reconciled, true);
  assert.equal(planCalls, 2);
  assert.equal(plannedRows[0].campaign_summary_key, 'google_ads:3328797186:cmp-1:mtd:2026-09');
  assert.equal(plannedRows[0].spend, 2);
  assert.equal(plannedRows[0].ctr, 0.05);
  assert.equal(plannedRows[0].cpc, 0.04);
  assert.equal(plannedRows[0].cpm, 2);
  assert.equal(plannedRows[0].cpa, 0.5);
  assert.equal(plannedRows[0].conversion_value, 8);
  assert.equal(plannedRows[0].roas, 4);
  assert.equal(plannedRows[0].last_synced_at, Date.parse('2026-09-06T00:30:00.000Z'));
});

function retentionDb({ verified = true, activeLocks = 0 } = {}) {
  return {
    prepare(sql) {
      if (sql.includes('FROM sync_locks')) {
        return { bind() { return { async first() { return { active_locks: activeLocks }; } }; } };
      }
      if (sql.includes('FROM ads_daily_facts')) {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: verified ? [{
                    platform: 'google_ads',
                    source_account_id: '3328797186',
                    report_level: 'campaign',
                    external_entity_id: 'cmp-1',
                    metric_date: '2026-05-01',
                  }] : [],
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function oldDailyRecord() {
  return {
    recordId: 'rec-old',
    fields: {
      ads_daily_key: 'google_ads:3328797186:campaign:cmp-1:2026-05-01',
      metric_date: Date.parse('2026-04-30T17:00:00.000Z'),
      platform: 'google_ads',
      account_id: '3328797186',
      entity_type: 'campaign',
      external_entity_id: 'cmp-1',
    },
  };
}

function retentionClient({ total = 17000, verifiedReadback = true } = {}) {
  let countCalls = 0;
  let deleteCalls = 0;
  const searchInputs = [];
  return {
    appToken: 'app-token',
    get deleteCalls() { return deleteCalls; },
    get searchInputs() { return searchInputs; },
    async requestBitableJson() {
      countCalls += 1;
      return { data: { total: countCalls === 1 ? total : total - deleteCalls } };
    },
    async searchRecords(input) { searchInputs.push(input); return [oldDailyRecord()]; },
    async batchDeleteRecords(input) {
      deleteCalls += input.recordIds.length;
      await input.beforeChunk();
      return { deleted: input.recordIds.length };
    },
    async searchRecordsByFieldValues() {
      return verifiedReadback ? [] : [oldDailyRecord()];
    },
  };
}

test('Ads Daily retention deletes only D1-proven exact identities in bounded batches', async () => {
  const client = retentionClient();
  const result = await retainAdsDailyCache({
    db: retentionDb(),
    client,
    tableId: 'ads-daily',
    customerKey: 'chemistry_k',
    timezone: 'Asia/Bangkok',
    now: NOW,
    retentionDays: 90,
    softLimit: 17000,
    targetLimit: 15000,
    maxDeleteRows: 500,
  });

  assert.equal(result.pressureTriggered, true);
  assert.equal(result.d1Verified, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.recordsBefore, 17000);
  assert.equal(result.recordsAfter, 16999);
  assert.equal(result.d1Mutations, 0);
  assert.equal(client.deleteCalls, 1);
  assert.deepEqual(client.searchInputs[0].filter, {
    conjunction: 'and',
    conditions: [{
      fieldName: 'metric_date',
      operator: 'isLess',
      value: ['ExactDate', String(Date.parse('2026-06-08T17:00:00.000Z'))],
    }],
  });
});

test('Ads Daily retention preserves a candidate when D1 history proof is missing', async () => {
  const client = retentionClient({ total: 12000 });
  const result = await retainAdsDailyCache({
    db: retentionDb({ verified: false }),
    client,
    tableId: 'ads-daily',
    customerKey: 'chemistry_k',
    timezone: 'Asia/Bangkok',
    now: NOW,
    retentionDays: 90,
    softLimit: 17000,
    targetLimit: 15000,
    maxDeleteRows: 500,
  });

  assert.equal(result.deleted, 0);
  assert.equal(result.safetyBlocked, 1);
  assert.equal(client.deleteCalls, 0);
});

test('Ads Daily retention preserves a row when metric_date disagrees with the stable key', async () => {
  const client = retentionClient({ total: 12000 });
  client.searchRecords = async () => [{
    ...oldDailyRecord(),
    fields: {
      ...oldDailyRecord().fields,
      metric_date: Date.parse('2026-05-01T17:00:00.000Z'),
    },
  }];
  const result = await retainAdsDailyCache({
    db: retentionDb(),
    client,
    tableId: 'ads-daily',
    customerKey: 'chemistry_k',
    timezone: 'Asia/Bangkok',
    now: NOW,
  });
  assert.equal(result.deleted, 0);
  assert.equal(result.safetyBlocked, 1);
  assert.equal(client.deleteCalls, 0);
});

test('Ads Daily retention fails before any delete while another sync lock is active', async () => {
  const client = retentionClient();
  await assert.rejects(() => retainAdsDailyCache({
    db: retentionDb({ activeLocks: 1 }),
    client,
    tableId: 'ads-daily',
    customerKey: 'chemistry_k',
    now: NOW,
  }), (error) => error?.code === 'MKT_ADS_DAILY_RETENTION_ACTIVE_LOCK');
  assert.equal(client.deleteCalls, 0);
});

test('Ads Daily retention rejects a delete cap above the reviewed 500-row maximum', async () => {
  const client = retentionClient();
  await assert.rejects(() => retainAdsDailyCache({
    db: retentionDb(),
    client,
    tableId: 'ads-daily',
    customerKey: 'chemistry_k',
    now: NOW,
    maxDeleteRows: 501,
  }), /maxDeleteRows cannot exceed 500/u);
  assert.equal(client.deleteCalls, 0);
});
