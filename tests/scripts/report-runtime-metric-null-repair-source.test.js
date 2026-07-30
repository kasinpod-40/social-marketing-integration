import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrapper = readFileSync(
  new URL('../../scripts/report-runtime-window-repair-recover.mjs', import.meta.url),
  'utf8',
);
const repairOperator = readFileSync(
  new URL('../../scripts/report-runtime-lark-metric-null-repair.mjs', import.meta.url),
  'utf8',
);
const configDlqOperator = readFileSync(
  new URL('../../scripts/report-runtime-config-dlq-recovery.mjs', import.meta.url),
  'utf8',
);
const writer = readFileSync(
  new URL('../../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js', import.meta.url),
  'utf8',
);

test('current recovery reuses the completed metric repair summary before exact config-DLQ replay recovery', () => {
  const finalizer = wrapper.indexOf("runRequired('report-runtime-finalizer'");
  const recovery = wrapper.indexOf("runRequired('3d-exact-config-dlq-recovery'");
  const remaining = wrapper.indexOf("runRequired('remaining-window-sequence'");
  assert.ok(finalizer >= 0 && recovery > finalizer && remaining > recovery);
  assert.match(configDlqOperator, /metric-null-repair-summary\.json/u);
  assert.match(configDlqOperator, /assertReportRuntimeConfigDlqMetricRepairSummary/u);
  assert.doesNotMatch(wrapper, /report-runtime-lark-metric-null-repair\.mjs/u);
  assert.doesNotMatch(wrapper, /EXECUTE_EXACT_REPORT_METRIC_NULL_REPAIR/u);
});

test('exact stale-null repair remains backup-first and records attempt before the only Lark write', () => {
  const remoteSafe = repairOperator.indexOf('await verifyRemoteSafe');
  const plan = repairOperator.indexOf("currentStage = 'plan-exact-stale-null-repair'");
  const backup = repairOperator.indexOf("currentStage = 'backup-exact-lark-metric-rows'");
  const attempt = repairOperator.indexOf('await writePrivateJson(ATTEMPT_PATH');
  const write = repairOperator.indexOf('await client.batchUpdateRecords');
  const readback = repairOperator.indexOf("currentStage = 'bounded-post-write-readback'");
  assert.ok(remoteSafe >= 0 && plan > remoteSafe && backup > plan && attempt > backup && write > attempt && readback > write);
  assert.doesNotMatch(repairOperator, /sendQueueMessage|\/queues\/.*\/messages/iu);
  assert.doesNotMatch(repairOperator, /['"]wrangler['"],\s*['"]deploy['"]/iu);
  assert.match(repairOperator, /workerDeploymentAttempted:\s*false/u);
  assert.match(repairOperator, /queueMessageSent:\s*false/u);
  assert.match(repairOperator, /remoteD1Mutated:\s*false/u);
});

test('dashboard writer applies explicit null behavior only to Report metric rows', () => {
  assert.match(writer, /createExplicitNullUpdateRepository/u);
  assert.match(writer, /REPORT_METRIC_NULLABLE_FIELDS/u);
  assert.match(writer, /repository:\s*metricRepository,[\s\S]*tableId:\s*tables\.mktReportMetricValues/u);
  assert.match(writer, /name:\s*'reportSnapshot',\s*repository,/u);
  assert.match(writer, /name:\s*'reportTopContent',[\s\S]*repository,/u);
});
