import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadReportSetting,
  normalizeReportSettingRecord,
} from '../../packages/application/src/reports/load-report-setting.js';
import {
  loadTikTokReportMetricDefinitions,
  TIKTOK_REPORT_METRIC_KEYS,
} from '../../packages/application/src/reports/load-report-metric-definitions.js';

function settingRecord(overrides = {}) {
  return { recordId: 'setting-1', fields: {
    report_setting_key: 'dev_ft_pumkin:tiktok:daily',
    customer_profile: 'dev_ft_pumkin',
    report_name: 'TikTok Daily Organic',
    report_type: 'daily_organic_report',
    period_type: 'daily',
    platforms: ['tiktok'],
    account_keys_json: '["ft_pumkin"]',
    timezone: 'Asia/Bangkok',
    utc_offset: '+07:00',
    send_time: '08:10',
    send_weekday: null,
    comparison_mode: 'previous_period',
    language: 'th',
    top_content_limit: 5,
    ai_enabled: false,
    notification_enabled: false,
    group_id: null,
    enabled: true,
    config_version: 'report-v1',
    ...overrides,
  } };
}

function metricRecord(key, overrides = {}) {
  return { fields: {
    metric_key: key,
    platform: 'tiktok',
    display_name: key,
    unit: 'count',
    enabled: true,
    client_visible: true,
    sort_order: 10,
    formula_version: 'tiktok-organic-v1',
    ...overrides,
  } };
}

test('normalizes a customer-scoped TikTok report setting', () => {
  const setting = normalizeReportSettingRecord(settingRecord());
  assert.equal(setting.reportSettingKey, 'dev_ft_pumkin:tiktok:daily');
  assert.deepEqual(setting.accountKeys, ['ft_pumkin']);
  assert.deepEqual(setting.platforms, ['tiktok']);
  assert.equal(setting.topContentLimit, 5);
  assert.equal(setting.enabled, true);
});

test('report setting loader rejects missing, duplicate, profile mismatch, and disabled rows', async () => {
  const repository = { listByFieldValues: async () => [] };
  await assert.rejects(() => loadReportSetting({
    repository, tableId: 'tbl_settings', reportSettingKey: 'missing', customerProfile: 'dev_ft_pumkin',
  }), (error) => error.code === 'REPORT_SETTING_NOT_FOUND');

  repository.listByFieldValues = async () => [settingRecord(), settingRecord()];
  await assert.rejects(() => loadReportSetting({
    repository, tableId: 'tbl_settings', reportSettingKey: 'duplicate', customerProfile: 'dev_ft_pumkin',
  }), (error) => error.code === 'REPORT_SETTING_DUPLICATE');

  repository.listByFieldValues = async () => [settingRecord({ customer_profile: 'chemistry_k' })];
  await assert.rejects(() => loadReportSetting({
    repository, tableId: 'tbl_settings', reportSettingKey: 'x', customerProfile: 'dev_ft_pumkin',
  }), (error) => error.code === 'REPORT_SETTING_PROFILE_MISMATCH');

  repository.listByFieldValues = async () => [settingRecord({ enabled: false })];
  await assert.rejects(() => loadReportSetting({
    repository, tableId: 'tbl_settings', reportSettingKey: 'x', customerProfile: 'dev_ft_pumkin',
  }), (error) => error.code === 'REPORT_SETTING_DISABLED');
});

test('metric definition loader requires every TikTok report metric exactly once', async () => {
  const records = TIKTOK_REPORT_METRIC_KEYS.map((key, index) => metricRecord(key, { sort_order: index + 1 }));
  const repository = { listByFieldValues: async () => records };
  const definitions = await loadTikTokReportMetricDefinitions({ repository, tableId: 'tbl_metrics' });
  assert.equal(definitions.length, TIKTOK_REPORT_METRIC_KEYS.length);
  assert.equal(definitions[0].metric_key, TIKTOK_REPORT_METRIC_KEYS[0]);

  repository.listByFieldValues = async () => records.slice(1);
  await assert.rejects(
    () => loadTikTokReportMetricDefinitions({ repository, tableId: 'tbl_metrics' }),
    (error) => error.code === 'REPORT_METRIC_DEFINITION_MISSING',
  );

  repository.listByFieldValues = async () => [...records, metricRecord(TIKTOK_REPORT_METRIC_KEYS[0])];
  await assert.rejects(
    () => loadTikTokReportMetricDefinitions({ repository, tableId: 'tbl_metrics' }),
    (error) => error.code === 'REPORT_METRIC_DEFINITION_DUPLICATE',
  );
});

test('metric definition loader fails closed on disabled or wrong formula versions', async () => {
  const records = TIKTOK_REPORT_METRIC_KEYS.map((key) => metricRecord(key));
  const repository = { listByFieldValues: async () => records };
  records[0] = metricRecord(TIKTOK_REPORT_METRIC_KEYS[0], { enabled: false });
  await assert.rejects(
    () => loadTikTokReportMetricDefinitions({ repository, tableId: 'tbl_metrics' }),
    (error) => error.code === 'REPORT_METRIC_DEFINITION_DISABLED',
  );

  records[0] = metricRecord(TIKTOK_REPORT_METRIC_KEYS[0], { formula_version: 'legacy' });
  await assert.rejects(
    () => loadTikTokReportMetricDefinitions({ repository, tableId: 'tbl_metrics' }),
    (error) => error.code === 'REPORT_FORMULA_VERSION_MISMATCH',
  );
});
