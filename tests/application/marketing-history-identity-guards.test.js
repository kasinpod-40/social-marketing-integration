import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdsFactKey,
  createConversionFactKey,
  createReportId,
} from '../../packages/application/src/storage/marketing-history-contract.js';

test('Ads Stable-key builders require explicit none values instead of converting null silently', () => {
  assert.throws(
    () => createAdsFactKey({
      platform: 'google_ads', account_key: 'chemistry_k', report_level: 'campaign',
      external_entity_id: 'campaign-1', metric_date: '2026-07-22',
      breakdown_key: null, segment_key: 'none',
    }),
    (error) => error.code === 'MKT_STORAGE_CONTRACT_INVALID'
      && error.details.fieldName === 'breakdown_key',
  );
  assert.throws(
    () => createConversionFactKey({
      platform: 'google_ads', account_key: 'chemistry_k', report_level: 'campaign',
      external_entity_id: 'campaign-1', metric_date: '2026-07-22',
      conversion_action_key: 'purchase', conversion_category: 'purchase',
      segment_key: null,
    }),
    (error) => error.code === 'MKT_STORAGE_CONTRACT_INVALID'
      && error.details.fieldName === 'segment_key',
  );
});

test('Storage Stable-key dates reject impossible calendar dates', () => {
  assert.throws(
    () => createReportId({
      report_setting_key: 'integration_workspace:tiktok:daily', account_key: 'chemistry_k',
      period_kind: '30D', period_start: '2026-02-30', period_end: '2026-03-31',
      formula_version: 'organic-v2',
    }),
    (error) => error.code === 'MKT_STORAGE_CONTRACT_INVALID'
      && error.details.fieldName === 'period_start',
  );
});
