import { createAdsEntityKey, validateStorageRow } from '../storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';
import { assertMktAdsMaintenanceIdle } from '../use-cases/mkt-ads-post-sync-maintenance.js';

const FIELDS = ['entity_name', 'status', 'objective'];
const STATUS = Object.freeze({ ENABLE: 'active', DISABLE: 'paused', DELETE: 'removed' });

/** เติมเฉพาะ master ที่มีอยู่; การไม่พบใน API ไม่ใช่หลักฐานว่าถูกลบ */
export async function reconcileTikTokAdsCampaignMetadata(input) {
  if (!input.execute) return reconcile(input);
  if (input.writeEnabled !== true) fail('TIKTOK_ADS_METADATA_WRITE_DISABLED');
  await assertMktAdsMaintenanceIdle({ db: input.db, now: Date.now() });
  const lockKey = `tiktok_ads:campaign_metadata:${input.accountKey}`;
  const ownerId = crypto.randomUUID();
  const lease = await input.lockStore.acquire({ lockKey, ownerId, leaseMs: 120_000 });
  if (!lease.acquired) retry('TIKTOK_ADS_METADATA_LOCKED');
  const run = { syncId: `tiktok_ads:campaign_metadata:${input.accountKey}:${ownerId}`,
    customerProfile: input.customerKey, platform: 'tiktok_ads', accountKey: input.accountKey,
    source: 'tiktok_ads.campaign.get', syncType: 'campaign_metadata', startedAt: Date.now() };
  try {
    await input.lockStore.saveSyncRun({ ...run, status: 'running' });
    const result = await reconcile({ ...input, syncRunId: run.syncId, beforeWrite: async () => {
      const result = await input.lockStore.renew({ lockKey, ownerId, leaseMs: 120_000 });
      if (!result.renewed) retry('TIKTOK_ADS_METADATA_LEASE_LOST');
    } });
    await input.lockStore.saveSyncRun({ ...run, status: 'success', finishedAt: Date.now(),
      recordsPulled: result.sourceCampaigns, recordsUpdated: result.changed, recordsWritten: result.changed,
      recordsSkipped: result.skipped });
    return result;
  } catch (error) {
    await input.lockStore.saveSyncRun({ ...run, status: 'failed', finishedAt: Date.now(),
      errorCode: error.code ?? 'TIKTOK_ADS_METADATA_FAILED', errorMessage: 'Campaign metadata reconciliation failed' });
    throw error;
  } finally {
    await input.lockStore.release({ lockKey, ownerId });
  }
}

async function reconcile(input) {
  const source = await input.client.listCampaignMetadata({ accessToken: input.accessToken,
    advertiserId: input.advertiserId });
  if (!Array.isArray(source.rows) || source.rows.length > 500 || source.totalCount !== source.rows.length
    || new Set(source.rows.map(row => row.campaignId)).size !== source.rows.length
    || source.rows.some(row => !/^\d+$/u.test(row.campaignId))) fail('TIKTOK_ADS_METADATA_SOURCE_CONFLICT');
  const stored = await readMasters(input);
  const byId = new Map(source.rows.map(row => [row.campaignId, row]));
  const rows = [];
  let matched = 0;
  let unknownStatuses = 0;
  const now = Date.now();
  for (const current of stored) {
    const metadata = byId.get(current.external_entity_id);
    if (!metadata) continue;
    matched++;
    if (metadata.status !== null && !Object.hasOwn(STATUS, metadata.status)) unknownStatuses++;
    const next = { ...current, entity_name: metadata.name ?? current.entity_name,
      status: STATUS[metadata.status] ?? current.status, objective: metadata.objective ?? current.objective };
    if (FIELDS.every(field => next[field] === current[field])) continue;
    rows.push(validateStorageRow('ads_entity_state', { ...next,
      // ค่าเวลาการพบ source ใหม่ไม่ย้อนกลับ; Coverage ของ Daily ยังคงเดิม
      last_seen_at: Math.max(now, current.last_seen_at), updated_at: Math.max(now, current.updated_at),
      last_sync_run_id: input.syncRunId ?? current.last_sync_run_id,
      metadata_hash: await createStableFingerprint({ advertiserId: input.advertiserId,
        campaignId: current.external_entity_id, name: next.entity_name, status: next.status, objective: next.objective }),
    }));
  }
  const result = { mode: input.execute ? 'execute' : 'preview', sourceCampaigns: source.totalCount,
    pageCount: source.pageCount, storedCampaigns: stored.length, matchedCampaigns: matched,
    unmatchedPreserved: stored.length - matched, unknownStatuses, changed: rows.length,
    skipped: stored.length - rows.length };
  if (!input.execute) return result;
  for (let offset = 0; offset < rows.length; offset += 100) {
    await input.beforeWrite();
    await input.historyStore.writeMetaD1Operations(rows.slice(offset, offset + 100)
      .map(row => ({ kind: 'ads_entity', row })));
  }
  const readback = new Map((await readMasters(input)).map(row => [row.entity_key, row]));
  const changedByKey = new Map(rows.map(row => [row.entity_key, row]));
  const expected = stored.map(row => changedByKey.get(row.entity_key) ?? row);
  if (readback.size !== stored.length || expected.some(row => FIELDS.some(field =>
    readback.get(row.entity_key)?.[field] !== row[field]))) retry('TIKTOK_ADS_METADATA_READBACK_MISMATCH');
  return { ...result, reconciled: true };
}

async function readMasters(input) {
  const result = await input.db.prepare(`SELECT * FROM ads_entity_state
    WHERE platform = 'tiktok_ads' AND account_key = ? AND entity_type = 'campaign' LIMIT 501`)
    .bind(input.accountKey).all();
  const rows = result?.results ?? [];
  if (rows.length > 500 || new Set(rows.map(row => row.entity_key)).size !== rows.length
    || new Set(rows.map(row => row.external_entity_id)).size !== rows.length
    || rows.some(row => row.customer_key !== input.customerKey || row.source_account_id !== input.advertiserId
      || row.entity_key !== createAdsEntityKey({ platform: 'tiktok_ads', account_key: input.accountKey,
        entity_type: 'campaign', external_entity_id: row.external_entity_id }))) {
    fail('TIKTOK_ADS_METADATA_STORED_IDENTITY_CONFLICT');
  }
  return rows;
}

function fail(code) { throw permanentError('TikTok Ads Campaign metadata preflight failed', { code }); }
function retry(code) { throw transientError('TikTok Ads Campaign metadata reconciliation failed', { code }); }
