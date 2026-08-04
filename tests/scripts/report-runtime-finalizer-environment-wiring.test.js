import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const finalizerSource = readFileSync(
  new URL('../../scripts/report-runtime-finalize-operator.mjs', import.meta.url),
  'utf8',
);
const closeoutSource = readFileSync(
  new URL('../../scripts/lib/report-runtime-closeout-operator.js', import.meta.url),
  'utf8',
);
const readinessSource = readFileSync(
  new URL('../../scripts/report-channel-remote-readiness-reviewed-terminal.mjs', import.meta.url),
  'utf8',
);
const reviewedCloseoutSource = readFileSync(
  new URL('../../scripts/report-runtime-closeout-reviewed-multiwindow.mjs', import.meta.url),
  'utf8',
);

test('Finalizer retains the exact private table environment before publishing summary evidence', () => {
  const writeIndex = finalizerSource.indexOf('writeReportRuntimeFinalizerEnvironment');
  const summaryIndex = finalizerSource.indexOf("currentStage = 'sanitized-evidence'");
  assert.ok(writeIndex >= 0);
  assert.ok(summaryIndex > writeIndex);
  assert.match(finalizerSource, /privateEnvironmentContractVersion/u);
  assert.match(finalizerSource, /privateEnvironmentUpdateCount/u);
  assert.match(finalizerSource, /environmentEvidencePath/u);
});

test('Readiness and reviewed execution share the same closeout config bridge', () => {
  assert.match(
    readinessSource,
    /buildReportRuntimeCloseoutConfigWindow\(sourceText,\s*\{[\s\S]*activeTrueFlags:\s*target\.activeTrueFlags/u,
  );
  assert.match(
    reviewedCloseoutSource,
    /buildReportRuntimeCloseoutConfigWindow\(sourceText,\s*\{[\s\S]*activeTrueFlags:\s*target\.activeTrueFlags/u,
  );
  assert.match(closeoutSource, /loadReportRuntimeFinalizerEnvironment/u);
  assert.match(closeoutSource, /MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE/u);
});

test('Config bridge synthesizes only the reviewed WooCommerce report flag', () => {
  assert.match(
    closeoutSource,
    /GENERATED_FALSE_FLAG_NAMES[\s\S]*MKT_WOOCOMMERCE_REPORT_READ_ENABLED/u,
  );
  assert.doesNotMatch(
    closeoutSource,
    /GENERATED_FALSE_FLAG_NAMES[\s\S]*MKT_REPORT_D1_READ_ENABLED[\s\S]*\]/u,
  );
});
