import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const SOURCE = new URL(
  '../../scripts/meta-history-2026-exact-plan-continuation.mjs',
  import.meta.url,
);

test('exact-plan continuation is the public guarded boundary and does not replay Facebook Provider or D1 Queue', async () => {
  const source = await readFile(SOURCE, 'utf8');

  assert.match(source, /validateStableMetaHistoryFacebookBoundary/u);
  assert.match(source, /validateMetaD1OnlySummaryForLark/u);
  assert.match(source, /continue-facebook-lark-same-operation/u);
  assert.match(source, /meta-lark-parity-rollout-launcher\.mjs/u);
  assert.match(source, /meta-history-2026-one-command\.mjs/u);
  assert.match(source, /providerReplayForFacebook:\s*false/u);
  assert.match(source, /d1QueueResendForFacebook:\s*false/u);
  assert.match(source, /automaticAllFalseRestore:\s*true/u);
  assert.match(source, /META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE/u);

  assert.doesNotMatch(source, /meta-read-only-validation-operator\.mjs/u);
  assert.doesNotMatch(source, /meta-d1-only-rollout-launcher\.mjs/u);
  assert.doesNotMatch(source, /send-one-d1-only/u);
});

test('exact-plan continuation completes Facebook Lark before resuming the retained plan', async () => {
  const source = await readFile(SOURCE, 'utf8');
  const lark = source.indexOf("stage = 'continue-facebook-lark-same-operation'");
  const resume = source.indexOf("stage = 'resume-retained-meta-plan'");
  const final = source.indexOf("stage = 'verify-final-safe-summary'");

  assert.ok(lark >= 0);
  assert.ok(resume > lark);
  assert.ok(final > resume);
  assert.match(source, /Queue acceptance is uncertain; blind resend is blocked/u);
  assert.match(source, /restore-all-false/u);
  assert.match(source, /verify-restore/u);
});
