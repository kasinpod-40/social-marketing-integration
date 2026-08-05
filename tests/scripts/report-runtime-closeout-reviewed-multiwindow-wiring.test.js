import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const OPERATOR = new URL('../../scripts/report-runtime-closeout-operator.mjs', import.meta.url);
const TERMINAL = new URL('../../scripts/multichannel-report-live-closure-terminal.mjs', import.meta.url);
const EXECUTOR = new URL('../../scripts/report-runtime-closeout-reviewed-multiwindow.mjs', import.meta.url);

test('canonical shared operator preserves legacy TikTok and WooCommerce source contracts', async () => {
  const source = await readFile(OPERATOR, 'utf8');
  assert.match(source, /executeNormalCloseout/u);
  assert.match(source, /assertWooCommerceReportRuntimeCloseoutPreflight/u);
  assert.match(source, /mktSyncLog:\s*'sync_id'/u);
  assert.match(source, /pollReportRuntimeLarkIntegrity/u);
  assert.doesNotMatch(source, /report-runtime-closeout-legacy\.mjs/u);
  assert.doesNotMatch(source, /platformScope === 'youtube'/u);
});

test('multichannel terminal delegates only to the reviewed multiwindow entrypoint', async () => {
  const source = await readFile(TERMINAL, 'utf8');
  assert.match(source, /REPORT_RUNTIME_REVIEWED_CHANNELS/u);
  assert.match(source, /report-runtime-closeout-reviewed-multiwindow\.mjs/u);
  assert.doesNotMatch(source, /execFileAsync\(process\.execPath, \[\s*'scripts\/report-runtime-closeout-operator\.mjs'/u);
});

test('reviewed executor binds generic preflight, multiwindow replay and preserved baseline restore', async () => {
  const source = await readFile(EXECUTOR, 'utf8');
  assert.match(source, /REPORT_RUNTIME_REVIEWED_CHANNELS/u);
  assert.match(source, /loadReviewedReportRuntimeCloseoutHandoff/u);
  assert.match(source, /buildReportRuntimePreflightSql/u);
  assert.match(source, /assertReviewedReportRuntimeCloseoutPreflight/u);
  assert.match(source, /buildReviewedReportRuntimeMultiwindowPlan/u);
  assert.match(source, /buildNotificationPreservingReportRuntimeConfigWindow/u);
  assert.match(source, /for \(const prestate of prestates\)/u);
  assert.match(source, /send-replay/u);
  assert.match(source, /finally \{/u);
  assert.match(source, /restore-preserved-worker-baseline/u);
  assert.match(source, /restoredBaseline:\s*true/u);
  assert.match(source, /notificationAdmissionEnabled:\s*false/u);
  assert.doesNotMatch(source, /restore-all-false/u);
  assert.match(source, /sanitizeReportLiveClosureEvidence/u);
  assert.doesNotMatch(source, /accepts YouTube Organic only/u);
  assert.doesNotMatch(source, /youtube\.googleapis\.com|YouTube Data API/u);
});

test('reviewed reuse windows return verified evidence before any Queue resend', async () => {
  const source = await readFile(EXECUTOR, 'utf8');
  const verifyStart = source.indexOf("if (selected.operation === 'verify')");
  const replayStart = source.indexOf('d-send-replay');
  assert.ok(verifyStart >= 0, 'verify branch is required');
  assert.ok(replayStart > verifyStart, 'replay path must remain after the verify branch');

  const verifyBranch = source.slice(verifyStart, replayStart);
  assert.match(verifyBranch, /return Object\.freeze/u);
  assert.match(verifyBranch, /executionMode:\s*'reuse_verified_materialization'/u);
  assert.match(verifyBranch, /reusedExisting:\s*true/u);
  assert.match(verifyBranch, /replayExecuted:\s*false/u);
  assert.match(verifyBranch, /sameInput:\s*null/u);
  assert.match(verifyBranch, /queueMessagesSent:\s*0/u);
  assert.doesNotMatch(verifyBranch, /sendReviewedQueueMessage/u);

  const replayBranch = source.slice(replayStart);
  assert.match(replayBranch, /executionMode:\s*'materialize_and_replay'/u);
  assert.match(replayBranch, /replayExecuted:\s*true/u);
  assert.match(replayBranch, /sameInput:\s*true/u);
});
