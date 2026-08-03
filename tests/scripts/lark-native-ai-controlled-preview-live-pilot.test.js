import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION,
} from '../../packages/config/src/lark-native-ai-controlled-preview-live-pilot-contract.js';
import {
  assertLarkNativeAiControlledPreviewLivePilotConfirmation,
  assertLarkNativeAiControlledPreviewLivePilotRemoteCounters,
  assertLarkNativeAiControlledPreviewLivePilotRepository,
  createLarkNativeAiControlledPreviewLivePilotFetchGuard,
  parseLarkNativeAiControlledPreviewLivePilotArgs,
} from '../../scripts/lib/lark-native-ai-controlled-preview-live-pilot.js';

const HEAD = 'a'.repeat(40);
const BASE = 'https://open.larksuite.com';

test('terminal defaults to plan-only and exposes no execution without confirmation', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/lark-native-ai-controlled-preview-live-pilot.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.planOnly, true);
  assert.equal(output.executed, false);
  assert.equal(output.maximumRecordWrites, 40);
  assert.equal(output.aiCallCount, 0);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.production, 'BLOCKED');
});

test('argument, confirmation and exact-main repository gates fail closed', () => {
  assert.deepEqual(parseLarkNativeAiControlledPreviewLivePilotArgs([]), { execute: false });
  assert.deepEqual(parseLarkNativeAiControlledPreviewLivePilotArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseLarkNativeAiControlledPreviewLivePilotArgs(['--apply']),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_ARGUMENT_UNSUPPORTED',
  );
  assert.throws(
    () => assertLarkNativeAiControlledPreviewLivePilotConfirmation({}),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNativeAiControlledPreviewLivePilotConfirmation({
    CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION,
  }), true);
  assert.deepEqual(assertLarkNativeAiControlledPreviewLivePilotRepository({
    branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD,
  }), { branch: 'main', clean: true, exactHeadSha: HEAD });
  assert.throws(
    () => assertLarkNativeAiControlledPreviewLivePilotRepository({
      branch: 'feature', clean: true, head: HEAD, reviewedHead: HEAD,
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_MAIN_REQUIRED',
  );
});

test('Remote guard permits bounded Preview Record inventory reads and writes', async () => {
  let underlyingCalls = 0;
  const guard = createLarkNativeAiControlledPreviewLivePilotFetchGuard(async () => {
    underlyingCalls += 1;
    return new Response(JSON.stringify({ code: 0, data: { records: [], items: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const app = 'app-token';
  const table = 'table-id';
  await guard.fetchImpl(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, { method: 'POST' });
  await guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/${app}/tables`, { method: 'GET' });
  await guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/${app}/tables/${table}/records?page_size=500`, {
    method: 'GET',
  });
  await guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/${app}/tables/${table}/records/batch_create`, {
    method: 'POST', body: JSON.stringify({ records: Array.from({ length: 20 }, () => ({ fields: {} })) }),
  });
  await guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/${app}/tables/${table}/records/batch_update`, {
    method: 'POST', body: JSON.stringify({ records: Array.from({ length: 20 }, () => ({ record_id: 'x', fields: {} })) }),
  });
  const counters = guard.snapshot();
  assert.equal(underlyingCalls, 5);
  assert.equal(counters.recordSearchRequestCount, 1);
  assert.equal(counters.totalBatchWriteRequests, 2);
  assert.equal(counters.totalRecordWrites, 40);
  assert.equal(counters.blockedRequestCount, 0);
  assert.equal(assertLarkNativeAiControlledPreviewLivePilotRemoteCounters(counters), true);
});

test('Remote guard blocks schema, delete and writes above forty before fetch', async () => {
  let underlyingCalls = 0;
  const guard = createLarkNativeAiControlledPreviewLivePilotFetchGuard(async () => {
    underlyingCalls += 1;
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  });
  await assert.rejects(
    () => guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/app/tables/tbl/fields`, {
      method: 'POST', body: JSON.stringify({ field_name: 'forbidden' }),
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REQUEST_BLOCKED',
  );
  await assert.rejects(
    () => guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/app/tables/tbl/records/batch_delete`, {
      method: 'POST', body: JSON.stringify({ records: ['rec1'] }),
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REQUEST_BLOCKED',
  );
  await assert.rejects(
    () => guard.fetchImpl(`${BASE}/open-apis/bitable/v1/apps/app/tables/tbl/records/batch_create`, {
      method: 'POST', body: JSON.stringify({ records: Array.from({ length: 41 }, () => ({ fields: {} })) }),
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REMOTE_LIMIT_EXCEEDED',
  );
  assert.equal(underlyingCalls, 0);
  assert.equal(guard.snapshot().blockedRequestCount, 3);
});
