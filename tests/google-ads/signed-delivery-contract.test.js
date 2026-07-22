import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleAdsDestinationRows,
  expectedGoogleAdsIdempotencyKey,
  validateGoogleAdsDeliveryEnvelope,
} from '../../packages/application/src/google-ads/signed-delivery-contract.js';
import { createGoogleAdsDeliveryEnvelope } from '../helpers/google-ads-delivery-fixture.js';

test('validates exact allowlisted identity and builds applied RAW plus Canonical field names', () => {
  const envelope = validateGoogleAdsDeliveryEnvelope(createGoogleAdsDeliveryEnvelope());
  const rows = buildGoogleAdsDestinationRows(envelope);
  assert.equal(expectedGoogleAdsIdempotencyKey(envelope.deliveryId), `google-ads:${envelope.deliveryId}`);
  assert.equal(rows.raw.accounts[0].raw_account_key, 'google_ads:5662332033:account');
  assert.equal(rows.raw.campaigns[0].raw_campaign_key, 'google_ads:5662332033:campaign:1001');
  assert.equal(rows.raw.campaigns[0].campaign_budget_resource_name, 'customers/5662332033/campaignBudgets/2001');
  assert.equal(rows.canonical.campaigns[0].campaign_key, 'google_ads:5662332033:campaign:1001');
  assert.equal(rows.canonical.adGroups[0].ad_group_key, 'google_ads:5662332033:ad_group:3001');
  assert.equal(rows.canonical.creatives[0].creative_key, 'google_ads:5662332033:creative:5001');
  assert.equal('ads_campaign_key' in rows.canonical.campaigns[0], false);
  assert.equal('ads_ad_group_key' in rows.canonical.adGroups[0], false);
  assert.equal('ads_creative_key' in rows.canonical.creatives[0], false);
  assert.equal(rows.canonical.daily[0].spend_micros, 689230000);
  assert.equal(rows.canonical.daily[0].conversions, 0);
});

test('keeps unsupported Script campaign dates null instead of querying rejected fields', () => {
  const rows = buildGoogleAdsDestinationRows(createGoogleAdsDeliveryEnvelope());
  assert.equal(rows.raw.campaigns[0].start_date, null);
  assert.equal(rows.raw.campaigns[0].end_date, null);
  assert.equal(rows.canonical.campaigns[0].start_date, null);
  assert.equal(rows.canonical.campaigns[0].end_date, null);
});

test('fails closed for any account outside the exact Chemistry K allowlist', () => {
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(createGoogleAdsDeliveryEnvelope({ customerId: '1111111111' })),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_IDENTITY_REJECTED',
  );
});

test('rejects unknown payload fields, duplicate stable identities, and mismatched counts', () => {
  const unknown = createGoogleAdsDeliveryEnvelope();
  unknown.extra = true;
  assert.throws(() => validateGoogleAdsDeliveryEnvelope(unknown), /fields do not match/);

  const duplicate = createGoogleAdsDeliveryEnvelope();
  duplicate.datasets.campaigns.push({ ...duplicate.datasets.campaigns[0] });
  duplicate.datasetCounts.campaigns = 2;
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(duplicate),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_DUPLICATE_ROW',
  );

  const countMismatch = createGoogleAdsDeliveryEnvelope({ datasetCounts: { campaigns: 2 } });
  assert.throws(() => validateGoogleAdsDeliveryEnvelope(countMismatch), /does not match/);
});

test('rejects relation drift, unstable ordering, and mixed-currency daily rows', () => {
  const relation = createGoogleAdsDeliveryEnvelope();
  relation.datasets.adGroups[0].campaignId = '9999';
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(relation),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_RELATION_INVALID',
  );

  const order = createGoogleAdsDeliveryEnvelope();
  order.datasets.campaigns = [
    { ...order.datasets.campaigns[0], campaignId: '1002', resourceName: 'customers/5662332033/campaigns/1002' },
    order.datasets.campaigns[0],
  ];
  order.datasetCounts.campaigns = 2;
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(order),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_ORDER_INVALID',
  );

  const currency = createGoogleAdsDeliveryEnvelope();
  currency.datasets.campaignDailyMetrics[0].currency = 'USD';
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(currency),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_IDENTITY_REJECTED',
  );
});

test('only segment_key=all is accepted for Canonical v1', () => {
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(createGoogleAdsDeliveryEnvelope({
      datasets: { campaignDailyMetrics: [{
        ...createGoogleAdsDeliveryEnvelope().datasets.campaignDailyMetrics[0],
        segmentKey: 'device=MOBILE',
      }] },
    })),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_IDENTITY_REJECTED',
  );
});


test('rejects datasets beyond the exact bounded row limits', () => {
  const envelope = createGoogleAdsDeliveryEnvelope();
  envelope.datasets.campaigns = Array.from({ length: 501 }, (_, index) => ({
    ...envelope.datasets.campaigns[0],
    campaignId: String(1001 + index),
  }));
  envelope.datasetCounts.campaigns = 501;
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(envelope),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_LIMIT_EXCEEDED',
  );
});


test('rejects malformed allowlist IDs instead of stripping arbitrary hyphens', () => {
  const envelope = createGoogleAdsDeliveryEnvelope({ customerId: '--5662332033' });
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(envelope),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID',
  );
});

test('rejects impossible calendar dates and non-canonical UTC instants', () => {
  const impossibleDate = createGoogleAdsDeliveryEnvelope();
  impossibleDate.datasets.campaignDailyMetrics[0].metricDate = '2026-02-30';
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(impossibleDate),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID',
  );

  const impossibleInstant = createGoogleAdsDeliveryEnvelope();
  impossibleInstant.fetchedAt = '2026-02-30T12:00:00Z';
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(impossibleInstant),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID',
  );

  const offsetInstant = createGoogleAdsDeliveryEnvelope();
  offsetInstant.fetchedAt = '2026-07-22T12:00:00+07:00';
  assert.throws(
    () => validateGoogleAdsDeliveryEnvelope(offsetInstant),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID',
  );
});
