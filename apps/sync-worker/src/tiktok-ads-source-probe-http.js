import { proveTikTokAdsDailyGrains } from '../../../packages/application/src/tiktok-ads/prove-tiktok-ads-daily-grains.js';
import { permanentError, sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';
import { TIKTOK_ADS_CAPABILITY_KINDS } from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';

export const TIKTOK_ADS_SOURCE_PROBE_PATH = '/operator/tiktok-ads/source-probe';
export const TIKTOK_ADS_REPORT_PROBE_PATH = '/operator/tiktok-ads/report-probe';

/** GET-only: decrypt the approved token inside Worker and return no source rows or credential material. */
export function createTikTokAdsSourceProbeHttpHandler(dependencies = {}) {
  return async function handleTikTokAdsSourceProbe({ request, env, url }) {
    const isCampaignProbe = url.pathname === TIKTOK_ADS_SOURCE_PROBE_PATH;
    if (!isCampaignProbe && url.pathname !== TIKTOK_ADS_REPORT_PROBE_PATH) return null;
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, {
      status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' },
    });
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    try {
      const reportDate = isCampaignProbe ? null : url.searchParams.get('date');
      const metadata = isCampaignProbe && url.searchParams.get('metadata') === 'full';
      const capability = isCampaignProbe && url.searchParams.get('capability');
      const capabilityDate = url.searchParams.get('date');
      const daily = isCampaignProbe && url.searchParams.get('daily') === 'full';
      const inventory = isCampaignProbe && url.searchParams.get('inventory');
      const source = await loadTikTokAdsAuthorizedSource({
        request, env, dependencies,
        validateRequest: () => isCampaignProbe
          ? url.searchParams.size === 0 || (daily && url.searchParams.size === 2 && /^\d{4}-\d{2}-\d{2}$/u.test(capabilityDate ?? '')) || (metadata && url.searchParams.size === 1)
            || (['campaign', 'ad_group', 'ad', 'smart_ad', 'hierarchy', 'smart_hierarchy'].includes(inventory) && url.searchParams.size === 1)
            || (TIKTOK_ADS_CAPABILITY_KINDS.includes(capability)
              && url.searchParams.size === 2 && /^\d{4}-\d{2}-\d{2}$/u.test(capabilityDate ?? ''))
          : /^\d{4}-\d{2}-\d{2}$/u.test(reportDate ?? ''),
      });
      if (source.status === 401) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
      if (source.status === 400) {
        return json({ ok: false, error: 'A report date is required' }, { status: 400, headers });
      }
      if (source.status === 409) return json({ ok: false, error: 'Validated advertiser connection unavailable' }, {
        status: 409, headers,
      });

      const result = daily
        ? await proveTikTokAdsDailyGrains({ client: source.client, accessToken: source.accessToken,
          advertiserId: source.connection.externalAccountId, customerKey: source.runtime.config.customerKey,
          accountKey: source.runtime.config.customerKey, date: capabilityDate, db: env.MKT_STATE_DB })
        : inventory
        ? await inventoryProof(source, inventory)
        : capability
        ? await source.client.probeCapability({ accessToken: source.accessToken,
          advertiserId: source.connection.externalAccountId, kind: capability, date: capabilityDate })
        : metadata
        ? await metadataProof(source, env.MKT_STATE_DB)
        : isCampaignProbe
        ? await source.client.probeCampaigns({
          accessToken: source.accessToken, advertiserId: source.connection.externalAccountId,
        })
        : await source.client.probeCampaignDailyReport({
          accessToken: source.accessToken,
          advertiserId: source.connection.externalAccountId,
          date: reportDate,
        });
      return json({ ok: true, source: 'tiktok_ads', probe: result }, { status: 200, headers });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const diagnostics = operational.code === 'TIKTOK_ADS_INVENTORY_PAGINATION_UNSAFE'
        ? Object.fromEntries(['requestedPage', 'reportedPage', 'totalPages', 'totalRows',
          'expectedPages', 'expectedTotal', 'maxPages'].map(key => [key,
          Number.isSafeInteger(error.details?.[key]) ? error.details[key] : null])) : undefined;
      return json({ ok: false, error: 'TikTok Ads source probe failed', code: operational.code, diagnostics }, {
        status: 502, headers,
      });
    }
  };
}

async function inventoryProof(source, kind) {
  if (['hierarchy', 'smart_hierarchy'].includes(kind)) {
    const inventories = {};
    for (const entityKind of kind === 'smart_hierarchy' ? ['campaign', 'ad_group', 'ad', 'smart_ad'] : ['campaign', 'ad_group', 'ad']) {
      inventories[entityKind] = await source.client.listEntityMetadata({ accessToken: source.accessToken,
        advertiserId: source.connection.externalAccountId, kind: entityKind });
    }
    const campaigns = new Set(inventories.campaign.rows.map(row => row.id));
    const groups = new Map(inventories.ad_group.rows.map(row => [row.id, row.campaignId]));
    const missingGroupParents = inventories.ad_group.rows.filter(row => !campaigns.has(row.campaignId)).length;
    const missingAdParents = inventories.ad.rows.filter(row => !campaigns.has(row.campaignId)
      || !groups.has(row.adGroupId)).length;
    const conflictingAdParents = inventories.ad.rows.filter(row => groups.has(row.adGroupId)
      && groups.get(row.adGroupId) !== row.campaignId).length;
    const videos = new Set(inventories.ad.rows.map(row => row.videoId).filter(Boolean));
    const images = new Set(inventories.ad.rows.flatMap(row => row.imageIds));
    let smartProof;
    if (kind === 'smart_hierarchy') {
      const types = new Map(inventories.campaign.rows.map(row => [row.id, row.automationType]));
      const legacy = new Map(inventories.ad.rows.map(row => [row.id, row]));
      let missingSmartParents = 0;
      let missingCreativeReferences = 0;
      let conflictingCreativeParents = 0;
      const creativeParents = new Map();
      let sharedCreativeReferences = 0;
      for (const ad of inventories.smart_ad.rows) {
        if (!campaigns.has(ad.campaignId) || groups.get(ad.adGroupId) !== ad.campaignId) missingSmartParents++;
        for (const id of ad.creativeIds) {
          if (creativeParents.has(id) && creativeParents.get(id) !== ad.id) sharedCreativeReferences++;
          creativeParents.set(id, ad.id);
          const creative = legacy.get(id);
          if (!creative) missingCreativeReferences++;
          else if (creative.campaignId !== ad.campaignId || creative.adGroupId !== ad.adGroupId) conflictingCreativeParents++;
        }
      }
      smartProof = { smartAds: inventories.smart_ad.totalCount, missingSmartParents,
        missingCreativeReferences, conflictingCreativeParents, sharedCreativeReferences,
        missingCreativeIds: inventories.smart_ad.rows.reduce((sum, row) => sum + (row.creativeItems ?? 0) - row.creativeIds.length, 0),
        unknownCampaignTypes: inventories.ad.rows.filter(row => !['MANUAL', 'SMART_PLUS', 'UPGRADED_SMART_PLUS'].includes(types.get(row.campaignId))).length,
        upgradedCreativeRows: inventories.ad.rows.filter(row => types.get(row.campaignId) === 'UPGRADED_SMART_PLUS').length,
        manualOrLegacyAdRows: inventories.ad.rows.filter(row => ['MANUAL', 'SMART_PLUS'].includes(types.get(row.campaignId))).length,
      };
    }
    return { kind, sampleOnly: false, allStatuses: true, ...smartProof,
      campaigns: inventories.campaign.totalCount, adGroups: inventories.ad_group.totalCount,
      ads: inventories.ad.totalCount, missingGroupParents, missingAdParents, conflictingAdParents,
      hierarchyReconciled: missingGroupParents + missingAdParents + conflictingAdParents === 0,
      videos: videos.size, images: images.size,
      assetTypeCollisions: [...videos].filter(id => images.has(id)).length,
      adsWithoutAssets: inventories.ad.rows.filter(row => !row.videoId && row.imageIds.length === 0).length,
      multiAssetAds: inventories.ad.rows.filter(row => row.imageIds.length + (row.videoId ? 1 : 0) > 1).length,
    };
  }
  const result = await source.client.listEntityMetadata({ accessToken: source.accessToken,
    advertiserId: source.connection.externalAccountId, kind });
  return { kind, sampleOnly: false, allStatuses: true, rows: result.totalCount, pageCount: result.pageCount,
    creativeItems: kind === 'smart_ad' ? result.rows.reduce((sum, row) => sum + row.creativeItems, 0) : undefined,
    missingCreativeLists: kind === 'smart_ad' ? result.rows.filter(row => row.creativeItems === null).length : undefined,
    creativeIds: kind === 'smart_ad' ? new Set(result.rows.flatMap(row => row.creativeIds)).size : undefined,
    missingCreativeIds: kind === 'smart_ad'
      ? result.rows.reduce((sum, row) => sum + row.creativeItems - row.creativeIds.length, 0) : undefined,
    automationCounts: kind === 'campaign' ? Object.fromEntries(
      ['MANUAL', 'SMART_PLUS', 'UPGRADED_SMART_PLUS', 'unknown'].map(type => [type,
        result.rows.filter(row => type === 'unknown'
          ? !['MANUAL', 'SMART_PLUS', 'UPGRADED_SMART_PLUS'].includes(row.automationType)
          : row.automationType === type).length])) : undefined,
    allNamesPresent: result.rows.every(row => row.name !== null),
    allStatusesPresent: result.rows.every(row => row.status !== null),
    distinctCampaignParents: new Set(result.rows.map(row => row.campaignId)).size,
    distinctAdGroupParents: new Set(result.rows.map(row => row.adGroupId).filter(Boolean)).size,
    videos: new Set(result.rows.map(row => row.videoId).filter(Boolean)).size,
    images: new Set(result.rows.flatMap(row => row.imageIds)).size,
    adsWithoutAssets: kind === 'ad' ? result.rows.filter(row => !row.videoId && row.imageIds.length === 0).length : null,
    allOptimizationGoalsPresent: kind === 'ad_group' ? result.rows.every(row => row.optimizationGoal !== null) : null,
  };
}

async function metadataProof(source, db) {
  const response = await source.client.listCampaignMetadata({ accessToken: source.accessToken,
    advertiserId: source.connection.externalAccountId });
  const stored = await db.prepare(`SELECT external_entity_id, source_account_id FROM ads_entity_state
    WHERE customer_key = ? AND platform = 'tiktok_ads' AND account_key = ?
      AND entity_type = 'campaign' LIMIT 501`)
    .bind(source.runtime.config.customerKey, source.runtime.config.customerKey).all();
  const rows = stored?.results ?? [];
  if (rows.length > 500 || new Set(rows.map(row => row.external_entity_id)).size !== rows.length
    || rows.some(row => row.source_account_id !== source.connection.externalAccountId)) {
    throw permanentError('TikTok Ads metadata stored advertiser identity conflicts', {
      code: 'TIKTOK_ADS_CAMPAIGN_METADATA_STORED_IDENTITY_CONFLICT',
    });
  }
  const ids = new Set(response.rows.map(row => row.campaignId));
  return { campaigns: response.totalCount, pageCount: response.pageCount,
    allNamesPresent: response.rows.length > 0 && response.rows.every(row => row.name !== null),
    allStatusesPresent: response.rows.length > 0 && response.rows.every(row => row.status !== null),
    allObjectivesPresent: response.rows.length > 0 && response.rows.every(row => row.objective !== null),
    storedCampaigns: rows.length, matchedStoredCampaigns: rows.filter(row => ids.has(row.external_entity_id)).length,
  };
}
