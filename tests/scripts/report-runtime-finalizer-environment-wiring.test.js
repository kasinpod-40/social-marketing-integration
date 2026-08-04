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
const preservingConfigSource = readFileSync(
  new URL('../../scripts/lib/report-runtime-notification-preserving-config.js', import.meta.url),
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

test('Finalizer retains private Report and Notification authority before publishing summary', () => {
  const writeIndex = finalizerSource.indexOf('writeReportRuntimeFinalizerEnvironment');
  const summaryIndex = finalizerSource.indexOf("currentStage = 'sanitized-evidence'");
  assert.ok(writeIndex >= 0);
  assert.ok(summaryIndex > writeIndex);
  assert.match(finalizerSource, /privateNotificationRuntimeAuthority/u);
  assert.match(finalizerSource, /notificationRuntimeAuthority:\s*privateNotificationRuntimeAuthority/u);
  assert.match(finalizerSource, /notificationRuntimeWorkerBaselinePreserved/u);
  assert.match(finalizerSource, /notificationAdmissionEnabled:\s*false/u);
  assert.match(finalizerSource, /privateEnvironmentContractVersion/u);
  assert.match(finalizerSource, /privateEnvironmentUpdateCount/u);
  assert.match(finalizerSource, /environmentEvidencePath/u);
});

test('Readiness and reviewed execution share the Notification-preserving config bridge', () => {
  assert.match(
    readinessSource,
    /buildNotificationPreservingReportRuntimeConfigWindow\(sourceText,[\s\S]*activeTrueFlags:\s*target\.activeTrueFlags/u,
  );
  assert.match(
    reviewedCloseoutSource,
    /buildNotificationPreservingReportRuntimeConfigWindow\(sourceText,[\s\S]*activeTrueFlags:\s*target\.activeTrueFlags/u,
  );
  assert.match(preservingConfigSource, /loadReportRuntimeFinalizerEnvironment/u);
  assert.match(preservingConfigSource, /REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS/u);
  assert.match(preservingConfigSource, /MKT_NOTIFICATION_RUNTIME_MODE/u);
  assert.match(closeoutSource, /loadReportRuntimeFinalizerEnvironment/u);
});

test('Report execution restores the preserved Worker baseline rather than forcing all-false', () => {
  assert.match(reviewedCloseoutSource, /remote-baseline-preflight-and-backup/u);
  assert.match(reviewedCloseoutSource, /restore-preserved-worker-baseline/u);
  assert.match(reviewedCloseoutSource, /restoredBaseline:\s*true/u);
  assert.match(reviewedCloseoutSource, /notificationAdmissionEnabled:\s*false/u);
  assert.doesNotMatch(reviewedCloseoutSource, /restore-all-false/u);
});

test('Base config bridge still synthesizes only the reviewed WooCommerce report flag', () => {
  assert.match(
    closeoutSource,
    /GENERATED_FALSE_FLAG_NAMES[\s\S]*MKT_WOOCOMMERCE_REPORT_READ_ENABLED/u,
  );
  assert.doesNotMatch(
    closeoutSource,
    /GENERATED_FALSE_FLAG_NAMES[\s\S]*MKT_REPORT_D1_READ_ENABLED[\s\S]*\]/u,
  );
});
