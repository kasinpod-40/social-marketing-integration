import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTikTokAdsDailyLark } from '../../packages/application/src/tiktok-ads/project-tiktok-ads-daily-lark.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

function fixture() {
  const facts = [{ customer_key: 'demo', platform: 'tiktok_ads', account_key: 'demo', source_account_id: '123',
    external_entity_id: '456', external_campaign_id: '456', report_level: 'campaign', entity_type: 'campaign',
    metric_date: '2026-10-02', breakdown_key: 'none', segment_key: 'none', account_timezone: 'Asia/Bangkok',
    currency: 'THB', spend_micros: 12_340_000, impressions: 1000, clicks: 10 }];
  const coverage = [{ completed_at: 1, failed_rows: 0, status: 'revisable', expected_rows: 1, observed_rows: 1 }];
  const records = new Map([['campaigns', []], ['daily', []]]);
  const calls = [];
  const state = { facts, coverage, total: 100, active: 0, acquired: true, renewed: true, failDaily: false, drift: false };
  const repository = {
    async prepareRows(table, rows) {
      if (table === 'daily' && state.schemaFailure) throw new Error('Schema conflict');
      return rows.map(row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)));
    },
    async prepareExistingRecords(table, rows) { return rows.map(row => ({ ...row,
      fields: Object.fromEntries(Object.entries(row.fields).filter(([, v]) => v !== null)) })); },
    async listByFieldValues(table, key, values) {
      return records.get(table).filter(row => values.includes(row.fields[key])).map(row => state.drift && table === 'daily'
        ? { ...row, fields: { ...row.fields, clicks: 99 } } : row);
    },
    async createMany(table, rows, options) {
      await options.beforeChunk(); calls.push(`create:${table}`);
      if (table === 'daily' && state.failDaily) throw new Error('Network failed');
      for (const row of rows) records.get(table).push({ recordId: `${table}-${records.get(table).length}`, fields: { ...row } });
      return { created: rows.length };
    },
    async updateMany(table, rows, options) {
      await options.beforeChunk(); calls.push(`update:${table}`);
      for (const row of rows) Object.assign(records.get(table).find(record => record.recordId === row.recordId).fields, row.fields);
      return { updated: rows.length };
    },
  };
  const input = { date: '2026-10-02', now: Date.parse('2026-10-03T06:00:00Z'), timezone: 'Asia/Bangkok', currency: 'THB',
    customerKey: 'demo', accountKey: 'demo', advertiserId: '123', execute: false, writeEnabled: true,
    tables: { mktAdsCampaigns: 'campaigns', mktAdsDaily: 'daily' }, repository, syncEngine: new TableSyncEngine(),
    client: { appToken: 'test', async requestBitableJson() { return { data: { total: state.total } }; } },
    db: { prepare(sql) { return { bind() { return {
      async all() { return { results: sql.includes('data_coverage_runs') ? state.coverage : state.facts }; },
      async first() { return { active_locks: state.active }; },
    }; } }; } },
    lockStore: { async acquire() { calls.push('acquire'); return { acquired: state.acquired }; },
      async renew() { return { renewed: state.renewed }; }, async release() { calls.push('release'); } },
  };
  return { input, state, calls, records };
}

test('projection preview is read-only; write/replay reconcile exact advertiser keys and null metrics', async () => {
  const f = fixture();
  const preview = await projectTikTokAdsDailyLark(f.input);
  assert.equal(preview.tables[1].created, 1);
  assert.deepEqual(f.calls, []);
  const result = await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  assert.equal(result.reconciled, true);
  const row = f.records.get('daily')[0].fields;
  assert.equal(row.ads_daily_key, 'tiktok_ads:123:campaign:456:2026-10-02');
  assert.equal(row.metric_date, Date.parse('2026-10-01T17:00:00Z'));
  assert.equal(row.spend, 12.34);
  assert.equal(row.ctr, 0.01);
  assert.equal(row.conversions, undefined);
  assert.equal(row.actual_roas, undefined);
  const replay = await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  assert.deepEqual(replay.tables.map(value => [value.created, value.updated, value.skipped]), [[0, 0, 1], [0, 0, 1]]);
});

test('projection reads proved metadata; wrong metadata owner blocks Campaign and Daily writes', async () => {
  const f = fixture();
  Object.assign(f.state.facts[0], { campaign_name: 'Verified campaign', campaign_status: 'paused',
    campaign_objective: 'TRAFFIC', metadata_account_id: '123' });
  await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  assert.equal(f.records.get('campaigns')[0].fields.campaign_name, 'Verified campaign');
  assert.equal(f.records.get('campaigns')[0].fields.status, 'paused');
  assert.equal(f.records.get('campaigns')[0].fields.objective, 'TRAFFIC');
  const replay = await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  assert.deepEqual(replay.tables.map(row => row.updated), [0, 0]);
  f.state.facts[0].metadata_account_id = '999';
  f.calls.length = 0;
  await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }));
  assert.deepEqual(f.calls, ['acquire', 'release']);
});

test('projection rejects partial/missing/duplicate Coverage and identity mismatch before any Lark write', async () => {
  for (const mutate of [f => f.state.coverage.splice(0), f => f.state.coverage.push({ ...f.state.coverage[0] }),
    f => f.state.coverage[0].observed_rows++, f => f.state.coverage[0].failed_rows++,
    f => f.state.facts[0].source_account_id = '999', f => f.state.facts[0].segment_key = 'other',
    f => f.state.facts.push({ ...f.state.facts[0] })]) {
    const f = fixture(); mutate(f);
    await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }));
    assert.deepEqual(f.calls, ['acquire', 'release']);
  }
});

test('write gate, closed-day/cache bound, capacity, active lock and lease loss stop writes', async () => {
  for (const change of [{ writeEnabled: false }, { date: '2026-10-03' }, { date: '2025-09-01' }]) {
    const f = fixture(); await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true, ...change }));
    assert.equal(f.calls.some(value => value.startsWith('create:')), false);
  }
  for (const [name, value] of [['total', 17000], ['active', 1], ['acquired', false], ['renewed', false]]) {
    const f = fixture(); f.state[name] = value;
    await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }));
    assert.equal(f.calls.some(call => call.startsWith('create:')), false);
  }
});

test('partial second-table failure releases lock and retry creates only missing rows', async () => {
  const f = fixture(); f.state.failDaily = true;
  await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }));
  assert.equal(f.records.get('campaigns').length, 1);
  assert.equal(f.records.get('daily').length, 0);
  assert.equal(f.calls.at(-1), 'release');
  f.state.failDaily = false;
  const result = await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  assert.equal(result.tables[0].skipped, 1);
  assert.equal(result.tables[1].created, 1);
});

test('second-table schema conflict and destination duplicate stop before first-table write', async () => {
  const f = fixture(); f.state.schemaFailure = true;
  await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }));
  assert.deepEqual(f.calls, ['acquire', 'release']);
  f.state.schemaFailure = false;
  f.records.get('daily').push(...[1, 2].map(id => ({ recordId: `record-${id}`, fields: {
    ads_daily_key: 'tiktok_ads:123:campaign:456:2026-10-02',
  } })));
  await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }));
  assert.equal(f.records.get('campaigns').length, 0);
});

test('update clears unproved metrics and readback mismatch cannot report success', async () => {
  const f = fixture();
  await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  f.records.get('daily')[0].fields.conversions = 4;
  f.records.get('daily')[0].fields.actual_roas = 2;
  const result = await projectTikTokAdsDailyLark({ ...f.input, execute: true });
  assert.equal(result.tables[1].updated, 1);
  assert.equal(f.records.get('daily')[0].fields.conversions, null);
  assert.equal(f.records.get('daily')[0].fields.actual_roas, null);
  f.state.drift = true;
  await assert.rejects(projectTikTokAdsDailyLark({ ...f.input, execute: true }), { code: 'TIKTOK_ADS_LARK_READBACK_MISMATCH' });
});
