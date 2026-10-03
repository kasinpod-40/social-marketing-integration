import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTikTokAdsCampaignMetadata } from '../../packages/application/src/tiktok-ads/reconcile-tiktok-ads-campaign-metadata.js';

function fixture() {
  const rows = [{ entity_key: 'tiktok_ads:demo:campaign:456', customer_key: 'demo', platform: 'tiktok_ads',
    account_key: 'demo', source_account_id: '123', entity_type: 'campaign', external_entity_id: '456',
    parent_campaign_id: null, parent_ad_group_id: null, parent_ad_id: null, external_creative_id: null,
    entity_name: null, status: null, objective: null, currency: 'THB', timezone: 'Asia/Bangkok',
    source_updated_at: null, first_seen_at: 1, last_seen_at: 2, source_availability_status: 'available',
    metadata_hash: 'old', last_coverage_run_id: 'daily-coverage', last_sync_run_id: 'daily-run', created_at: 1, updated_at: 2 }];
  const metadata = [{ campaignId: '456', name: 'Example campaign', status: 'ENABLE', objective: 'TRAFFIC' }];
  const calls = [];
  const state = { active: 0, acquired: true, renewed: true, drift: false, failWrite: false };
  const input = { customerKey: 'demo', accountKey: 'demo', advertiserId: '123', execute: false, writeEnabled: true,
    accessToken: 'test-only', client: { async listCampaignMetadata() { return { rows: metadata, totalCount: metadata.length, pageCount: 1 }; } },
    db: { prepare() { return { bind() { return { async all() { return { results: rows.map(row => ({ ...row })) }; },
      async first() { return { active_locks: state.active }; } }; } }; } },
    historyStore: { async writeMetaD1Operations(operations) {
      calls.push('write');
      if (state.failWrite) { state.failWrite = false; throw Error('Transient write'); }
      for (const operation of operations) {
        assert.equal(operation.kind, 'ads_entity');
        Object.assign(rows.find(row => row.entity_key === operation.row.entity_key), operation.row);
      }
      if (state.drift) rows[0].entity_name = 'Changed elsewhere';
    } },
    lockStore: { async acquire() { calls.push('acquire'); return { acquired: state.acquired }; },
      async renew() { return { renewed: state.renewed }; }, async release() { calls.push('release'); },
      async saveSyncRun() {} },
  };
  return { input, rows, metadata, calls, state };
}

test('metadata preview is read-only; enrichment preserves Daily audit, and replay writes zero masters', async () => {
  const f = fixture();
  assert.equal((await reconcileTikTokAdsCampaignMetadata(f.input)).changed, 1);
  assert.deepEqual(f.calls, []);
  const first = await reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true });
  assert.equal(first.reconciled, true);
  assert.equal(f.rows[0].status, 'active');
  assert.equal(f.rows[0].entity_name, 'Example campaign');
  assert.equal(f.rows[0].first_seen_at, 1);
  assert.equal(f.rows[0].last_coverage_run_id, 'daily-coverage');
  const timestamp = f.rows[0].updated_at;
  f.calls.length = 0;
  assert.equal((await reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true })).changed, 0);
  assert.equal(f.rows[0].updated_at, timestamp);
  assert.deepEqual(f.calls, ['acquire', 'release']);
});

test('missing Campaign and absent/unknown metadata preserve verified values', async () => {
  const f = fixture();
  Object.assign(f.rows[0], { entity_name: 'Retained', status: 'paused', objective: 'TRAFFIC' });
  Object.assign(f.metadata[0], { name: null, status: 'FUTURE_STATUS', objective: null });
  const result = await reconcileTikTokAdsCampaignMetadata(f.input);
  assert.equal(result.unknownStatuses, 1);
  assert.equal(result.changed, 0);
  f.metadata.length = 0;
  assert.equal((await reconcileTikTokAdsCampaignMetadata(f.input)).unmatchedPreserved, 1);
  assert.equal(f.rows[0].status, 'paused');
});

test('duplicate source, stored key, owner mismatch and malformed master stop all writes', async () => {
  for (const mutate of [f => f.metadata.push({ ...f.metadata[0] }), f => f.rows.push({ ...f.rows[0] }),
    f => f.rows[0].source_account_id = '999', f => f.rows[0].customer_key = 'other',
    f => f.rows[0].entity_key = 'wrong', f => f.rows[0].created_at = null]) {
    const f = fixture(); mutate(f);
    await assert.rejects(reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true }));
    assert.equal(f.calls.includes('write'), false);
  }
});

test('gates, lease loss and readback drift fail closed; transient write can resume', async () => {
  for (const flag of ['active', 'acquired', 'renewed', 'drift']) {
    const f = fixture(); f.state[flag] = flag === 'active' ? 1 : flag === 'drift';
    await assert.rejects(reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true }));
    if (flag !== 'drift') assert.equal(f.calls.includes('write'), false);
  }
  const f = fixture();
  await assert.rejects(reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true, writeEnabled: false }));
  f.state.failWrite = true;
  await assert.rejects(reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true }));
  assert.equal(f.calls.at(-1), 'release');
  assert.equal((await reconcileTikTokAdsCampaignMetadata({ ...f.input, execute: true })).reconciled, true);
});
