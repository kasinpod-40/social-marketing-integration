import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertLarkNativeAiSchemaApplyConfirmation,
  assertLarkNativeAiSchemaApplyRepository,
  createLarkNativeAiSchemaApplyFetchGuard,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  parseLarkNativeAiSchemaApplyArgs,
  requireExactSha,
  requireSha256,
} from '../../scripts/lib/lark-native-ai-additive-apply.js';

test('plan parser and explicit confirmation fail closed', () => {
  assert.deepEqual(parseLarkNativeAiSchemaApplyArgs([]), { execute: false });
  assert.deepEqual(parseLarkNativeAiSchemaApplyArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseLarkNativeAiSchemaApplyArgs(['--apply']),
    (error) => error.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_ARGUMENT_INVALID',
  );
  assert.throws(
    () => assertLarkNativeAiSchemaApplyConfirmation({}),
    (error) => error.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION_REQUIRED',
  );
  assert.doesNotThrow(() => assertLarkNativeAiSchemaApplyConfirmation({
    CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY: LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  }));
});

test('requires exact reviewed repository identity and evidence ancestry', () => {
  const valid = {
    branch: 'main',
    head: 'a'.repeat(40),
    reviewedHead: 'a'.repeat(40),
    evidenceHead: 'b'.repeat(40),
    clean: true,
    evidenceHeadAncestor: true,
  };
  assert.deepEqual(assertLarkNativeAiSchemaApplyRepository(valid), valid);
  assert.throws(
    () => assertLarkNativeAiSchemaApplyRepository({ ...valid, branch: 'feature' }),
    (error) => error.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_BRANCH_INVALID',
  );
  assert.throws(
    () => assertLarkNativeAiSchemaApplyRepository({ ...valid, evidenceHeadAncestor: false }),
    (error) => error.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_HEAD_NOT_ANCESTOR',
  );
  assert.equal(requireExactSha('c'.repeat(40), 'head'), 'c'.repeat(40));
  assert.equal(requireSha256('d'.repeat(64), 'hash'), 'd'.repeat(64));
});

test('network guard allows only metadata and additive Field/View routes', async () => {
  const observed = [];
  const guard = createLarkNativeAiSchemaApplyFetchGuard(async (input, init) => {
    observed.push({ url: typeof input === 'string' ? input : input.url, method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ code: 0, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const root = 'https://open.larksuite.com/open-apis/bitable/v1/apps/app-token/tables';
  await guard.fetchImpl('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', { method: 'POST' });
  await guard.fetchImpl(`${root}?page_size=500`, { method: 'GET' });
  await guard.fetchImpl(`${root}/tbl-ai/fields?page_size=500`, { method: 'GET' });
  await guard.fetchImpl(`${root}/tbl-ai/fields`, { method: 'POST' });
  await guard.fetchImpl(`${root}/tbl-ai/fields/fld-ai`, { method: 'PUT' });
  await guard.fetchImpl(`${root}/tbl-ai/views?page_size=100`, { method: 'GET' });
  await guard.fetchImpl(`${root}/tbl-ai/views`, { method: 'POST' });
  await guard.fetchImpl(`${root}/tbl-ai/views/vew-ai`, { method: 'PATCH' });
  await guard.fetchImpl(`${root}/tbl-ai/views/vew-ai`, { method: 'GET' });

  const counts = guard.snapshot();
  assert.equal(counts.tokenRequestCount, 1);
  assert.equal(counts.metadataReadCount, 4);
  assert.equal(counts.fieldCreateCount, 1);
  assert.equal(counts.fieldUpdateCount, 1);
  assert.equal(counts.viewCreateCount, 1);
  assert.equal(counts.viewUpdateCount, 1);
  assert.equal(counts.schemaWriteCount, 4);
  assert.equal(counts.blockedRequestCount, 0);
  assert.equal(observed.length, 9);

  await assert.rejects(
    () => guard.fetchImpl(`${root}/tbl-ai/records/search`, { method: 'POST' }),
    (error) => error.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED',
  );
  await assert.rejects(
    () => guard.fetchImpl(`${root}/tbl-ai/views/vew-ai`, { method: 'DELETE' }),
    (error) => error.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED',
  );
  assert.equal(guard.snapshot().blockedRequestCount, 2);
  assert.equal(observed.length, 9);
});

test('reviewed terminal source exposes no Record, Automation, AI or notification mutation path', async () => {
  const terminal = await readFile('scripts/lark-native-ai-additive-apply-reviewed-terminal.mjs', 'utf8');
  const library = await readFile('scripts/lib/lark-native-ai-additive-apply.js', 'utf8');
  const application = await readFile('packages/application/src/reports/apply-lark-native-ai-additive-schema.js', 'utf8');
  assert.doesNotMatch(terminal, /searchRecords|batchCreateRecords|batchUpdateRecords|sendNotification|createAutomation/u);
  assert.doesNotMatch(application, /searchRecords|batchCreateRecords|batchUpdateRecords|deleteField|deleteView|renameTable/u);
  assert.match(library, /LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED/u);
  assert.match(terminal, /evidenceHeadAncestor/u);
  assert.match(terminal, /zero_drift|replay/u);
});
