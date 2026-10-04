import { projectTikTokAdsCampaignSummary } from '../../../packages/application/src/tiktok-ads/project-tiktok-ads-campaign-summary.js';
import { projectTikTokAdsDailyLark } from '../../../packages/application/src/tiktok-ads/project-tiktok-ads-daily-lark.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { TableSyncEngine } from '../../../packages/sync-engine/src/table-sync-engine.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { requireDateOnly } from '../../../packages/shared/src/date/date-only.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';
import { hydrateRuntimeEnvFromD1 } from './runtime-config-hydration.js';

export const TIKTOK_ADS_CAMPAIGN_SUMMARY_PATH = '/operator/tiktok-ads/campaign-summary';
export const TIKTOK_ADS_LARK_PROJECTION_PATH = '/operator/tiktok-ads/lark-projection';

/** เส้นทางควบคุมเฉพาะ TikTok; ไม่มี Source API/Report/Queue/Schedule หรือการลบ */
export function createTikTokAdsLarkProjectionHttpHandler(dependencies = {}) {
  return async function handle({ request, env, url }) {
    const summary = url.pathname === TIKTOK_ADS_CAMPAIGN_SUMMARY_PATH;
    if (!summary && url.pathname !== TIKTOK_ADS_LARK_PROJECTION_PATH) return null;
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false }, { status: 405, headers });
    let stage = 'authorized_source';
    try {
      let date;
      let month;
      let days = 1;
      let grain = 'campaign';
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
        validateRequest: () => {
          try {
            if (summary) {
              month = url.searchParams.get('month');
              return url.searchParams.size === 1 && /^\d{4}-(0[1-9]|1[0-2])$/u.test(month ?? '');
            }
            date = requireDateOnly(url.searchParams.get('date'));
            grain = url.searchParams.get('grain') ?? 'campaign';
            days = url.searchParams.has('days') ? Number(url.searchParams.get('days')) : 1;
            return ['campaign', 'ad'].includes(grain) && Number.isInteger(days) && days >= 1 && days <= 7
              && url.searchParams.size === 1 + Number(url.searchParams.has('grain')) + Number(url.searchParams.has('days'));
          } catch { return false; }
        },
      });
      if (source.status !== 200) return json({ ok: false }, { status: source.status, headers });
      if (request.method === 'POST' && ((summary ? env.MKT_TIKTOK_ADS_SUMMARY_WRITE_ENABLED : env.MKT_TIKTOK_ADS_LARK_WRITE_ENABLED) !== 'true'
        || (grain === 'ad' && env.MKT_TIKTOK_ADS_AD_LARK_WRITE_ENABLED !== 'true'))) {
        return json({ ok: false, code: 'TIKTOK_ADS_LARK_WRITE_DISABLED' }, { status: 409, headers });
      }
      stage = 'lark_client';
      const client = (dependencies.createLarkClient ?? createLarkBitableClientFromEnv)(runtime);
      stage = 'projection';
      const projector = summary ? dependencies.projectSummary ?? projectTikTokAdsCampaignSummary
        : dependencies.project ?? projectTikTokAdsDailyLark;
      const result = await projector({
        date, month, days, grain, adWriteEnabled: env.MKT_TIKTOK_ADS_AD_LARK_WRITE_ENABLED === 'true', db: env.MKT_STATE_DB, customerKey: source.runtime.config.customerKey,
        accountKey: source.runtime.config.customerKey, advertiserId: source.connection.externalAccountId,
        currency: source.connection.providerMetadata?.currency, timezone: source.connection.providerMetadata?.timezone,
        execute: request.method === 'POST', writeEnabled: (summary ? env.MKT_TIKTOK_ADS_SUMMARY_WRITE_ENABLED : env.MKT_TIKTOK_ADS_LARK_WRITE_ENABLED) === 'true',
        client, repository: dependencies.repository ?? new LarkRecordRepository({ client }),
        syncEngine: dependencies.syncEngine ?? new TableSyncEngine(),
        lockStore: dependencies.lockStore ?? new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
        tables: readLarkTableIdsFromEnv(runtime, summary ? ['mktAdsCampaignSummary'] : ['mktAdsCampaigns', 'mktAdsDaily']),
      });
      return json({ ok: true, result }, { status: 200, headers });
    } catch (error) {
      return json({ ok: false, stage, code: sanitizeOperationalError(error).code ?? 'TIKTOK_ADS_LARK_PROJECTION_FAILED' },
        { status: 502, headers });
    }
  };
}
