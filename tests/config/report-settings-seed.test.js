import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_REPORT_PLATFORM_SCOPES,
  createReportSettingRowsForProfile,
} from '../../packages/config/src/report-settings.seed.js';
import {
  buildCustomerWeeklyNotificationReportSettingRows,
  seedCustomerWeeklyNotificationReportSettings,
  seedReportSettings,
} from '../../packages/application/src/use-cases/seed-report-settings.js';

const EXPECTED_SETTING_COUNT = 2 + (DASHBOARD_REPORT_PLATFORM_SCOPES.length * 8);

test('creates canonical multichannel Dashboard settings including 1D and preserves TikTok compatibility rows', () => {
  const rows = createReportSettingRowsForProfile('integration_workspace');
  assert.equal(rows.length, EXPECTED_SETTING_COUNT);
  assert.deepEqual(rows.slice(0, 2).map((row) => row.report_setting_key), [
    'integration_workspace:tiktok:daily',
    'integration_workspace:tiktok:weekly',
  ]);
  assert.equal(rows[0].customer_profile, 'integration_workspace');
  assert.equal(rows[0].period_kind, 'rolling_days');
  assert.equal(rows[0].window_days, 1);
  assert.equal(rows[0].top_content_limit, 5);
  assert.equal(rows[0].top_ads_limit, 5);
  assert.equal(rows[0].ai_enabled, false);
  assert.equal(rows[0].notification_enabled, false);
  assert.equal(rows[1].send_weekday, 'monday');
  for (const platformScope of DASHBOARD_REPORT_PLATFORM_SCOPES) {
    const platformRows = rows.filter((row) => row.platforms[0] === platformScope
      && row.report_type === 'dashboard_performance_report');
    assert.deepEqual(platformRows.map((row) => row.window_days), [1, 3, 7, 9, 15, 30, 90, null]);
    assert.equal(platformRows.at(-1).report_setting_key, `integration_workspace:${platformScope}:custom_range`);
    assert.equal(platformRows.every((row) => row.top_ads_limit === 5), true);
  }
  assert.equal(rows.every((row) => row.account_keys_json === '["chemistry_k"]'), true);
  assert.equal(rows.some((row) => row.report_setting_key.startsWith('dev_ft_pumkin:')), false);
});

test('legacy report profile labels resolve to canonical Integration Workspace settings', () => {
  const canonical = createReportSettingRowsForProfile('integration_workspace');
  for (const alias of ['dev_ft_pumkin', 'uat_chemistry_k']) {
    const rows = createReportSettingRowsForProfile(alias);
    assert.deepEqual(rows, canonical);
    assert.equal(rows[0].customer_profile, 'integration_workspace');
  }
});

test('keeps Production report identity separate', () => {
  const rows = createReportSettingRowsForProfile('chemistry_k');
  assert.equal(rows.length, EXPECTED_SETTING_COUNT);
  assert.equal(rows[0].report_setting_key, 'chemistry_k:tiktok:daily');
  assert.equal(rows[0].customer_profile, 'chemistry_k');
  assert.equal(rows[0].account_keys_json, '["chemistry_k"]');
});

test('rejects unknown report profile instead of inventing an account', () => {
  assert.throws(() => createReportSettingRowsForProfile('unknown'), /Unsupported report setting profile/);
});

test('seeds report settings idempotently by canonical report_setting_key', async () => {
  let call;
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listByFieldValues() { return []; },
    async createMany() { return { created: 0 }; },
    async updateMany() { return { updated: 0 }; },
  };
  const syncEngine = {
    async syncByKey(input) { call = input; return { created: input.rows.length, updated: 0, skipped: 0 }; },
  };
  const result = await seedReportSettings({
    repository, syncEngine, tableId: 'tbl_settings', profileKey: 'integration_workspace',
  });
  assert.equal(call.keyField, 'report_setting_key');
  assert.equal(call.rows.length, EXPECTED_SETTING_COUNT);
  assert.equal(call.rows[0].report_setting_key, 'integration_workspace:tiktok:daily');
  assert.equal(result.created, EXPECTED_SETTING_COUNT);
});

test('builds only eight active Customer 7D settings for Weekly Notification activation', () => {
  const rows = buildCustomerWeeklyNotificationReportSettingRows('chemistry_k');
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((row) => row.platforms[0]).sort(), [
    'chatwoot', 'facebook', 'google_ads', 'instagram', 'meta_ads', 'tiktok', 'woocommerce', 'youtube',
  ]);
  assert.equal(rows.every((row) => row.customer_profile === 'chemistry_k'), true);
  assert.equal(rows.every((row) => row.window_days === 7), true);
  assert.equal(rows.every((row) => row.ai_enabled === true), true);
  assert.equal(rows.every((row) => row.notification_enabled === true), true);
  assert.equal(rows.every((row) => row.group_id === null), true);
  assert.throws(
    () => buildCustomerWeeklyNotificationReportSettingRows('integration_workspace'),
    /chemistry_k profile/u,
  );
});

test('seeds only Customer Weekly Notification settings by stable key', async () => {
  let call;
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listByFieldValues() { return []; },
    async createMany() { return { created: 0 }; },
    async updateMany() { return { updated: 0 }; },
  };
  const syncEngine = {
    async syncByKey(input) { call = input; return { created: 0, updated: 8, skipped: 0 }; },
  };
  const result = await seedCustomerWeeklyNotificationReportSettings({
    repository,
    syncEngine,
    tableId: 'tbl_settings',
    profileKey: 'chemistry_k',
  });
  assert.equal(call.keyField, 'report_setting_key');
  assert.equal(call.rows.length, 8);
  assert.equal(result.updated, 8);
});
