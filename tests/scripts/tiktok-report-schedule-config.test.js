import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyTikTokReportScheduleActivation,
  planTikTokReportScheduleActivation,
} from '../../scripts/lib/tiktok-report-schedule-config.js';

test('schedule preview plans two flags and does not mutate the file', async () => {
  const { filePath, source } = await fixture();
  const result = await planTikTokReportScheduleActivation({ filePath });
  assert.equal(result.readyToApply, true);
  assert.equal(result.summary.scheduleFlagsToEnable, 2);
  assert.equal(await readFile(filePath, 'utf8'), source);
});

test('schedule apply enables both flags and verifies idempotently', async () => {
  const { filePath } = await fixture();
  const result = await applyTikTokReportScheduleActivation({ filePath });
  assert.equal(result.ok, true);
  assert.equal(result.changed.length, 2);
  assert.equal(result.verification.actions.length, 0);
  const rerun = await applyTikTokReportScheduleActivation({ filePath });
  assert.equal(rerun.changed.length, 0);
});


test('schedule preview accepts existing legacy report setting keys without profile switching', async () => {
  const { filePath } = await fixture({
    MKT_DAILY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:daily',
    MKT_WEEKLY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:weekly',
  });
  const result = await planTikTokReportScheduleActivation({ filePath });
  assert.equal(result.readyToApply, true);
  assert.equal(result.summary.warnings, 2);
  assert.equal(result.warnings.every((item) => item.code === 'LEGACY_REPORT_SETTING_KEY_IN_USE'), true);
});

test('schedule activation fails closed for placeholder table IDs', async () => {
  const { filePath } = await fixture({ LARK_TABLE_MKT_REPORT_TOP_CONTENT: 'replace-with-table-id' });
  const result = await planTikTokReportScheduleActivation({ filePath });
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts.some((item) => item.code === 'REPORT_TABLE_ID_INVALID'), true);
});

async function fixture(overrides = {}) {
  const values = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
    MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    MKT_DAILY_REPORT_TIME: '08:10',
    MKT_WEEKLY_REPORT_TIME: '08:15',
    MKT_WEEKLY_REPORT_WEEKDAY: 'monday',
    MKT_DAILY_REPORT_SETTING_KEY: 'integration_workspace:tiktok:daily',
    MKT_WEEKLY_REPORT_SETTING_KEY: 'integration_workspace:tiktok:weekly',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tblSettings',
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tblSnapshots',
    LARK_TABLE_MKT_REPORT_METRIC_VALUES: 'tblMetrics',
    LARK_TABLE_MKT_REPORT_TOP_CONTENT: 'tblTop',
    ...overrides,
  };
  const source = `{\n${Object.entries(values).map(([key, value]) => `  "${key}": "${value}"`).join(',\n')}\n}\n`;
  const directory = await mkdtemp(join(tmpdir(), 'mkt-schedules-'));
  const filePath = join(directory, 'wrangler.sync.jsonc');
  await writeFile(filePath, source);
  return { filePath, source };
}
