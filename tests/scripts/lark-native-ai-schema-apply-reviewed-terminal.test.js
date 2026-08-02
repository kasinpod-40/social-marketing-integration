import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  assertLarkNativeAiSchemaApplyConfirmation,
  assertLarkNativeAiSchemaApplyRemoteCounters,
  assertLarkNativeAiSchemaApplyRepository,
  createLarkNativeAiSchemaApplyFetchGuard,
  parseLarkNativeAiSchemaApplyArgs,
} from '../../scripts/lib/lark-native-ai-schema-apply.js';

const scriptUrl = new URL(
  '../../scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs',
  import.meta.url,
);
const source = readFileSync(scriptUrl, 'utf8');

test('reviewed schema Apply terminal is plan-only by default', () => {
  const output = execFileSync(process.execPath, [scriptUrl.pathname], {
    encoding: 'utf8',
  });
  const plan = JSON.parse(output);
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.acceptedLogicalActions.total, 31);
  assert.equal(plan.maximumRemoteWriteRequests, 36);
  assert.equal(plan.applyExecuted, false);
  assert.equal(plan.recordReadCount, 0);
  assert.equal(plan.production, 'BLOCKED');
});

test('schema Apply requires exact confirmation and reviewed clean main', () => {
  assert.deepEqual(parseLarkNativeAiSchemaApplyArgs([]), { execute: false });
  assert.deepEqual(parseLarkNativeAiSchemaApplyArgs(['--execute']), { execute: true });
  assert.throws(() => parseLarkNativeAiSchemaApplyArgs(['--apply']));
  assert.throws(() => assertLarkNativeAiSchemaApplyConfirmation({}));
  assert.equal(assertLarkNativeAiSchemaApplyConfirmation({
    CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY:
      LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  }), true);

  const head = 'a'.repeat(40);
  assert.deepEqual(assertLarkNativeAiSchemaApplyRepository({
    branch: 'main',
    head,
    reviewedHead: head,
    clean: true,
  }), {
    branch: 'main',
    head,
    reviewedHead: head,
    clean: true,
  });
  assert.throws(() => assertLarkNativeAiSchemaApplyRepository({
    branch: 'feature',
    head,
    reviewedHead: head,
    clean: true,
  }));
});

test('network guard permits only exact additive metadata and schema requests', async () => {
  const observed = [];
  const guard = createLarkNativeAiSchemaApplyFetchGuard(async (input, init) => {
    observed.push({ input: String(input), method: init?.method ?? 'GET' });
    return { ok: true };
  });
  const base = 'https://open.larksuite.com/open-apis/bitable/v1/apps/app/tables/tbl';

  await guard.fetchImpl(
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    { method: 'POST' },
  );
  await guard.fetchImpl(
    'https://open.larksuite.com/open-apis/bitable/v1/apps/app/tables?page_size=500',
    { method: 'GET' },
  );
  await guard.fetchImpl(`${base}/fields`, { method: 'GET' });
  await guard.fetchImpl(`${base}/views/vew`, { method: 'GET' });
  await guard.fetchImpl(`${base}/fields`, { method: 'POST' });
  await guard.fetchImpl(`${base}/fields/fld`, { method: 'PUT' });
  await guard.fetchImpl(`${base}/views`, { method: 'POST' });
  await guard.fetchImpl(`${base}/views/vew`, { method: 'PATCH' });

  await assert.rejects(
    guard.fetchImpl(`${base}/records/search`, { method: 'POST' }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED',
  );
  await assert.rejects(
    guard.fetchImpl(`${base}/fields/fld`, { method: 'DELETE' }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED',
  );

  const counters = guard.snapshot();
  assert.equal(counters.tokenRequestCount, 1);
  assert.equal(counters.metadataReadCount, 3);
  assert.equal(counters.fieldCreateCount, 1);
  assert.equal(counters.fieldUpdateCount, 1);
  assert.equal(counters.viewCreateCount, 1);
  assert.equal(counters.viewUpdateCount, 1);
  assert.equal(counters.totalWriteCount, 4);
  assert.equal(counters.blockedRequestCount, 2);
  assert.throws(() => assertLarkNativeAiSchemaApplyRemoteCounters(counters));
  assert.equal(observed.length, 8);
});

test('source contains no table mutation, delete, record, Automation, notification or AI path', () => {
  assert.doesNotMatch(source, /\.createTable\(|\.renameTable\(|\.deleteField\(|\.deleteView\(/u);
  assert.doesNotMatch(source, /records\/search|batch_create|batch_update|batch_delete/u);
  assert.doesNotMatch(source, /\.createAutomation\(|\.sendNotification\(|\.generateAi\(/u);
  assert.match(source, /applyLarkNativeAiSchemaAdditive/u);
  assert.match(source, /assertRetainedHeadIsAncestor/u);
  assert.match(source, /zero_drift/u);
});
