import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';
import { seedReportSettings } from '../../packages/application/src/use-cases/seed-report-settings.js';

test('creates deterministic Integration Workspace settings for Chemistry K TikTok', () => {
  const rows = createReportSettingRowsForProfile('integration_workspace');
  assert.deepEqual(rows.map((row) => row.report_setting_key), [
    'integration_workspace:tiktok:daily',
    'integration_workspace:tiktok:weekly',
    'integration_workspace:tiktok:rolling:3d',
    'integration_workspace:tiktok:rolling:7d',
    'integration_workspace:tiktok:rolling:9d',
    'integration_workspace:tiktok:rolling:15d',
    'integration_workspace:tiktok:rolling:30d',
    'integration_workspace:tiktok:rolling:90d',
    'integration_workspace:tiktok:custom_range',
  ]);
  assert.equal(rows[0].customer_profile, 'integration_workspace');
  assert.equal(rows[0].period_kind, 'rolling_days');
  assert.equal(rows[0].window_days, 1);
  assert.equal(rows[0].ai_enabled, false);
  assert.equal(rows[0].notification_enabled, false);
  assert.equal(rows[1].send_weekday, 'monday');
  assert.equal(rows[2].report_type, 'dashboard_performance_report');
  assert.equal(rows[2].window_days, 3);
  assert.equal(rows.at(-1).period_kind, 'custom_range');
  assert.equal(rows.at(-1).window_days, null);
  assert.equal(rows[0].account_keys_json, '["chemistry_k"]');
});

test('legacy report profile labels resolve to the canonical Integration Workspace settings', () => {
  for (const alias of ['dev_ft_pumkin', 'uat_chemistry_k']) {
    const rows = createReportSettingRowsForProfile(alias);
    assert.deepEqual(rows.map((row) => row.report_setting_key), [
      'integration_workspace:tiktok:daily',
      'integration_workspace:tiktok:weekly',
      'integration_workspace:tiktok:rolling:3d',
      'integration_workspace:tiktok:rolling:7d',
      'integration_workspace:tiktok:rolling:9d',
      'integration_workspace:tiktok:rolling:15d',
      'integration_workspace:tiktok:rolling:30d',
      'integration_workspace:tiktok:rolling:90d',
      'integration_workspace:tiktok:custom_range',
    ]);
    assert.equal(rows[0].customer_profile, 'integration_workspace');
    assert.equal(rows[0].account_keys_json, '["chemistry_k"]');
  }
});

test('keeps Production report identity separate', () => {
  const rows = createReportSettingRowsForProfile('chemistry_k');
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
  assert.equal(call.rows.length, 9);
  assert.equal(call.rows[0].report_setting_key, 'integration_workspace:tiktok:daily');
  assert.equal(result.created, 9);
});
