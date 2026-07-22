import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';
import { seedReportSettings } from '../../packages/application/src/use-cases/seed-report-settings.js';

test('creates deterministic daily and weekly settings per customer profile', () => {
  const rows = createReportSettingRowsForProfile('integration_workspace');
  assert.deepEqual(rows.map((row) => row.report_setting_key), [
    'integration_workspace:tiktok:daily',
    'integration_workspace:tiktok:weekly',
  ]);
  assert.equal(rows[0].ai_enabled, false);
  assert.equal(rows[0].notification_enabled, false);
  assert.equal(rows[1].send_weekday, 'monday');
  assert.equal(rows[0].account_keys_json, '["ft_pumkin"]');
});

test('rejects unknown report profile instead of inventing an account', () => {
  assert.throws(() => createReportSettingRowsForProfile('unknown'), /Unsupported report setting profile/);
});

test('seeds report settings idempotently by report_setting_key', async () => {
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
  assert.equal(call.rows.length, 2);
  assert.equal(result.created, 2);
});
