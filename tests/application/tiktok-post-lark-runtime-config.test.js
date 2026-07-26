import test from 'node:test';
import assert from 'node:assert/strict';
import { readTikTokPostLarkRuntimeConfig } from '../../packages/config/src/tiktok-post-lark-runtime-config.js';

test('TikTok post-Lark runtime defaults every execution gate to false', () => {
  const config = readTikTokPostLarkRuntimeConfig({});
  assert.equal(config.watermarkAdmissionEnabled, false);
  assert.equal(config.postProcessReportEnabled, false);
  assert.equal(config.settleMs, 5_000);
  assert.equal(config.d1ReportMaxContentRecords, 10_000);
  assert.equal(config.reportFloatTolerance, 1e-9);
});

test('post-processing report cannot be enabled without watermark admission', () => {
  assert.throws(() => readTikTokPostLarkRuntimeConfig({
    MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED: 'true',
  }), (error) => error.code === 'MKT_TIKTOK_POST_LARK_CONFIG_INVALID'
    && error.details.fieldName === 'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED');
});

test('TikTok post-Lark bounds reject unsafe or malformed values', () => {
  for (const env of [
    { MKT_TIKTOK_WATERMARK_SETTLE_MS: '60001' },
    { MKT_REPORT_D1_MAX_CONTENT_RECORDS: '50001' },
    { MKT_REPORT_D1_FLOAT_TOLERANCE: '0.1' },
    { MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'yes' },
  ]) {
    assert.throws(
      () => readTikTokPostLarkRuntimeConfig(env),
      (error) => error.code === 'MKT_TIKTOK_POST_LARK_CONFIG_INVALID',
    );
  }
});

test('approved bounded values are normalized', () => {
  const config = readTikTokPostLarkRuntimeConfig({
    MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
    MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED: 'true',
    MKT_TIKTOK_WATERMARK_SETTLE_MS: '0',
    MKT_REPORT_D1_MAX_CONTENT_RECORDS: '2021',
    MKT_REPORT_D1_FLOAT_TOLERANCE: '0.000001',
  });
  assert.equal(config.watermarkAdmissionEnabled, true);
  assert.equal(config.postProcessReportEnabled, true);
  assert.equal(config.settleMs, 0);
  assert.equal(config.d1ReportMaxContentRecords, 2021);
  assert.equal(config.reportFloatTolerance, 0.000001);
});
