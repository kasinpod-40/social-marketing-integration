import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES,
  resolveDashboardReportSettingsTableEnvironment,
} from '../../scripts/lib/dashboard-report-settings-table-environment.js';

function completeWranglerEnv() {
  return Object.fromEntries(
    DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES.map(
      (envName, index) => [envName, `tblWrangler${index}`],
    ),
  );
}

test('Dashboard settings use non-empty Finalizer mappings over local Wrangler mappings', () => {
  const wranglerEnv = completeWranglerEnv();
  const result = resolveDashboardReportSettingsTableEnvironment({
    wranglerEnv,
    runtimeEnv: {
      LARK_TABLE_MKT_REPORT_METRIC_VALUES: 'tblResolvedMetric',
      LARK_TABLE_MKT_REPORT_SETTINGS: '',
    },
  });
  assert.deepEqual(result.missingTableEnvNames, []);
  assert.equal(result.env.LARK_TABLE_MKT_REPORT_METRIC_VALUES, 'tblResolvedMetric');
  assert.equal(
    result.env.LARK_TABLE_MKT_REPORT_SETTINGS,
    wranglerEnv.LARK_TABLE_MKT_REPORT_SETTINGS,
  );
});

test('Dashboard settings still block mappings absent from both sources', () => {
  const wranglerEnv = completeWranglerEnv();
  delete wranglerEnv.LARK_TABLE_MKT_REPORT_TOP_CONTENT;
  const result = resolveDashboardReportSettingsTableEnvironment({
    wranglerEnv,
    runtimeEnv: { LARK_TABLE_MKT_REPORT_TOP_CONTENT: '   ' },
  });
  assert.deepEqual(result.missingTableEnvNames, ['LARK_TABLE_MKT_REPORT_TOP_CONTENT']);
});

test('schema setup resolves the Metric table before Compatibility inspection', () => {
  const source = readFileSync(
    new URL('../../scripts/setup-report-schema.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /resolveReportMetricValueTableEnvironment/u);
  assert.match(
    source,
    /resolveReportMetricValueTableEnvironment[\s\S]*inspectLarkDashboardCompatibilityFreeze/u,
  );
});

test('Dashboard settings preflight consumes the effective mapping helper', () => {
  const source = readFileSync(
    new URL('../../scripts/reconcile-dashboard-report-settings.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /resolveDashboardReportSettingsTableEnvironment/u);
  assert.match(source, /runtimeEnv: process\.env/u);
  assert.doesNotMatch(source, /missingTableIds = REQUIRED_TABLE_ENV_NAMES/u);
});
