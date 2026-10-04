import { createAdsEntityKey as canonicalKey } from '../../../domain/src/entities/ads.js';
import { createAdsEntityKey, validateStorageRow } from '../storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const STATUS = Object.freeze({ ENABLE: 'active', DISABLE: 'paused', DELETE: 'removed' });
const TYPES = new Set(['MANUAL', 'SMART_PLUS', 'UPGRADED_SMART_PLUS']);

/** full snapshot เท่านั้น: แยก true Ad กับ Upgraded Creative ก่อนสร้าง stable keys */
export async function buildTikTokAdsMasterWriteSet(input) {
  const { advertiserId, customerKey, accountKey, currency, timezone, now, syncRunId } = input;
  if (!/^\d+$/u.test(advertiserId) || !customerKey || !accountKey || !/^[A-Z]{3}$/u.test(currency)
    || !Number.isSafeInteger(now) || now < 0 || !syncRunId) fail('IDENTITY_INVALID');
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const inventories = input.inventories;
  for (const kind of ['campaign', 'ad_group', 'ad', 'smart_ad']) {
    const rows = inventories[kind]?.rows;
    if (!Array.isArray(rows) || rows.length > 10_000 || inventories[kind].totalCount !== rows.length
      || new Set(rows.map(row => row.id)).size !== rows.length
      || rows.some(row => !/^\d+$/u.test(row.id) || row.kind !== kind)) fail('INVENTORY_INVALID');
  }
  const campaigns = new Map(inventories.campaign.rows.map(row => [row.id, row]));
  const groups = new Map(inventories.ad_group.rows.map(row => [row.id, row]));
  const legacy = new Map(inventories.ad.rows.map(row => [row.id, row]));
  if ([...campaigns.values()].some(row => !TYPES.has(row.automationType))
    || [...groups.values()].some(row => !campaigns.has(row.campaignId))) fail('HIERARCHY_INVALID');
  for (const row of [...legacy.values(), ...inventories.smart_ad.rows]) {
    if (!campaigns.has(row.campaignId) || groups.get(row.adGroupId)?.campaignId !== row.campaignId) fail('HIERARCHY_INVALID');
  }
  const creativeParents = new Map();
  let unavailableCreativeIds = 0;
  for (const ad of inventories.smart_ad.rows) {
    if (campaigns.get(ad.campaignId).automationType !== 'UPGRADED_SMART_PLUS'
      || !Array.isArray(ad.creativeIds) || ad.creativeItems === null) fail('SMART_IDENTITY_INVALID');
    unavailableCreativeIds += ad.creativeItems - ad.creativeIds.length;
    for (const id of ad.creativeIds) {
      const creative = legacy.get(id);
      if (!creative || creative.campaignId !== ad.campaignId || creative.adGroupId !== ad.adGroupId
        || (creativeParents.has(id) && creativeParents.get(id) !== ad.id)) fail('CREATIVE_PARENT_INVALID');
      creativeParents.set(id, ad.id);
    }
  }
  const entities = [];
  const canonical = { accounts: [], campaigns: [], adGroups: [], ads: [], creatives: [] };
  const seen = new Set();
  const add = async (type, row, fields, destination) => {
    const id = row.id;
    const key = createAdsEntityKey({ platform: 'tiktok_ads', account_key: accountKey,
      entity_type: type, external_entity_id: id });
    if (seen.has(key)) fail('DUPLICATE_ENTITY');
    seen.add(key);
    const state = {
      entity_key: key, customer_key: customerKey, platform: 'tiktok_ads', account_key: accountKey,
      source_account_id: advertiserId, entity_type: type, external_entity_id: id,
      parent_campaign_id: type === 'campaign' || type === 'account' ? null : row.campaignId ?? null,
      parent_ad_group_id: ['ad', 'creative'].includes(type) ? row.adGroupId ?? null : null,
      parent_ad_id: type === 'creative' ? creativeParents.get(id) ?? null : null,
      external_creative_id: type === 'creative' ? id : fields.external_creative_id ?? null,
      entity_name: row.name ?? null, status: STATUS[row.status] ?? 'unknown', objective: row.objective ?? null,
      currency, timezone, source_updated_at: null, first_seen_at: now, last_seen_at: now,
      source_availability_status: 'available', metadata_hash: '',
      last_coverage_run_id: `tiktok_ads:${accountKey}:master:${type}`, last_sync_run_id: syncRunId,
      created_at: now, updated_at: now,
    };
    state.metadata_hash = await createStableFingerprint({ ...state, first_seen_at: undefined,
      last_seen_at: undefined, created_at: undefined, updated_at: undefined, last_sync_run_id: undefined });
    entities.push(validateStorageRow('ads_entity_state', state));
    const keyField = { account: 'ads_account_key', campaign: 'ads_campaign_key', ad_group: 'ads_ad_group_key',
      ad: 'ads_ad_key', creative: 'ads_creative_key' }[type];
    canonical[destination].push({ [keyField]: canonicalKey({ platform: 'tiktok_ads', accountId: advertiserId,
      entityType: type, externalEntityId: id }), platform: 'tiktok_ads', account_id: advertiserId,
    status: state.status, ...fields });
  };
  await add('account', { id: advertiserId, name: input.accountName },
    { account_name: input.accountName, currency, timezone }, 'accounts');
  for (const row of campaigns.values()) await add('campaign', row, {
    external_campaign_id: row.id, campaign_name: row.name, objective: row.objective, ad_channel: 'tiktok_ads',
  }, 'campaigns');
  for (const row of groups.values()) await add('ad_group', row, {
    external_campaign_id: row.campaignId, external_ad_group_id: row.id, ad_group_name: row.name,
    optimization_goal: row.optimizationGoal ?? null, ad_channel: 'tiktok_ads',
  }, 'adGroups');
  const resources = new Map();
  for (const row of legacy.values()) {
    if (campaigns.get(row.campaignId).automationType === 'UPGRADED_SMART_PLUS') {
      await add('creative', row, { external_creative_id: row.id, creative_name: row.name,
        creative_type: row.videoId ? 'video' : null, video_id: row.videoId ?? null,
        campaign_id: row.campaignId, ad_group_id: row.adGroupId, ad_id: creativeParents.get(row.id) ?? null,
        ad_channel: 'tiktok_ads' }, 'creatives');
      continue;
    }
    // image_ids อาจเป็น cover; ใช้ video_id เดิม หรือ source post ID ของ format ที่ยืนยันแล้วเท่านั้น
    const videoId = row.videoId && !row.videoId.includes(':') ? row.videoId : null;
    const postId = !videoId && /^\d+$/u.test(row.postId ?? '')
      && ['SINGLE_VIDEO', 'CAROUSEL_ADS'].includes(row.adFormat) ? row.postId : null;
    const resourceId = videoId ?? postId;
    if (resourceId) {
      const resource = { id: resourceId, name: null, status: null,
        type: postId ? (row.adFormat === 'CAROUSEL_ADS' ? 'carousel' : 'video') : 'video',
        videoId, postId };
      const existing = resources.get(resourceId);
      if (existing && (existing.type !== resource.type || existing.postId !== resource.postId
        || existing.videoId !== resource.videoId)) fail('RESOURCE_IDENTITY_CONFLICT');
      resources.set(resourceId, resource);
    }
    await add('ad', row, { external_campaign_id: row.campaignId, external_ad_group_id: row.adGroupId,
      external_ad_id: row.id, external_creative_id: resourceId, ad_name: row.name,
      ad_type: row.adFormat ?? null, ad_channel: 'tiktok_ads' }, 'ads');
  }
  for (const row of inventories.smart_ad.rows) await add('ad', row, {
    external_campaign_id: row.campaignId, external_ad_group_id: row.adGroupId,
    external_ad_id: row.id, external_creative_id: row.creativeItems === 1 ? row.creativeIds[0] ?? null : null,
    ad_name: row.name, ad_channel: 'tiktok_ads',
  }, 'ads');
  for (const row of resources.values()) await add('creative', row, {
    external_creative_id: row.id, creative_type: row.type, video_id: row.videoId,
    source_content_id: row.postId, ad_channel: 'tiktok_ads',
  }, 'creatives');
  return { entities, canonical, unavailableCreativeIds,
    unmappedCreativeAds: [...legacy.values()].filter(row => campaigns.get(row.campaignId).automationType !== 'UPGRADED_SMART_PLUS'
      && !row.videoId && !(/^\d+$/u.test(row.postId ?? '') && ['SINGLE_VIDEO', 'CAROUSEL_ADS'].includes(row.adFormat))).length };
}
function fail(code) { throw permanentError('TikTok Ads master snapshot preflight failed', { code: `TIKTOK_ADS_MASTER_${code}` }); }
