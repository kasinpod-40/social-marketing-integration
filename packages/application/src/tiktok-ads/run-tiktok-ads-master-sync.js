import { buildTikTokAdsMasterWriteSet } from './tiktok-ads-master-write-set.js';
import { createAdsEntityKey } from '../storage/marketing-history-contract.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';
import { assertMktAdsMaintenanceIdle, countLarkRecords } from '../use-cases/mkt-ads-post-sync-maintenance.js';
import { createExplicitNullUpdateRepository } from '../../../sync-engine/src/explicit-null-update-repository.js';

const FIELDS = ['parent_campaign_id', 'parent_ad_group_id', 'parent_ad_id', 'external_creative_id',
  'entity_name', 'status', 'objective', 'currency', 'timezone'];
const SPECS = [['accounts', 'mktAdsAccounts', 'ads_account_key'], ['campaigns', 'mktAdsCampaigns', 'ads_campaign_key'],
  ['adGroups', 'mktAdsAdGroups', 'ads_ad_group_key'], ['ads', 'mktAdsAds', 'ads_ad_key'],
  ['creatives', 'mktAdsCreatives', 'ads_creative_key']];

/** Full master reconciliation: พรีวิวทุกตารางก่อนเขียน, ไม่ลบ, readback/replayใช้contractเดิม */
export async function runTikTokAdsMasterSync(input) {
  if (input.execute && input.writeEnabled !== true) fail('WRITE_DISABLED');
  const inventories = {};
  for (const kind of ['campaign', 'ad_group', 'ad', 'smart_ad']) {
    inventories[kind] = await input.client.listEntityMetadata({ kind, advertiserId: input.advertiserId,
      accessToken: input.accessToken });
  }
  const account = await input.client.getAdvertiser({ advertiserId: input.advertiserId, accessToken: input.accessToken });
  if (account.advertiserId !== input.advertiserId || account.currency !== input.currency
    || account.timezone !== input.timezone) fail('ACCOUNT_CONFLICT');
  const runId = `tiktok_ads:master:${input.accountKey}:${crypto.randomUUID()}`;
  const snapshot = await buildTikTokAdsMasterWriteSet({ ...input, accountName: account.advertiserName,
    inventories, now: Date.now(), syncRunId: runId });
  if (!input.execute) return reconcile({ ...input, snapshot });
  // Sourceอ่านครบก่อนlease เพื่อลดระยะเวลาถือlock; ทุกmutationตามrenewedlease
  await assertMktAdsMaintenanceIdle({ db: input.db, now: Date.now() });
  const lockKey = `tiktok_ads:master:${input.accountKey}`;
  const ownerId = crypto.randomUUID();
  if (!(await input.lockStore.acquire({ lockKey, ownerId, leaseMs: 120_000 })).acquired) retry('LOCKED');
  const audit = { syncId: runId, customerProfile: input.customerKey, platform: 'tiktok_ads',
    accountKey: input.accountKey, source: 'tiktok_ads.full_inventory', syncType: 'master', startedAt: Date.now() };
  try {
    await input.lockStore.saveSyncRun({ ...audit, status: 'running' });
    const result = await reconcile({ ...input, snapshot, beforeWriteChunk: async () => {
      if (!(await input.lockStore.renew({ lockKey, ownerId, leaseMs: 120_000 })).renewed) retry('LEASE_LOST');
    } });
    await input.lockStore.saveSyncRun({ ...audit, status: 'success', finishedAt: Date.now(),
      recordsPulled: snapshot.entities.length, recordsWritten: result.d1Changed,
      recordsSkipped: snapshot.entities.length - result.d1Changed });
    return result;
  } catch (error) {
    await input.lockStore.saveSyncRun({ ...audit, status: 'failed', finishedAt: Date.now(),
      errorCode: error.code ?? 'TIKTOK_ADS_MASTER_FAILED', errorMessage: 'Master reconciliation failed' });
    throw error;
  } finally { await input.lockStore.release({ lockKey, ownerId }); }
}
async function readStored(input) {
  const response = await input.db.prepare(`SELECT * FROM ads_entity_state
    WHERE platform = 'tiktok_ads' AND account_key = ? LIMIT 20001`).bind(input.accountKey).all();
  const rows = response?.results ?? [];
  if (rows.length > 20_000 || new Set(rows.map(row => row.entity_key)).size !== rows.length
    || rows.some(row => row.customer_key !== input.customerKey || row.source_account_id !== input.advertiserId
      || row.entity_key !== createAdsEntityKey(row))) fail('STORED_IDENTITY_CONFLICT');
  return new Map(rows.map(row => [row.entity_key, row]));
}
async function reconcile(input) {
  const stored = await readStored(input);
  const expected = input.snapshot.entities.map(row => {
    const current = stored.get(row.entity_key);
    if (!current) return row;
    if ((current.external_creative_id != null && row.external_creative_id === null)
      || (current.parent_ad_id != null && row.parent_ad_id === null)) fail('STORED_REFERENCE_CONFLICT');
    return { ...row, entity_name: row.entity_name ?? current.entity_name,
      objective: row.objective ?? current.objective, status: row.status === 'unknown' ? current.status ?? 'unknown' : row.status,
      first_seen_at: current.first_seen_at, created_at: current.created_at,
      last_seen_at: Math.max(row.last_seen_at, current.last_seen_at),
      last_coverage_run_id: current.last_coverage_run_id };
  });
  const changed = expected.filter(row => !stored.has(row.entity_key)
    || FIELDS.some(field => stored.get(row.entity_key)[field] !== row[field]));
  const scopedRepository = Object.create(input.repository);
  if (typeof input.repository.searchRecords === 'function') {
    scopedRepository.listByFieldValues = async (tableId, keyField) => {
      const type = { ads_account_key: 'account', ads_campaign_key: 'campaign', ads_ad_group_key: 'ad_group',
        ads_ad_key: 'ad', ads_creative_key: 'creative' }[keyField];
      const prefix = `tiktok_ads:${input.advertiserId}:${type}:`;
      const records = await input.repository.searchRecords(tableId, {
        filter: { conjunction: 'and', conditions: [{ field_name: keyField, operator: 'contains', value: [prefix] }] },
        pageSize: 500, maxPages: 34, maxItems: 17_000,
      });
      const normalized = await input.repository.prepareExistingRecords(tableId, records,
        { incomingFieldNames: [keyField, 'platform', 'account_id'] });
      if (normalized.some(record => record.fields.platform !== 'tiktok_ads'
        || record.fields.account_id !== input.advertiserId
        || !record.fields[keyField]?.startsWith(prefix))) fail('LARK_STORED_IDENTITY_CONFLICT');
      // คืน scoped snapshot ให้ sync engine normalize Rich text และตรวจ duplicate โดยไม่ใช้ String(object)
      return records;
    };
  }
  const nullRepository = createExplicitNullUpdateRepository({ repository: scopedRepository,
    fieldNames: ['external_creative_id'] });
  const specs = SPECS.map(([collection, table, key]) => ({ tableId: input.tables[table], keyField: key,
    rows: input.snapshot.canonical[collection], repository: collection === 'ads' ? nullRepository : scopedRepository }));
  const plans = [];
  for (const spec of specs) {
    if (input.execute) await input.beforeWriteChunk();
    const plan = await input.syncEngine.planByKey(spec);
    if (plan.duplicateInputRows) fail('LARK_DUPLICATE');
    if (await countLarkRecords(input.larkClient, spec.tableId) + plan.createRows.length > 17_000) fail('LARK_CAPACITY');
    plans.push(plan);
    if (input.execute) await input.beforeWriteChunk();
  }
  const result = { mode: input.execute ? 'execute' : 'preview', d1Changed: changed.length,
    d1Skipped: expected.length - changed.length, unavailableCreativeIds: input.snapshot.unavailableCreativeIds,
    unmappedImageOnlyAds: input.snapshot.unmappedImageOnlyAds,
    tables: plans.map((plan, index) => ({ dataset: SPECS[index][0], rows: specs[index].rows.length,
      created: plan.createRows.length, updated: plan.updateRows.length, skipped: plan.skipped })) };
  if (!input.execute) return result;
  for (let offset = 0; offset < changed.length; offset += 100) {
    await input.beforeWriteChunk();
    await input.historyStore.writeMetaD1Operations(changed.slice(offset, offset + 100).map(row => ({ kind: 'ads_entity', row })));
  }
  const readback = await readStored(input);
  if (expected.some(row => FIELDS.some(field => readback.get(row.entity_key)?.[field] !== row[field]))) retry('D1_READBACK_MISMATCH');
  for (const plan of plans) await input.syncEngine.executePlan(plan, { beforeWriteChunk: input.beforeWriteChunk });
  for (const spec of specs) {
    if (input.execute) await input.beforeWriteChunk();
    const plan = await input.syncEngine.planByKey(spec);
    if (plan.createRows.length || plan.updateRows.length || plan.skipped !== spec.rows.length) retry('LARK_READBACK_MISMATCH');
  }
  return { ...result, reconciled: true };
}
function fail(code) { throw permanentError('TikTok Ads master preflight failed', { code: `TIKTOK_ADS_MASTER_${code}` }); }
function retry(code) { throw transientError('TikTok Ads master reconciliation failed', { code: `TIKTOK_ADS_MASTER_${code}` }); }
