import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  assertLarkNativeAiRemoteInventoryConfirmation,
  assertLarkNativeAiReviewedRepository,
  createLarkNativeAiReadOnlyFetchGuard,
  LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION,
  parseLarkNativeAiRemoteInventoryArgs,
} from '../../scripts/lib/lark-native-ai-remote-inventory.js';

const SCRIPT_PATH = 'scripts/lark-native-ai-remote-inventory-reviewed-terminal.mjs';
const HEAD = 'a'.repeat(40);

test('plan mode is local-only and reports the exact read-only boundary', () => {
  const child = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout);
  assert.equal(output.planOnly, true);
  assert.equal(output.repositoryGate.branch, 'main');
  assert.equal(output.persistedRemoteIds, 0);
  assert.equal(output.recordReadCount, 0);
  assert.equal(output.remoteLarkWriteCount, 0);
  assert.equal(output.applyAuthorized, false);
  assert.deepEqual(output.allowedRemoteRequests, [
    'POST tenant_access_token authentication',
    'GET Base table metadata',
    'GET target table field metadata',
    'GET target table view metadata',
  ]);
});

test('argument parser rejects any Apply path', () => {
  assert.deepEqual(parseLarkNativeAiRemoteInventoryArgs([]), { execute: false });
  assert.deepEqual(parseLarkNativeAiRemoteInventoryArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseLarkNativeAiRemoteInventoryArgs(['--apply']),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_NOT_AUTHORIZED',
  );
});

test('confirmation and reviewed repository gates fail closed', () => {
  assert.throws(
    () => assertLarkNativeAiRemoteInventoryConfirmation({}),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION_REQUIRED',
  );
  assert.doesNotThrow(() => assertLarkNativeAiRemoteInventoryConfirmation({
    CONFIRM_LARK_NATIVE_AI_REMOTE_INVENTORY: LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION,
  }));

  assert.deepEqual(assertLarkNativeAiReviewedRepository({
    branch: 'main',
    clean: true,
    head: HEAD,
    reviewedHead: HEAD,
  }), {
    branch: 'main',
    clean: true,
    head: HEAD,
    reviewedHead: HEAD,
  });
  assert.throws(
    () => assertLarkNativeAiReviewedRepository({
      branch: 'feature', clean: true, head: HEAD, reviewedHead: HEAD,
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_REPOSITORY_BRANCH_INVALID',
  );
  assert.throws(
    () => assertLarkNativeAiReviewedRepository({
      branch: 'main', clean: false, head: HEAD, reviewedHead: HEAD,
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_REPOSITORY_DIRTY',
  );
  assert.throws(
    () => assertLarkNativeAiReviewedRepository({
      branch: 'main', clean: true, head: HEAD, reviewedHead: 'b'.repeat(40),
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_REPOSITORY_HEAD_NOT_REVIEWED',
  );
});

test('network guard allows only token auth and GET metadata endpoints', async () => {
  const calls = [];
  const guard = createLarkNativeAiReadOnlyFetchGuard(async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  await guard.fetchImpl(
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    { method: 'POST' },
  );
  await guard.fetchImpl(
    'https://open.larksuite.com/open-apis/bitable/v1/apps/app-token/tables?page_size=500',
    { method: 'GET' },
  );
  await guard.fetchImpl(
    'https://open.larksuite.com/open-apis/bitable/v1/apps/app-token/tables/table-id/fields?page_size=500',
    { method: 'GET' },
  );
  await guard.fetchImpl(
    'https://open.larksuite.com/open-apis/bitable/v1/apps/app-token/tables/table-id/views?page_size=100',
    { method: 'GET' },
  );

  await assert.rejects(
    () => guard.fetchImpl(
      'https://open.larksuite.com/open-apis/bitable/v1/apps/app-token/tables/table-id/fields',
      { method: 'POST', body: '{}' },
    ),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_REQUEST_NOT_READ_ONLY',
  );
  await assert.rejects(
    () => guard.fetchImpl(
      'https://open.larksuite.com/open-apis/bitable/v1/apps/app-token/tables/table-id/records/search',
      { method: 'POST', body: '{}' },
    ),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_REQUEST_NOT_READ_ONLY',
  );

  assert.equal(calls.length, 4);
  assert.deepEqual(guard.snapshot(), {
    tokenRequestCount: 1,
    metadataReadCount: 3,
    blockedRequestCount: 2,
  });
});

test('reviewed terminal source has no Lark mutation or Record-read method call', async () => {
  const source = await readFile(SCRIPT_PATH, 'utf8');
  assert.doesNotMatch(source, /\.createField\s*\(/u);
  assert.doesNotMatch(source, /\.updateField\s*\(/u);
  assert.doesNotMatch(source, /\.createView\s*\(/u);
  assert.doesNotMatch(source, /\.updateView\s*\(/u);
  assert.doesNotMatch(source, /\.createTable\s*\(/u);
  assert.doesNotMatch(source, /\.searchRecords\s*\(/u);
  assert.doesNotMatch(source, /\.listRecords\s*\(/u);
  assert.doesNotMatch(source, /\.batchCreate/u);
  assert.doesNotMatch(source, /\.batchUpdate/u);
});
