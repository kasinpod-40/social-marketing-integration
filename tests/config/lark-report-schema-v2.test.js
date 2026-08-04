import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_REPORT_SCHEMA_V2,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';
import {
  LARK_REPORT_MATERIALIZATION_SCHEMA,
} from '../../packages/config/src/lark-report-materialization-schema.js';
import {
  DASHBOARD_REPORT_PLATFORM_SCOPES,
} from '../../packages/config/src/report-settings.seed.js';
import {
  listReportPlatformContracts,
} from '../../packages/application/src/reports/report-platform-adapter-registry.js';

const ORGANIC_PLATFORM_SCOPES = Object.freeze([
  'facebook', 'instagram', 'tiktok', 'youtube',
]);
const PAID_ADS_PLATFORM_SCOPES = Object.freeze([
  'meta_ads', 'google_ads', 'tiktok_ads',
]);

test('Report platform registry, Settings seed and Lark schema remain aligned', () => {
  assert.equal(validateReportSchemaV2(), true);

  const canonicalPlatforms = [...DASHBOARD_REPORT_PLATFORM_SCOPES];
  assert.deepEqual(
    listReportPlatformContracts().map((contract) => contract.platformScope),
    canonicalPlatforms,
  );
  assert.deepEqual(
    LARK_REPORT_MATERIALIZATION_SCHEMA.sharedOptionExtensions.platforms,
    canonicalPlatforms,
  );

  const topAds = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportTopAds');
  assert.ok(topAds);
  assert.equal(topAds.envName, 'LARK_TABLE_MKT_REPORT_TOP_ADS');
  assert.equal(topAds.fields[0].fieldName, 'report_ad_key');
  assert.equal(topAds.fields[0].primary, true);
  const adsPlatform = topAds.fields.find((field) => field.fieldName === 'platform');
  assert.deepEqual(
    adsPlatform.property.options.map((option) => option.name),
    PAID_ADS_PLATFORM_SCOPES,
  );

  const settingsTable = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportSettings');
  const settingsPlatforms = settingsTable.fields.find((field) => field.fieldName === 'platforms');
  assert.deepEqual(
    settingsPlatforms.property.options.map((option) => option.name),
    canonicalPlatforms,
  );
  const topAdsLimit = settingsTable.fields.find((field) => field.fieldName === 'top_ads_limit');
  assert.ok(topAdsLimit);
  assert.equal(topAdsLimit.type, 2);

  const snapshotTable = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportSnapshots');
  const snapshotPlatform = snapshotTable.fields.find((field) => field.fieldName === 'platform');
  assert.deepEqual(
    snapshotPlatform.property.options.map((option) => option.name),
    canonicalPlatforms,
  );

  const metricTable = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportMetricValues');
  const metricPlatform = metricTable.fields.find((field) => field.fieldName === 'platform');
  assert.deepEqual(
    metricPlatform.property.options.map((option) => option.name),
    canonicalPlatforms,
  );
  const statusField = metricTable.fields.find((field) => field.fieldName === 'data_status');
  assert.equal(statusField.property.options.some((option) => option.name === 'source_unavailable'), true);

  const topContent = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportTopContent');
  const topContentPlatform = topContent.fields.find((field) => field.fieldName === 'platform');
  assert.deepEqual(
    topContentPlatform.property.options.map((option) => option.name),
    ORGANIC_PLATFORM_SCOPES,
  );
});
