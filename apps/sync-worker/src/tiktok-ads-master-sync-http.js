import { runTikTokAdsMasterSync } from '../../../packages/application/src/tiktok-ads/run-tiktok-ads-master-sync.js';
import { D1MarketingHistoryStore } from '../../../packages/connectors/src/d1-marketing-history-store.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { TableSyncEngine } from '../../../packages/sync-engine/src/table-sync-engine.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';
import { hydrateRuntimeEnvFromD1 } from './runtime-config-hydration.js';

export const TIKTOK_ADS_MASTER_SYNC_PATH = '/operator/tiktok-ads/master-sync';

export function createTikTokAdsMasterSyncHttpHandler(dependencies = {}) {
  return async function handle({ request, env, url }) {
    if (url.pathname !== TIKTOK_ADS_MASTER_SYNC_PATH) return null;
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false }, { status: 405, headers });
    let stage = 'authorized_source';
    try {
      let runtime;
      const source = await loadTikTokAdsAuthorizedSource({ request, env, dependencies: {
        ...dependencies,
        hydrateAuthorizedEnv: async raw => {
          stage = 'runtime_hydration';
          runtime = await (dependencies.hydrate ?? hydrateRuntimeEnvFromD1)(raw);
          stage = 'authorized_source';
          return runtime;
        },
      },
        validateRequest: () => url.searchParams.size === 0,
      });
      if (source.status !== 200) return json({ ok: false }, { status: source.status, headers });
      if (request.method === 'POST' && env.MKT_TIKTOK_ADS_MASTER_WRITE_ENABLED !== 'true') {
        return json({ ok: false, code: 'TIKTOK_ADS_MASTER_WRITE_DISABLED' }, { status: 409, headers });
      }
      stage = 'lark_client';
      const client = (dependencies.createLarkClient ?? createLarkBitableClientFromEnv)(runtime);
      stage = 'master_sync';
      const result = await (dependencies.run ?? runTikTokAdsMasterSync)({
        db: env.MKT_STATE_DB, customerKey: source.runtime.config.customerKey,
        accountKey: source.runtime.config.customerKey, advertiserId: source.connection.externalAccountId,
        currency: source.connection.providerMetadata?.currency, timezone: source.connection.providerMetadata?.timezone,
        execute: request.method === 'POST', writeEnabled: env.MKT_TIKTOK_ADS_MASTER_WRITE_ENABLED === 'true',
        client: source.client, accessToken: source.accessToken, larkClient: client,
        historyStore: dependencies.historyStore ?? new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
        repository: dependencies.repository ?? new LarkRecordRepository({ client }),
        syncEngine: dependencies.syncEngine ?? new TableSyncEngine(),
        lockStore: dependencies.lockStore ?? new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
        tables: readLarkTableIdsFromEnv(runtime, ['mktAdsAccounts', 'mktAdsCampaigns', 'mktAdsAdGroups', 'mktAdsAds', 'mktAdsCreatives']),
      });
      return json({ ok: true, result }, { status: 200, headers });
    } catch (error) {
      return json({ ok: false, stage, code: sanitizeOperationalError(error).code ?? 'TIKTOK_ADS_MASTER_FAILED' },
        { status: 502, headers });
    }
  };
}
