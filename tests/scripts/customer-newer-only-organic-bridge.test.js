import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONFIRMATIONS,
  assertCustomerBoundaryUnchanged,
  assertCustomerNewerOnlyOrganicBridgeConfirmation,
  buildCustomerBridgeVerificationSql,
  buildCustomerNewerOnlyOrganicBridgePlan,
  buildCustomerTikTok20260827BridgePlan,
  parseCustomerBridgeWranglerJson,
  parseCustomerNewerOnlyOrganicBridgeArgs,
} from '../../scripts/lib/customer-newer-only-organic-bridge.js';

test('operator defaults to plan-only and requires an exact confirmation per mutation phase', () => {
  assert.deepEqual(parseCustomerNewerOnlyOrganicBridgeArgs([]), {
    phase: 'plan', execute: false, planPath: null, scope: 'default',
  });
  assert.throws(() => parseCustomerNewerOnlyOrganicBridgeArgs(['--phase=apply', '--execute']),
    (error) => error.code === 'CUSTOMER_NEWER_ONLY_BRIDGE_PLAN_REQUIRED');
  assert.throws(() => assertCustomerNewerOnlyOrganicBridgeConfirmation('apply', {}),
    (error) => error.code === 'CUSTOMER_NEWER_ONLY_BRIDGE_CONFIRMATION_REQUIRED');
  assert.doesNotThrow(() => assertCustomerNewerOnlyOrganicBridgeConfirmation('apply', {
    CONFIRM_CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONFIRMATIONS.apply,
  }));
});

test('Wrangler JSON parser tolerates progress text before a successful D1 payload', () => {
  assert.deepEqual(parseCustomerBridgeWranglerJson('Applied 2,053 rows\n[{"success":true,"results":[]}]'), [
    { success: true, results: [] },
  ]);
  assert.throws(() => parseCustomerBridgeWranglerJson('Applied rows without JSON'),
    (error) => error.code === 'CUSTOMER_NEWER_ONLY_BRIDGE_WRANGLER_JSON_INVALID');
});

test('TikTok 2026-08-27 scope selects only the exact newer 2,053-row snapshot', async () => {
  const rows = dailyRows('tiktok', '2026-08-27', 2_053);
  const result = await buildCustomerTikTok20260827BridgePlan({
    generatedAt: 1_787_900_000_000,
    sourceTables: {
      content: rows.map((record) => ({ fields: {
        platform: 'tiktok',
        external_content_id: record.fields.external_content_id,
        content_type: 'video',
      } })),
      contentDaily: [
        ...dailyRows('tiktok', '2026-08-26', 2_051),
        ...rows,
      ],
      accountDaily: [],
    },
    customerSnapshot: {
      observationDates: { facebook: '2026-08-26', tiktok: '2026-08-26' },
      accountDates: { facebook: '2026-08-26' },
      stateKeys: rows.map((record) => `tiktok:chemistry_k:${record.fields.external_content_id}`),
    },
  });
  assert.equal(result.periodEnd, '2026-08-27');
  assert.deepEqual(result.platforms, ['tiktok']);
  assert.equal(result.sourceSummary.rows, 2_053);
  assert.equal(result.sourceSummary.accountRows, 0);
  assert.equal(result.sourceSummary.missingStateKeys.length, 0);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].rowCount, 2_053);
});

test('newer-only plan rejects a Customer boundary drift instead of overwriting a completed date', () => {
  assert.equal(assertCustomerBoundaryUnchanged({
    observationDates: { facebook: '2026-08-25', tiktok: '2026-08-23' },
    accountDates: { facebook: '2026-08-25' },
  }, {
    observationDates: { facebook: '2026-08-25', tiktok: '2026-08-23' },
    accountDates: { facebook: '2026-08-25' },
  }), true);
  assert.throws(() => assertCustomerBoundaryUnchanged({
    observationDates: { facebook: '2026-08-25', tiktok: '2026-08-23' },
    accountDates: { facebook: '2026-08-25' },
  }, {
    observationDates: { facebook: '2026-08-26', tiktok: '2026-08-23' },
    accountDates: { facebook: '2026-08-25' },
  }), (error) => error.code === 'CUSTOMER_NEWER_ONLY_BRIDGE_BOUNDARY_DRIFT');
});

test('generated SQL is insert-only, exact-date scoped and excludes every operational table', async () => {
  const plan = await buildCustomerNewerOnlyOrganicBridgePlan(fixture());
  assert.equal(plan.sourceSummary.rows, 6_243);
  assert.deepEqual(plan.sourceSummary.byPlatformDate, [
    { platform: 'facebook', metricDate: '2026-08-26', count: 95 },
    { platform: 'tiktok', metricDate: '2026-08-24', count: 2_048 },
    { platform: 'tiktok', metricDate: '2026-08-25', count: 2_049 },
    { platform: 'tiktok', metricDate: '2026-08-26', count: 2_051 },
  ]);
  const sql = plan.chunks.map((chunk) => chunk.sql).join('\n');
  assert.match(sql, /INSERT OR IGNORE INTO organic_content_observations/u);
  assert.match(sql, /INSERT OR IGNORE INTO data_coverage_runs/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.doesNotMatch(sql, /(?:sync_works|queue_operation_attempts|dead_letter_jobs|system_alerts|operational_cursors)/u);
  assert.doesNotMatch(sql, /2026-08-23.*organic_content_observations/u);
  assert.equal(plan.sourceSummary.missingStateKeys.length, 2);
});

test('verification SQL proves exact row/coverage/state/account parity without mutating data', async () => {
  const plan = await buildCustomerNewerOnlyOrganicBridgePlan(fixture());
  const sql = buildCustomerBridgeVerificationSql(plan);
  assert.match(sql, /COUNT\(DISTINCT external_content_id\)/u);
  assert.match(sql, /missing_state_rows/u);
  assert.match(sql, /organic_account_daily_facts/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
});

function fixture() {
  const contentDaily = [
    ...dailyRows('facebook', '2026-08-26', 95),
    ...dailyRows('tiktok', '2026-08-24', 2_048),
    ...dailyRows('tiktok', '2026-08-25', 2_049),
    ...dailyRows('tiktok', '2026-08-26', 2_051),
    ...dailyRows('facebook', '2026-08-25', 94),
    ...dailyRows('tiktok', '2026-08-23', 2_047),
  ];
  const identities = new Map(contentDaily.map((record) => {
    const fields = record.fields;
    return [`${fields.platform}:${fields.external_content_id}`, {
      fields: {
        platform: fields.platform,
        external_content_id: fields.external_content_id,
        content_type: 'video',
        published_at: 1_700_000_000_000,
        caption: 'customer content',
        content_url: { link: 'https://example.test/content' },
        thumbnail_url: { link: 'https://example.test/thumb' },
        duration_seconds: 10,
      },
    }];
  }));
  const allNewKeys = [...new Set(contentDaily
    .filter((record) => record.fields.metric_date > '2026-08-23')
    .map((record) => `${record.fields.platform}:chemistry_k:${record.fields.external_content_id}`))];
  return {
    generatedAt: 1_787_850_000_000,
    sourceTables: {
      content: [...identities.values()],
      contentDaily,
      accountDaily: [{ fields: {
        platform: 'facebook', account_id: '982406442148381', metric_date: '2026-08-26',
        account_daily_key: 'facebook:982406442148381:2026-08-26', fetched_at: 1_787_790_654_000,
        sync_run_id: 'meta:facebook:scheduled', followers: 181_646, views: 6_522_449, reach: 1_816_587,
      } }],
    },
    customerSnapshot: {
      observationDates: { facebook: '2026-08-25', tiktok: '2026-08-23' },
      accountDates: { facebook: '2026-08-25' },
      stateKeys: allNewKeys.slice(0, -2),
    },
  };
}

function dailyRows(platform, metricDate, count) {
  return Array.from({ length: count }, (_, index) => {
    const externalId = `${platform}-${String(index + 1).padStart(5, '0')}`;
    const sourceAccount = platform === 'facebook' ? '982406442148381' : 'chemistry_k';
    return { fields: {
      platform,
      external_content_id: externalId,
      account_id: 'chemistry_k',
      metric_date: metricDate,
      content_daily_key: `${platform}:${sourceAccount}:${externalId}:${metricDate}`,
      views: index + 10,
      likes: index + 1,
      comments: 0,
      shares: 0,
      unique_viewers: platform === 'tiktok' ? index + 5 : null,
      avg_watch_time_seconds: platform === 'tiktok' ? 2.5 : null,
      total_watch_time_seconds: platform === 'tiktok' ? index + 100 : null,
      completion_rate: platform === 'tiktok' ? 0.25 : null,
    } };
  });
}
