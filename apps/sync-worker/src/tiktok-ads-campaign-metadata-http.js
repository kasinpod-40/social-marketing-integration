import { reconcileTikTokAdsCampaignMetadata } from '../../../packages/application/src/tiktok-ads/reconcile-tiktok-ads-campaign-metadata.js';
import { D1MarketingHistoryStore } from '../../../packages/connectors/src/d1-marketing-history-store.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';
import { hydrateRuntimeEnvFromD1 } from './runtime-config-hydration.js';

export const TIKTOK_ADS_CAMPAIGN_METADATA_PATH = '/operator/tiktok-ads/campaign-metadata';

export function createTikTokAdsCampaignMetadataHttpHandler(dependencies = {}) {
  return async function handle({ request, env, url }) {
    if (url.pathname !== TIKTOK_ADS_CAMPAIGN_METADATA_PATH) return null;
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false }, { status: 405, headers });
    try {
      const source = await loadTikTokAdsAuthorizedSource({ request, env,
        dependencies: { ...dependencies, hydrateAuthorizedEnv: dependencies.hydrate ?? hydrateRuntimeEnvFromD1 },
        validateRequest: () => url.searchParams.size === 0,
      });
      if (source.status !== 200) return json({ ok: false }, { status: source.status, headers });
      const execute = request.method === 'POST';
      const writeEnabled = env.MKT_TIKTOK_ADS_METADATA_WRITE_ENABLED === 'true';
      if (execute && !writeEnabled) return json({ ok: false, code: 'TIKTOK_ADS_METADATA_WRITE_DISABLED' },
        { status: 409, headers });
      const result = await (dependencies.reconcile ?? reconcileTikTokAdsCampaignMetadata)({
        execute, writeEnabled, db: env.MKT_STATE_DB, customerKey: source.runtime.config.customerKey,
        accountKey: source.runtime.config.customerKey, advertiserId: source.connection.externalAccountId,
        accessToken: source.accessToken, client: source.client,
        historyStore: dependencies.historyStore ?? new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
        lockStore: dependencies.lockStore ?? new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
      });
      return json({ ok: true, result }, { status: 200, headers });
    } catch (error) {
      return json({ ok: false, code: sanitizeOperationalError(error).code ?? 'TIKTOK_ADS_METADATA_FAILED' },
        { status: 502, headers });
    }
  };
}
