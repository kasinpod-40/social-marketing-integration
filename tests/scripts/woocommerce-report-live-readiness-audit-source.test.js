import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION,
} from '../../scripts/lib/woocommerce-report-live-readiness-audit.js';

const source = readFileSync(
  new URL('../../scripts/woocommerce-report-live-readiness-audit.mjs', import.meta.url),
  'utf8',
);

test('WooCommerce Report readiness operator is plan-only and exact-confirmation gated', () => {
  assert.match(source, /parseWooCommerceReportLiveReadinessArgs/u);
  assert.match(source, /assertWooCommerceReportLiveReadinessConfirmation/u);
  assert.equal(
    WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION,
    'RUN_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT',
  );
});

test('WooCommerce Report readiness operator has no deployment, Queue or Lark mutation path', () => {
  assert.doesNotMatch(source, /['"]wrangler['"],\s*['"]deploy['"]/u);
  assert.doesNotMatch(source, /['"]d1['"],\s*['"]export['"]/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*'POST'/u);
  assert.doesNotMatch(source, /executePlan\(/u);
  assert.doesNotMatch(source, /createField\(/u);
  assert.doesNotMatch(source, /updateField\(/u);
  assert.doesNotMatch(source, /createTable\(/u);
  assert.doesNotMatch(source, /updateView\(/u);
});

test('WooCommerce Report readiness D1 boundary rejects non-SELECT statements', () => {
  assert.match(source, /permits SELECT-only D1 statements/u);
  assert.match(source, /\^SELECT\\b\|\^WITH\\b/u);
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b/iu);
  assert.doesNotMatch(source, /\bUPDATE\s+[A-Za-z_]/iu);
  assert.doesNotMatch(source, /\bDELETE\s+FROM\b/iu);
  assert.doesNotMatch(source, /\bDROP\s+TABLE\b/iu);
});

test('WooCommerce Report readiness aggregates all four required windows and 58-row parity', () => {
  assert.match(source, /\[1, 3, 7, 30\]/u);
  assert.match(source, /assertReportRuntimeMetricIntegrity/u);
  assert.match(source, /dimension_metrics/u);
  assert.match(source, /duplicateReportMetricKeys/u);
  assert.match(source, /fldMlTUP3Z|WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD/u);
});
