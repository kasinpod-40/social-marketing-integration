import { permanentError, sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';

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
      const source = await loadTikTokAdsAuthorizedSource({
        request, env, dependencies,
        validateRequest: () => isCampaignProbe
          ? url.searchParams.size === 0 || (metadata && url.searchParams.size === 1)
            || (['adgroup_metadata', 'ad_metadata', 'campaign_all', 'ad_base', 'ad_delivery',
              'ad_video', 'ad_conversion', 'ad_purchase'].includes(capability)
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

      const result = capability
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
      return json({ ok: false, error: 'TikTok Ads source probe failed', code: operational.code }, {
        status: 502, headers,
      });
    }
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
