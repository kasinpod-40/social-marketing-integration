import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReportLarkCurrentSlotRetentionConfirmation,
  planReportLarkCurrentSlotRetention,
  REPORT_LARK_CURRENT_SLOT_RETENTION_CONFIRMATION,
} from '../../scripts/lib/report-lark-current-slot-retention.js';

const JUL31 = Date.parse('2026-07-31T00:00:00+07:00');
const AUG09 = Date.parse('2026-08-09T00:00:00+07:00');
const GENERATED_OLD = Date.parse('2026-08-01T08:10:00+07:00');
const GENERATED_NEW = Date.parse('2026-08-10T08:10:00+07:00');

test('keeps only latest rolling metric record for the same Lark slot', () => {
  const plan = planReportLarkCurrentSlotRetention({
    role: 'metrics',
    records: [
      metricRecord({
        recordId: 'rec-old',
        reportId: 'report-old',
        reportMetricKey: 'report-old::tiktok%3Alatest_total_views::summary::all',
        periodEnd: JUL31,
        generatedAt: GENERATED_OLD,
      }),
      metricRecord({
        recordId: 'rec-new',
        reportId: 'report-new',
        reportMetricKey: 'report-new::tiktok%3Alatest_total_views::summary::all',
        periodEnd: AUG09,
        generatedAt: GENERATED_NEW,
      }),
    ],
  });

  assert.equal(plan.recordCount, 2);
  assert.equal(plan.retainedCount, 1);
  assert.equal(plan.staleDeleteCount, 1);
  assert.equal(plan.deletes[0].recordId, 'rec-old');
  assert.equal(plan.retained[0].recordId, 'rec-new');
  assert.equal(plan.slotKeyUpdateCount, 1);
});

test('same rolling slot is converged after retained row already carries lark_slot_key', () => {
  const first = planReportLarkCurrentSlotRetention({
    role: 'metrics',
    records: [metricRecord({
      recordId: 'rec-new',
      reportId: 'report-new',
      reportMetricKey: 'report-new::tiktok%3Alatest_total_views::summary::all',
      periodEnd: AUG09,
      generatedAt: GENERATED_NEW,
    })],
  });
  const slotKey = first.retained[0].slotKey;
  const final = planReportLarkCurrentSlotRetention({
    role: 'metrics',
    records: [metricRecord({
      recordId: 'rec-new',
      reportId: 'report-new',
      reportMetricKey: 'report-new::tiktok%3Alatest_total_views::summary::all',
      periodEnd: AUG09,
      generatedAt: GENERATED_NEW,
      larkSlotKey: slotKey,
    })],
  });
  assert.equal(final.staleDeleteCount, 0);
  assert.equal(final.slotKeyUpdateCount, 0);
  assert.equal(final.retainedCount, 1);
});

test('custom ranges remain separate materialized slots', () => {
  const plan = planReportLarkCurrentSlotRetention({
    role: 'snapshots',
    records: [
      snapshotRecord({ recordId: 'custom-1', reportId: 'custom-report-1', periodEnd: JUL31 }),
      snapshotRecord({ recordId: 'custom-2', reportId: 'custom-report-2', periodEnd: AUG09 }),
    ],
  });
  assert.equal(plan.recordCount, 2);
  assert.equal(plan.retainedCount, 2);
  assert.equal(plan.staleDeleteCount, 0);
  assert.equal(plan.customSlotCount, 2);
});

test('retention execution requires exact confirmation token', () => {
  assert.throws(() => assertReportLarkCurrentSlotRetentionConfirmation('wrong'));
  assert.doesNotThrow(() => assertReportLarkCurrentSlotRetentionConfirmation(
    REPORT_LARK_CURRENT_SLOT_RETENTION_CONFIRMATION,
  ));
});

function metricRecord(input) {
  return {
    recordId: input.recordId,
    fields: {
      report_metric_key: input.reportMetricKey,
      report_id: input.reportId,
      customer_profile: 'integration_workspace',
      customer_key: 'chemistry_k',
      capability: 'organic',
      platform: 'tiktok',
      account_id: 'chemistry_k',
      report_type: 'dashboard_performance_report',
      period_kind: 'rolling_days',
      window_days: 7,
      period_end: input.periodEnd,
      generated_at: input.generatedAt,
      ...(input.larkSlotKey ? { lark_slot_key: input.larkSlotKey } : {}),
    },
  };
}

function snapshotRecord(input) {
  return {
    recordId: input.recordId,
    fields: {
      report_id: input.reportId,
      customer_profile: 'integration_workspace',
      customer_key: 'chemistry_k',
      capability: 'organic',
      platform: ['tiktok'],
      account_id: 'chemistry_k',
      report_type: 'dashboard_performance_report',
      period_kind: 'custom_range',
      window_days: null,
      period_end: input.periodEnd,
      generated_at: GENERATED_NEW,
    },
  };
}
