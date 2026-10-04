import { loadTikTokAdsAuthorizedSource } from './tiktok-ads-authorized-source.js';
import { hydrateRuntimeEnvFromD1 } from './runtime-config-hydration.js';
import { createD1ReportRegistry, processJobWithTikTokD1AwareReport } from './tiktok-d1-aware-report-job-router.js';
import { createInfrastructure } from './runtime-infrastructure.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { createDashboardReportSettingKey } from '../../../packages/config/src/report-settings.seed.js';
import { resolveReportPeriod } from '../../../packages/application/src/reports/report-period.js';
import { buildDashboardPresetJob } from '../../../packages/application/src/reports/dashboard-report-request.js';
import { JOB_TRIGGERS } from '../../../packages/application/src/jobs/job-catalog.js';
import { assertMktAdsMaintenanceIdle } from '../../../packages/application/src/use-cases/mkt-ads-post-sync-maintenance.js';
import { permanentError, sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';

export const TIKTOK_ADS_REPORT_PATH = '/operator/tiktok-ads/report';

/** Controlled Report UAT ใช้ shared Queue processor จริง; ไม่ส่ง Queue หรือ notification */
export function createTikTokAdsReportHttpHandler(dependencies = {}) {
  return async function handle({ request, env, url }) {
    if (url.pathname !== TIKTOK_ADS_REPORT_PATH) return null;
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false }, { status: 405, headers });
    try {
      let runtimeEnv;
      const windowDays = Number(url.searchParams.get('days'));
      const date = url.searchParams.get('date');
      const source = await loadTikTokAdsAuthorizedSource({ request, env, dependencies: {
        ...dependencies, hydrateAuthorizedEnv: async raw => {
          runtimeEnv = await (dependencies.hydrate ?? hydrateRuntimeEnvFromD1)(raw);
          return runtimeEnv;
        },
      }, validateRequest: () => url.searchParams.size === 2 && ['1','3','7','30'].includes(url.searchParams.get('days'))
        && /^\d{4}-\d{2}-\d{2}$/u.test(date ?? '') });
      if (source.status !== 200) return json({ ok: false }, { status: source.status, headers });
      if (request.method === 'POST' && env.MKT_TIKTOK_ADS_REPORT_WRITE_ENABLED !== 'true') {
        return json({ ok: false, code: 'TIKTOK_ADS_REPORT_WRITE_DISABLED' }, { status: 409, headers });
      }
      const now = (dependencies.now ?? Date.now)();
      const period = resolveReportPeriod({ periodKind: 'rolling_days', windowDays, periodEnd: date,
        comparisonMode: 'previous_period', timeZone: source.connection.providerMetadata?.timezone, now: new Date(now) });
      const registry = (dependencies.createRegistry ?? createD1ReportRegistry)(env.MKT_STATE_DB, { tikTokAdsReady: true });
      const adapter = registry.get('tiktok_ads').adapter;
      const loaded = [];
      for (const [periodStart, periodEnd] of [[period.periodStart, period.periodEnd], [period.compareStart, period.compareEnd]]) {
        const result = await adapter.load({ customerKey: source.runtime.config.customerKey,
          accountKey: source.runtime.config.customerKey, periodStart, periodEnd, maxFactRows: 10000, topAdsLimit: 5 });
        if (result.metrics?.coverage_rate !== 1 || result.readSummary?.rankingCoverageRate !== 1
          || result.readSummary?.topAdsAvailability !== 'available') throw permanentError('TikTok Report Coverage incomplete', { code: 'TIKTOK_ADS_REPORT_COVERAGE_INCOMPLETE' });
        loaded.push(result);
      }
      const proof = { days: windowDays, date, currentRows: loaded[0].readSummary.summaryFactRows,
        compareRows: loaded[1].readSummary.summaryFactRows, currentTopAds: loaded[0].topAds.length,
        compareTopAds: loaded[1].topAds.length, coverageComplete: true,
        currentMetricsAvailable: Object.fromEntries(Object.entries(loaded[0].metrics)
          .filter(([, value]) => typeof value === 'number' || value === null).map(([key,value]) => [key,value !== null])) };
      if (request.method === 'GET') return json({ ok: true, mode: 'preview', proof }, { headers });
      await assertMktAdsMaintenanceIdle({ db: env.MKT_STATE_DB, now });
      const body = buildDashboardPresetJob({ trigger: JOB_TRIGGERS.DASHBOARD_SCHEDULED, requestedAt: now, windowDays, periodEnd: date,
        timeZone: source.connection.providerMetadata?.timezone, platformScope: 'tiktok_ads',
        reportSettingKey: createDashboardReportSettingKey({ profileKey: 'chemistry_k', platformScope: 'tiktok_ads', windowDays }) });
      const result = await (dependencies.processJob ?? processJobWithTikTokD1AwareReport)({ job: { schemaVersion: 1, body },
        env: runtimeEnv, message: { attempts: 1 },
        getRuntimeConfig: () => (dependencies.loadRuntime ?? loadCustomerRuntimeConfig)(runtimeEnv),
        getInfrastructure: () => (dependencies.createInfrastructure ?? createInfrastructure)(runtimeEnv) });
      return json({ ok: true, mode: 'execute', proof, result: { dataStatus: result.dataStatus,
        rows: result.lark?.rows, writes: Object.fromEntries(Object.entries(result.lark?.results ?? {})
          .map(([key,value]) => [key,{ created:value.created, updated:value.updated, skipped:value.skipped }])),
        readback: result.lark?.readback, aiStatus: result.ai?.status } }, { headers });
    } catch (error) {
      return json({ ok: false, code: sanitizeOperationalError(error).code ?? 'TIKTOK_ADS_REPORT_FAILED' }, { status: 502, headers });
    }
  };
}
