import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION,
  classifyMetaPaidLarkDrainStep,
} from '../../scripts/lib/meta-paid-lark-drain-closeout.js';

const active = Object.freeze({
  activeWork: 3,
  activeQueueOperations: 3,
  activeLocks: 1,
});
const idle = Object.freeze({
  activeWork: 0,
  activeQueueOperations: 0,
  activeLocks: 0,
});
const initialWorkKeys = Object.freeze([
  'chatwoot:chemistry_k:chatwoot-daily-20260822',
  'meta_ads:chemistry_k2:meta-ads-chemistry_k2-scheduled-20260822',
  'facebook:facebook-scheduled-20260822',
]);

test('moving existing work remains read-only drain', () => {
  const result = classifyMetaPaidLarkDrainStep({
    initialWorkKeys,
    previous: active,
    current: { ...active, activeLocks: 0 },
    currentWorkKeys: initialWorkKeys,
    staleReviewRequired: false,
  });
  assert.equal(META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION, 'meta_paid_lark_drain_closeout_v1');
  assert.equal(result.action, 'continue_read_only_drain');
});

test('one idle sample is insufficient to launch closeout', () => {
  const result = classifyMetaPaidLarkDrainStep({
    initialWorkKeys,
    previous: active,
    current: idle,
    currentWorkKeys: [],
    staleReviewRequired: false,
  });
  assert.equal(result.action, 'continue_read_only_drain');
  assert.equal(result.idle, true);
  assert.equal(result.previousIdle, false);
});

test('two consecutive idle samples launch only the existing guarded closeout', () => {
  const result = classifyMetaPaidLarkDrainStep({
    initialWorkKeys,
    previous: idle,
    current: idle,
    currentWorkKeys: [],
    staleReviewRequired: false,
  });
  assert.equal(result.action, 'launch_existing_closeout');
});

test('new work appearing during drain fails closed', () => {
  const newKey = 'meta_ads:chemistry_k3:meta-ads-chemistry_k3-scheduled-20260823';
  const result = classifyMetaPaidLarkDrainStep({
    initialWorkKeys,
    previous: active,
    current: active,
    currentWorkKeys: [...initialWorkKeys, newKey],
    staleReviewRequired: false,
  });
  assert.equal(result.action, 'stop_new_work_appeared');
  assert.deepEqual(result.appearedWorkKeys, [newKey]);
});

test('stable stale blocker requires exact recovery review and never automatic cleanup', () => {
  const result = classifyMetaPaidLarkDrainStep({
    initialWorkKeys,
    previous: active,
    current: active,
    currentWorkKeys: initialWorkKeys,
    staleReviewRequired: true,
  });
  assert.equal(result.action, 'stop_exact_recovery_review_required');
});

test('drain launcher contains no direct Worker deploy, Queue send or D1 mutation path before delegation', async () => {
  const source = await readFile('scripts/meta-paid-lark-drain-closeout.mjs', 'utf8');
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /\.send\s*\(/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.match(source, /meta-paid-lark-closeout-safe-entry\.mjs/u);
  assert.match(source, /CONFIRM_META_PAID_LARK_CLOSEOUT/u);
});
