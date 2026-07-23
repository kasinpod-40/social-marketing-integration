import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readStorageRuntimeConfig,
  STORAGE_FEATURE_FLAG_ENV,
} from '../../packages/config/src/storage-runtime-config.js';

test('all Storage Foundation feature flags default to false', () => {
  const config = readStorageRuntimeConfig({});
  assert.deepEqual(config, {
    timeSeriesD1WriteEnabled: false,
    timeSeriesD1BackfillEnabled: false,
    reportD1ShadowReadEnabled: false,
    reportD1ReadEnabled: false,
    reportPresetMaterializationEnabled: false,
    larkDailyRetentionEnabled: false,
    notificationRuntimeEnabled: false,
  });
});

test('storage flags accept explicit string and typed booleans', () => {
  const config = readStorageRuntimeConfig({
    MKT_TIME_SERIES_D1_WRITE_ENABLED: 'true',
    MKT_TIME_SERIES_D1_BACKFILL_ENABLED: true,
    MKT_REPORT_D1_SHADOW_READ_ENABLED: 'false',
  });
  assert.equal(config.timeSeriesD1WriteEnabled, true);
  assert.equal(config.timeSeriesD1BackfillEnabled, true);
  assert.equal(config.reportD1ShadowReadEnabled, false);
});

test('invalid storage flags fail closed and retention requires D1 reader cutover', () => {
  assert.throws(
    () => readStorageRuntimeConfig({ MKT_TIME_SERIES_D1_WRITE_ENABLED: 'yes' }),
    (error) => error.code === 'MKT_STORAGE_RUNTIME_CONFIG_INVALID',
  );
  assert.throws(
    () => readStorageRuntimeConfig({ MKT_LARK_DAILY_RETENTION_ENABLED: 'true' }),
    (error) => error.code === 'MKT_STORAGE_RUNTIME_CONFIG_INVALID',
  );
  const allowed = readStorageRuntimeConfig({
    MKT_REPORT_D1_READ_ENABLED: 'true',
    MKT_LARK_DAILY_RETENTION_ENABLED: 'true',
  });
  assert.equal(allowed.reportD1ReadEnabled, true);
  assert.equal(allowed.larkDailyRetentionEnabled, true);
});

test('the exact approved flag names are exported for release-example verification', () => {
  assert.deepEqual(Object.values(STORAGE_FEATURE_FLAG_ENV), [
    'MKT_TIME_SERIES_D1_WRITE_ENABLED',
    'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
    'MKT_REPORT_D1_SHADOW_READ_ENABLED',
    'MKT_REPORT_D1_READ_ENABLED',
    'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
    'MKT_LARK_DAILY_RETENTION_ENABLED',
    'MKT_NOTIFICATION_RUNTIME_ENABLED',
  ]);
});
