import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_REPORT_SCHEMA_V2,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';

test('multichannel Lark schema includes Top Ads and platform-neutral options', () => {
  assert.equal(validateReportSchemaV2(), true);
  const topAds = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportTopAds');
  assert.ok(topAds);
  assert.equal(topAds.envName, 'LARK_TABLE_MKT_REPORT_TOP_ADS');
  assert.equal(topAds.fields[0].fieldName, 'report_ad_key');
  assert.equal(topAds.fields[0].primary, true);
  const adsPlatform = topAds.fields.find((field) => field.fieldName === 'platform');
  assert.deepEqual(adsPlatform.property.options.map((option) => option.name), [
    'meta_ads', 'google_ads', 'tiktok_ads',
  ]);
  const metricTable = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportMetricValues');
  const metricPlatform = metricTable.fields.find((field) => field.fieldName === 'platform');
  assert.equal(metricPlatform.property.options.some((option) => option.name === 'youtube'), true);
  assert.equal(metricPlatform.property.options.some((option) => option.name === 'google_ads'), true);
  const statusField = metricTable.fields.find((field) => field.fieldName === 'data_status');
  assert.equal(statusField.property.options.some((option) => option.name === 'source_unavailable'), true);
});
