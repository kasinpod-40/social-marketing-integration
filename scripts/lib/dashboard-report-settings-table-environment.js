export const DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES = Object.freeze([
  'LARK_TABLE_MKT_REPORT_SETTINGS',
  'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
]);

/**
 * Build the effective non-secret table mapping used by Dashboard settings reconciliation.
 * Non-empty subprocess values supplied by the Finalizer override local Wrangler mappings, while
 * empty ambient values cannot erase a valid local mapping during preflight.
 */
export function resolveDashboardReportSettingsTableEnvironment(input = {}) {
  const wranglerEnv = input.wranglerEnv ?? {};
  const runtimeEnv = input.runtimeEnv ?? {};
  const env = { ...wranglerEnv };

  for (const envName of DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES) {
    if (hasText(runtimeEnv[envName])) env[envName] = runtimeEnv[envName].trim();
  }

  const missingTableEnvNames = DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES.filter(
    (envName) => !hasText(env[envName]),
  );
  return Object.freeze({
    env: Object.freeze(env),
    missingTableEnvNames: Object.freeze(missingTableEnvNames),
  });
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}
