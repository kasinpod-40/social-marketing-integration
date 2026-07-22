import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_ADS_VIEW_FILTER_MANUAL_ACTIONS,
  GOOGLE_ADS_VIEW_FILTER_VERSION,
  GOOGLE_ADS_VIEW_FILTERS,
  validateGoogleAdsViewFilters,
} from '../../packages/config/src/google-ads-view-filters.js';

test('Google Ads View filter contract is immutable and covers all 19 managed Views', () => {
  assert.equal(validateGoogleAdsViewFilters(), true);
  assert.equal(GOOGLE_ADS_VIEW_FILTER_VERSION, 'google-ads-view-filters-v0.13.5');
  assert.equal(Object.isFrozen(GOOGLE_ADS_VIEW_FILTERS), true);
  assert.equal(GOOGLE_ADS_VIEW_FILTERS.flatMap((table) => table.views).length, 19);
  assert.equal(GOOGLE_ADS_VIEW_FILTER_MANUAL_ACTIONS.length, 1);
});

test('Google Ads contract keeps 13 RAW error checks and exact explicit Filters', () => {
  const views = GOOGLE_ADS_VIEW_FILTERS.flatMap((table) => table.views);
  const rawErrors = views.filter((view) => view.name.includes('Google Ads RAW Errors'));
  assert.equal(rawErrors.length, 13);
  assert.equal(rawErrors.every((view) => (
    view.filterInfo.conjunction === 'and'
    && view.filterInfo.conditions.length === 1
    && view.filterInfo.conditions[0].operator === 'isEmpty'
  )), true);

  const conversion = views.find((view) => view.name.includes('Conversion Actions UAT'));
  assert.equal(conversion.filterInfo.conjunction, 'or');
  assert.deepEqual(conversion.filterInfo.conditions.map((condition) => condition.value), ['ENABLED', 'UNKNOWN']);

  const daily30d = views.find((view) => view.name.includes('Google Ads Daily 30D'));
  assert.deepEqual(daily30d.filterInfo.conditions, [
    { fieldName: 'platform', operator: 'is', value: 'google_ads' },
  ]);
});
