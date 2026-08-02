import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPORT_PLATFORM_CAPABILITY,
  REPORT_SOURCE_STATUS,
  getReportPlatformContract,
} from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';

const generatorSource = readFileSync(new URL(
  '../../packages/application/src/use-cases/generate-dashboard-report-materialization.js',
  import.meta.url,
), 'utf8');
const d1Source = readFileSync(new URL(
  '../../packages/connectors/src/d1-chatwoot-report-source.js',
  import.meta.url,
), 'utf8');
const workerRouterSource = readFileSync(new URL(
  '../../apps/sync-worker/src/tiktok-d1-aware-report-job-router.js',
  import.meta.url,
), 'utf8');

test('Chatwoot Report remains UAT pending while the shared capability is implemented', () => {
  const contract = getReportPlatformContract('chatwoot');
  assert.equal(contract.capability, REPORT_PLATFORM_CAPABILITY.CUSTOMER_SERVICE);
  assert.equal(contract.sourceStatus, REPORT_SOURCE_STATUS.UAT_PENDING);
  assert.equal(contract.formulaVersion, 'chatwoot-customer-service-v1');
  assert.match(generatorSource, /REPORT_PLATFORM_CAPABILITY\.CUSTOMER_SERVICE/u);
  assert.match(generatorSource, /buildCustomerServiceResult/u);
});

test('Chatwoot settings use the shared Dashboard report identity and cannot bypass the source-status gate', () => {
  const rows = createReportSettingRowsForProfile('integration_workspace')
    .filter((row) => row.platforms?.[0] === 'chatwoot');
  assert.deepEqual(rows.map((row) => row.window_days), [1, 3, 7, 9, 15, 30, 90, null]);
  assert.equal(rows.every((row) => row.enabled === true), true);
  assert.equal(rows.every((row) => row.report_type === 'dashboard_performance_report'), true);
  assert.equal(getReportPlatformContract('chatwoot').sourceStatus, 'uat_pending');
});

test('Chatwoot D1 Report reader selects only PII-minimized fact fields', () => {
  assert.match(d1Source, /chatwoot_conversation_daily_facts/u);
  assert.match(d1Source, /chatwoot_account_daily_facts/u);
  assert.doesNotMatch(d1Source, /message_body|content_text|contact_email|contact_phone|contact_name/iu);
  assert.doesNotMatch(d1Source, /chatwoot_contact_state|chatwoot_message_analytics_state/u);
  assert.doesNotMatch(d1Source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/iu);
});

test('Chatwoot D1 Report reader is wired into the shared Worker registry without promoting Catalog state', () => {
  assert.match(workerRouterSource, /import \{ D1ChatwootReportSource \}/u);
  assert.match(workerRouterSource, /chatwoot:\s*new D1ChatwootReportSource\(\{ db \}\)/u);
  assert.equal(getReportPlatformContract('chatwoot').sourceStatus, REPORT_SOURCE_STATUS.UAT_PENDING);
});

test('runtime wiring does not invent Chatwoot-specific report ID aliases', () => {
  assert.doesNotMatch(workerRouterSource, /CHATWOOT_REPORT_ID|chatwoot_report_id/u);
  assert.match(generatorSource, /reportType:\s*REPORT_TYPE/u);
  assert.match(generatorSource, /platform:\s*input\.contract\.platformScope/u);
});
