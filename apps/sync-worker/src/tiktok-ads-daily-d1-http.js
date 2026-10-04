import { loadTikTokAdsDailyMasters } from '../../../packages/application/src/tiktok-ads/prove-tiktok-ads-daily-grains.js';
import { D1MarketingHistoryStore } from '../../../packages/connectors/src/d1-marketing-history-store.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { buildTikTokAdsDailyWriteSet } from '../../../packages/application/src/tiktok-ads/tiktok-ads-daily-write-set.js';
import { runTikTokAdsDailyD1Sync, readTikTokAdsDailyReadback } from '../../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-d1-sync.js';
import { requireDateOnly } from '../../../packages/shared/src/date/date-only.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';

export const TIKTOK_ADS_DAILY_D1_PATH = '/operator/tiktok-ads/daily-d1';

/** Controlled one-day D1-only UAT; no Lark, Report, Queue or schedule calls. */
export function createTikTokAdsDailyD1HttpHandler(dependencies = {}) {
  const runSync = dependencies.runSync ?? runTikTokAdsDailyD1Sync;
  const buildWriteSet = dependencies.buildWriteSet ?? buildTikTokAdsDailyWriteSet;
  return async function handleTikTokAdsDailyD1({ request, env, url }) {
    if (url.pathname !== TIKTOK_ADS_DAILY_D1_PATH) return null;
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (request.method !== 'GET' && request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, {
        status: 405, headers: { ...headers, allow: 'GET, POST' },
      });
    }
    try {
      let date = null;
      let grain = 'campaign';
      const allStatuses = url.searchParams.has('grain');
      const source = await loadTikTokAdsAuthorizedSource({
        request, env, dependencies,
        validateRequest: () => {
          try {
            date = requireDateOnly(url.searchParams.get('date'), { label: 'TikTok Ads date' });
            grain = url.searchParams.get('grain') ?? 'campaign';
            return ['campaign', 'ad'].includes(grain) && url.searchParams.size === (allStatuses ? 2 : 1);
          } catch { return false; }
        },
      });
      if (source.status === 401) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
      if (source.status === 400) return json({ ok: false, error: 'Valid date is required' }, { status: 400, headers });
      if (source.status === 409) return json({ ok: false, error: 'Validated advertiser connection unavailable' }, {
        status: 409, headers,
      });
      const accountKey = source.runtime.config.customerKey;
      const context = {
        customerKey: source.runtime.config.customerKey,
        accountKey,
        advertiserId: source.connection.externalAccountId,
        currency: source.connection.providerMetadata?.currency,
        timezone: source.connection.providerMetadata?.timezone,
        date, grain, allStatuses,
        multiGrainWriteEnabled: env.MKT_TIKTOK_ADS_MULTI_GRAIN_WRITE_ENABLED === 'true',
        syncRunId: `tiktok_ads:${grain}_daily:${accountKey}:${date}`,
        accessToken: source.accessToken,
        client: source.client,
      };
      if (request.method === 'GET') {
        const report = await source.client[allStatuses ? 'listAllStatusDailyReport' : 'listCampaignDailyReport']({
          grain,
          accessToken: source.accessToken,
          advertiserId: source.connection.externalAccountId,
          date,
        });
        const parents = allStatuses ? await loadTikTokAdsDailyMasters({ ...context, db: env.MKT_STATE_DB }) : undefined;
        const writeSet = await buildWriteSet({ ...context, parents, rows: report.rows, now: Date.now() });
        const readback = allStatuses ? await readTikTokAdsDailyReadback({ ...context, db: env.MKT_STATE_DB }, writeSet) : null;
        return json({ ok: true, source: 'tiktok_ads', mode: 'preview', rows: report.totalCount,
          pageCount: report.pageCount, ...(readback ? { readback } : {}) }, { status: 200, headers });
      }
      if (env.MKT_TIKTOK_ADS_D1_WRITE_ENABLED !== 'true'
        || (allStatuses && env.MKT_TIKTOK_ADS_MULTI_GRAIN_WRITE_ENABLED !== 'true')) {
        return json({ ok: false, error: 'TikTok Ads D1 write gate is disabled' }, { status: 409, headers });
      }
      const result = await runSync({
        ...context,
        db: env.MKT_STATE_DB,
        historyStore: dependencies.historyStore ?? new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
        lockStore: dependencies.lockStore ?? new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
        businessWriteEnabled: true,
      });
      return json({ ok: true, source: 'tiktok_ads', mode: 'execute', result }, { status: 200, headers });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      return json({ ok: false, error: 'TikTok Ads daily D1 operation failed', code: operational.code }, {
        status: 502, headers,
      });
    }
  };
}
