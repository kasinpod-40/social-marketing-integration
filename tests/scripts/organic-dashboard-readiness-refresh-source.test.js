import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrapper = readFileSync(
  new URL('../../scripts/organic-dashboard-readiness-refresh.mjs', import.meta.url),
  'utf8',
);
const verifier = readFileSync(
  new URL('../../scripts/verify-organic-dashboard-readiness-window.mjs', import.meta.url),
  'utf8',
);

test('one command finalizes once, refreshes each window through stabilized closeout, verifies read-only, then aggregates', () => {
  const confirmation = wrapper.indexOf('assertOrganicDashboardReadinessRefreshConfirmation');
  const finalizer = wrapper.indexOf("runRequired('report-runtime-finalizer'");
  const loop = wrapper.indexOf('for (const windowDays of ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS)');
  const closeout = wrapper.indexOf("['scripts/report-runtime-stabilized-closeout.mjs', '--execute']", loop);
  const verification = wrapper.indexOf("['scripts/verify-organic-dashboard-readiness-window.mjs']", closeout);
  const aggregate = wrapper.indexOf("currentStage = 'aggregate-readiness-refresh'", verification);
  assert.ok(confirmation >= 0 && finalizer > confirmation && loop > finalizer);
  assert.ok(closeout > loop && verification > closeout && aggregate > verification);
  assert.match(wrapper, /MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION:\s*'refresh'/u);
  assert.match(wrapper, /MKT_REPORT_RUNTIME_REFRESH_AUTHORIZATION/u);
  assert.match(wrapper, /restoredAllFalseAfterEveryWindow/u);
});

test('wrapper never contains a direct Worker, Queue, D1 or Lark mutation path', () => {
  assert.doesNotMatch(wrapper, /wrangler[^\n]+deploy/iu);
  assert.doesNotMatch(wrapper, /queues\/.+messages|sendQueueMessage/iu);
  assert.doesNotMatch(wrapper, /d1[^\n]+execute/iu);
  assert.doesNotMatch(wrapper, /createLark|batchUpdateRecords|updateRecords/iu);
  assert.doesNotMatch(wrapper, /DELETE\s+FROM|UPDATE\s+report_materializations/iu);
});

test('post-closeout verifier performs fresh read-only D1 and Lark reads only', () => {
  const d1Read = verifier.indexOf("'wrangler', 'd1', 'execute'");
  const schemaResolution = verifier.indexOf('planLarkReportSchema');
  const larkRead = verifier.indexOf('client.searchRecords');
  const parity = verifier.indexOf('assertOrganicDashboardReadinessWindow');
  assert.ok(d1Read >= 0 && schemaResolution >= 0 && larkRead >= 0 && parity >= 0);
  assert.match(verifier, /LARK_REPORT_SCHEMA_V2/u);
  assert.match(verifier, /environmentUpdates\?\.\[REPORT_METRIC_VALUES_ENV_NAME\]/u);
  assert.match(verifier, /SELECT report_id, payload_json, payload_checksum FROM report_materializations/u);
  assert.doesNotMatch(verifier, /DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+/iu);
  assert.doesNotMatch(verifier, /wrangler[^\n]+deploy|queues\/.+messages/iu);
  assert.doesNotMatch(verifier, /batchUpdateRecords|updateRecords|createRecords/iu);
  assert.match(verifier, /remoteMutationDuringVerification:\s*false/u);
});

test('closeout-only partial evidence resumes verification without resending while unsafe partials still fail closed', () => {
  const recovery = wrapper.indexOf('if (closeoutExists && !verificationExists)');
  const recoveryVerification = wrapper.indexOf(
    "['scripts/verify-organic-dashboard-readiness-window.mjs']",
    recovery,
  );
  const normalCloseout = wrapper.indexOf(
    "['scripts/report-runtime-stabilized-closeout.mjs', '--execute']",
    recovery,
  );
  assert.ok(recovery >= 0 && recoveryVerification > recovery && normalCloseout > recoveryVerification);
  assert.match(wrapper, /assertOrganicDashboardReadinessCloseoutSummary\(recordedCloseout, windowDays\)/u);
  assert.match(wrapper, /verificationOnlyRecoveryCount \+= 1/u);
  assert.match(wrapper, /if \(!closeoutExists && verificationExists\)[\s\S]+ORGANIC_DASHBOARD_READINESS_PARTIAL_EVIDENCE/u);
  assert.match(wrapper, /files\.length !== 0[\s\S]+ORGANIC_DASHBOARD_READINESS_RECORDED_ATTEMPT/u);
});
