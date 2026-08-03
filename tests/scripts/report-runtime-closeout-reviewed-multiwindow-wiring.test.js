import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROUTER = new URL('../../scripts/report-runtime-closeout-operator.mjs', import.meta.url);
const LEGACY = new URL('../../scripts/report-runtime-closeout-legacy.mjs', import.meta.url);
const EXECUTOR = new URL('../../scripts/report-runtime-closeout-reviewed-multiwindow.mjs', import.meta.url);

test('shared operator router preserves legacy TikTok/Woo path and routes YouTube only', async () => {
  const [router, legacy] = await Promise.all([readFile(ROUTER, 'utf8'), readFile(LEGACY, 'utf8')]);
  assert.match(router, /platformScope === 'youtube'/u);
  assert.match(router, /report-runtime-closeout-reviewed-multiwindow\.mjs/u);
  assert.match(router, /report-runtime-closeout-legacy\.mjs/u);
  assert.match(legacy, /executeNormalCloseout/u);
  assert.match(legacy, /assertWooCommerceReportRuntimeCloseoutPreflight/u);
});

test('reviewed executor binds handoff, preflight, multiwindow replay and finally restore', async () => {
  const source = await readFile(EXECUTOR, 'utf8');
  assert.match(source, /loadReviewedReportRuntimeCloseoutHandoff/u);
  assert.match(source, /buildReportRuntimeOrganicPreflightSql/u);
  assert.match(source, /buildReviewedReportRuntimeMultiwindowPlan/u);
  assert.match(source, /for \(const prestate of prestates\)/u);
  assert.match(source, /send-replay/u);
  assert.match(source, /finally \{/u);
  assert.match(source, /restore-all-false/u);
  assert.match(source, /sanitizeReportLiveClosureEvidence/u);
  assert.doesNotMatch(source, /youtube\.googleapis\.com|YouTube Data API/u);
});
