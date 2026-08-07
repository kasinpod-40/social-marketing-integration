import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION,
  assertReportMetricDisplayValueBackfillConfirmation,
  planReportMetricDisplayValueBackfill,
} from '../../scripts/lib/report-metric-display-value-backfill.js';

test('plans only display_value changes and converts micros without touching canonical values', () => {
  const plan = planReportMetricDisplayValueBackfill({
    records: [
      {
        recordId: 'rec-spend',
        fields: {
          metric_key: 'meta_ads:spend_micros',
          current_value: 25_373_376_028,
          display_value: null,
          unit: 'currency',
        },
      },
      {
        recordId: 'rec-sales',
        fields: {
          metric_key: 'woocommerce:net_sales_micros',
          current_value: 168_010_000_000,
          display_value: 168_010,
          unit: 'currency',
        },
      },
      {
        recordId: 'rec-orders',
        fields: {
          metric_key: 'woocommerce:recognized_orders',
          current_value: 45,
          display_value: null,
          unit: 'count',
        },
      },
      {
        recordId: 'rec-null',
        fields: {
          metric_key: 'facebook:period_views',
          current_value: null,
          display_value: null,
          unit: 'count',
        },
      },
    ],
  });

  assert.equal(plan.recordCount, 4);
  assert.equal(plan.microsCurrencyCount, 2);
  assert.equal(plan.nullValueCount, 1);
  assert.equal(plan.convergedCount, 2);
  assert.equal(plan.pendingUpdateCount, 2);
  assert.deepEqual(plan.updates.map((row) => ({
    recordId: row.recordId,
    desiredDisplayValue: row.desiredDisplayValue,
    fields: row.fields,
  })), [
    {
      recordId: 'rec-spend',
      desiredDisplayValue: 25_373.376,
      fields: { display_value: 25_373.376 },
    },
    {
      recordId: 'rec-orders',
      desiredDisplayValue: 45,
      fields: { display_value: 45 },
    },
  ]);
});

test('plans explicit null when a stale display value survives a null canonical metric', () => {
  const plan = planReportMetricDisplayValueBackfill({
    records: [{
      recordId: 'rec-null-stale',
      fields: {
        metric_key: 'youtube:period_views',
        current_value: null,
        display_value: 123,
        unit: 'count',
      },
    }],
  });

  assert.equal(plan.pendingUpdateCount, 1);
  assert.equal(plan.updates[0].desiredDisplayValue, null);
  assert.deepEqual(plan.updates[0].fields, { display_value: null });
});

test('requires exact confirmation before record-only execution', () => {
  assert.equal(
    assertReportMetricDisplayValueBackfillConfirmation(
      REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION,
    ),
    true,
  );
  assert.throws(
    () => assertReportMetricDisplayValueBackfillConfirmation('YES'),
    (error) => error?.code === 'REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION_REQUIRED',
  );
});
