import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildUniversalMarketingDashboardModel } from '../../packages/application/src/use-cases/build-universal-marketing-dashboard-model.js';
import { listReportPlatformContracts } from '../../packages/application/src/reports/report-platform-adapter-registry.js';

const GENERATED_AT = Date.parse('2026-07-29T05:00:00Z');

test('discovers every current Report platform and a future capability without Dashboard code changes', () => {
  const current = listReportPlatformContracts().map((contract, index) => materialization({
    platform: contract.platformScope,
    capability: contract.capability,
    accountId: `account-${index + 1}`,
    reportId: `report-${index + 1}`,
  }));
  const future = materialization({
    platform: 'future_network',
    capability: 'commerce',
    accountId: 'future-account',
    reportId: 'future-report',
    collections: {
      top_products: [{ external_id: 'product-1', label: 'Product One' }],
    },
  });

  const model = buildUniversalMarketingDashboardModel({ materializations: [...current, future] });

  assert.deepEqual(model.discovery.platforms, [
    'facebook', 'future_network', 'google_ads', 'instagram',
    'meta_ads', 'tiktok', 'tiktok_ads', 'woocommerce', 'youtube',
  ]);
  assert.equal(model.reportCount, 9);
  assert.deepEqual(model.discovery.capabilities, ['commerce', 'organic', 'paid_ads']);
  assert.deepEqual(model.discovery.collectionKinds, ['top_products']);
  assert.equal(model.sections.find((section) => section.capability === 'commerce').platforms.includes('future_network'), true);
  assert.deepEqual(model.sections.find((section) => section.capability === 'commerce').collectionKinds, ['top_products']);
});

test('new accounts and client-visible metrics appear automatically while null and zero remain distinct', () => {
  const first = materialization({
    platform: 'future_network',
    capability: 'customer_service',
    accountId: 'account-a',
    reportId: 'report-a',
    metricPayload: {
      'future_network:new_metric': metric({
        metricKey: 'future_network:new_metric',
        displayName: 'New Metric',
        current: 0,
        compare: null,
        clientVisible: true,
        sortOrder: 20,
      }),
      'future_network:hidden_metric': metric({
        metricKey: 'future_network:hidden_metric',
        displayName: 'Hidden Metric',
        current: 10,
        compare: 5,
        clientVisible: false,
        sortOrder: 10,
      }),
    },
  });
  const second = materialization({
    platform: 'future_network',
    capability: 'customer_service',
    accountId: 'account-b',
    reportId: 'report-b',
  });

  const model = buildUniversalMarketingDashboardModel({ materializations: [first, second] });

  assert.deepEqual(model.discovery.accountIds, ['account-a', 'account-b']);
  assert.equal(model.reports.find((report) => report.reportId === 'report-a').cards.length, 1);
  assert.equal(model.reports.find((report) => report.reportId === 'report-a').cards[0].metricKey, 'future_network:new_metric');
  assert.equal(model.reports.find((report) => report.reportId === 'report-a').cards[0].current, 0);
  assert.equal(model.reports.find((report) => report.reportId === 'report-a').cards[0].compare, null);
});

test('renders discovered collections and preserves Organic/Ads compatibility collections', () => {
  const organic = materialization({
    platform: 'social_new',
    capability: 'organic',
    accountId: 'organic-account',
    reportId: 'organic-report',
    dataStatus: 'partial',
    coverageRate: 0.75,
    topContent: [{ external_content_id: 'content-1', caption: 'One' }],
  });
  const paid = materialization({
    platform: 'ads_new',
    capability: 'paid_ads',
    accountId: 'ads-account',
    reportId: 'ads-report',
    topAds: [{ external_ad_id: 'ad-1', ad_name: 'One' }],
  });
  const service = materialization({
    platform: 'support_new',
    capability: 'customer_service',
    accountId: 'support-account',
    reportId: 'support-report',
    collections: {
      slowest_inboxes: [{ external_id: 'inbox-1', label: 'Inbox One' }],
      top_agents: [{ external_id: 'agent-1', label: 'Agent One', rank: 4 }],
    },
  });

  const model = buildUniversalMarketingDashboardModel({ materializations: [organic, paid, service] });
  const organicReport = model.reports.find((report) => report.reportId === 'organic-report');
  const paidReport = model.reports.find((report) => report.reportId === 'ads-report');
  const serviceReport = model.reports.find((report) => report.reportId === 'support-report');

  assert.equal(organicReport.collections[0].kind, 'top_content');
  assert.equal(organicReport.collections[0].rows[0].rank, 1);
  assert.equal(paidReport.collections[0].kind, 'top_ads');
  assert.deepEqual(serviceReport.collections.map((collection) => collection.kind), ['slowest_inboxes', 'top_agents']);
  assert.equal(serviceReport.collections[0].rows[0].rank, 1);
  assert.equal(serviceReport.collections[1].rows[0].rank, 4);
  assert.equal(serviceReport.rankings, serviceReport.collections);
  assert.equal(model.dataQuality.status, 'attention_required');
  assert.deepEqual(organicReport.dataQuality.warnings.map((warning) => warning.code), [
    'DASHBOARD_DATA_STATUS_NOT_COMPLETE',
    'DASHBOARD_COVERAGE_PARTIAL',
  ]);
});

test('selection filters discovered data without channel-specific branches', () => {
  const model = buildUniversalMarketingDashboardModel({
    materializations: [
      materialization({ platform: 'one', capability: 'organic', accountId: 'a', reportId: 'r1' }),
      materialization({ platform: 'two', capability: 'paid_ads', accountId: 'b', reportId: 'r2' }),
    ],
    selection: { platform: 'two', accountId: 'b', windowDays: 7 },
  });
  assert.equal(model.reportCount, 1);
  assert.equal(model.reports[0].reportId, 'r2');
  assert.deepEqual(model.discovery.platforms, ['one', 'two']);
});

test('Dashboard model source contains no current platform, capability or metric literals', async () => {
  const source = await readFile(
    new URL('../../packages/application/src/use-cases/build-universal-marketing-dashboard-model.js', import.meta.url),
    'utf8',
  );
  for (const literal of [
    'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'google_ads', 'tiktok_ads',
    'woocommerce',
    'organic', 'paid_ads', 'commerce', 'customer_service',
    'views', 'likes', 'spend', 'impressions',
  ]) {
    assert.equal(source.includes(`'${literal}'`), false, `Dashboard model must not hardcode ${literal}`);
  }
});

test('rejects unsafe capability and collection identifiers before rendering', () => {
  const unsafeCapability = materialization({ capability: 'Customer Service' });
  assert.throws(
    () => buildUniversalMarketingDashboardModel({ materializations: [unsafeCapability] }),
    /capability must be a lowercase extensible key/u,
  );
  const unsafeCollection = materialization({ collections: { 'Top Products': [] } });
  assert.throws(
    () => buildUniversalMarketingDashboardModel({ materializations: [unsafeCollection] }),
    /must be a lowercase extensible key/u,
  );
});

function materialization(input = {}) {
  const platform = input.platform ?? 'platform';
  const capability = input.capability ?? 'organic';
  const reportId = input.reportId ?? `${platform}-report`;
  const accountId = input.accountId ?? `${platform}-account`;
  return Object.freeze({
    reportId,
    reportSettingKey: `integration_workspace:${platform}:rolling:7d`,
    customerKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    accountId,
    generatedAt: GENERATED_AT,
    payload: {
      schemaVersion: 'dashboard-materialization-v2',
      sourceReportId: null,
      platformScope: platform,
      capability,
      reportType: 'dashboard_performance_report',
      period: {
        periodKind: 'rolling_days',
        windowDays: 7,
        periodStart: '2026-07-22',
        periodEnd: '2026-07-28',
        comparisonMode: 'previous_period',
        compareStart: '2026-07-15',
        compareEnd: '2026-07-21',
      },
      dataStatus: input.dataStatus ?? 'complete',
      coverageRate: input.coverageRate ?? 1,
      metricPayload: input.metricPayload ?? {
        [`${platform}:metric`]: metric({
          metricKey: `${platform}:metric`,
          displayName: 'Metric',
          current: 1,
          compare: 0,
          clientVisible: true,
          sortOrder: 10,
        }),
      },
      collections: input.collections ?? {},
      topContent: input.topContent ?? [],
      topAds: input.topAds ?? [],
      source: 'd1_historical_facts',
      sourceWatermark: 'watermark',
      generatedAt: GENERATED_AT,
      sourceUnavailableReason: null,
      aiSummary: null,
    },
  });
}

function metric(input = {}) {
  const current = input.current ?? 1;
  const compare = input.compare === undefined ? 0 : input.compare;
  return Object.freeze({
    metricKey: input.metricKey,
    displayName: input.displayName,
    unit: 'count',
    current,
    compare,
    change: compare === null ? null : current - compare,
    changePercent: compare === null || compare === 0 ? null : (current - compare) / compare,
    sortOrder: input.sortOrder,
    clientVisible: input.clientVisible,
    formulaVersion: 'formula-v1',
  });
}
