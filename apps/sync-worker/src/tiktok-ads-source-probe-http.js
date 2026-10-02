import { TikTokAdsApiClient } from '../../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import {
  createCustomerConnectionRuntime,
  loadTikTokAdsRuntimeConfig,
} from './customer-connection-runtime.js';

export const TIKTOK_ADS_SOURCE_PROBE_PATH = '/operator/tiktok-ads/source-probe';
export const TIKTOK_ADS_REPORT_PROBE_PATH = '/operator/tiktok-ads/report-probe';

/** GET-only: decrypt the approved token inside Worker and return no source rows or credential material. */
export function createTikTokAdsSourceProbeHttpHandler(dependencies = {}) {
  const createRuntime = dependencies.createRuntime ?? createCustomerConnectionRuntime;
  const loadAdsConfig = dependencies.loadAdsConfig ?? loadTikTokAdsRuntimeConfig;
  const createClient = dependencies.createClient ?? ((config) => new TikTokAdsApiClient(config));

  return async function handleTikTokAdsSourceProbe({ request, env, url }) {
    const isCampaignProbe = url.pathname === TIKTOK_ADS_SOURCE_PROBE_PATH;
    if (!isCampaignProbe && url.pathname !== TIKTOK_ADS_REPORT_PROBE_PATH) return null;
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, {
      status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' },
    });
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    try {
      const authorization = request.headers.get('authorization') ?? '';
      const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
      const valid = await timingSafeEqualText(match?.[1]?.trim() ?? '', env?.MKT_CONNECTION_OPERATOR_TOKEN);
      if (!match || !valid) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
      const reportDate = isCampaignProbe ? null : url.searchParams.get('date');
      if (!isCampaignProbe && !/^\d{4}-\d{2}-\d{2}$/u.test(reportDate ?? '')) {
        return json({ ok: false, error: 'A report date is required' }, { status: 400, headers });
      }

      const runtime = createRuntime(env);
      if (runtime.config.environment !== 'production'
        || runtime.config.customerProfile !== 'chemistry_k'
        || runtime.config.customerKey !== 'chemistry_k') {
        throw new Error('TikTok Ads source probe requires the exact customer Production runtime');
      }
      const adsConfig = loadAdsConfig(env);
      const connection = await runtime.store.findConnectionByCustomerConnector({
        customerKey: runtime.config.customerKey,
        connectorKey: 'tiktok_ads',
      });
      if (!connection || connection.connectionStatus !== 'connected'
        || connection.accessStatus !== 'validated'
        || !connection.credentialReference
        || !/^\d+$/u.test(connection.externalAccountId ?? '')
        || (adsConfig.approvedAdvertiserId
          && connection.externalAccountId !== adsConfig.approvedAdvertiserId)) {
        return json({ ok: false, error: 'Validated advertiser connection unavailable' }, {
          status: 409, headers,
        });
      }
      const accessToken = await runtime.credentials.read({
        credentialReference: connection.credentialReference,
        connectionId: connection.connectionId,
        connectorKey: 'tiktok_ads',
        credentialKind: 'access_token',
      });
      const client = createClient(adsConfig);
      const result = isCampaignProbe
        ? await client.probeCampaigns({ accessToken, advertiserId: connection.externalAccountId })
        : await client.probeCampaignDailyReport({
          accessToken,
          advertiserId: connection.externalAccountId,
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
