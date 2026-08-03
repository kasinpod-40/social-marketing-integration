import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE } from '../../packages/config/src/lark-native-ai-controlled-preview-contract.js';
import { runLarkNativeAiControlledPreviewReadiness } from '../../scripts/lark-native-ai-controlled-preview-readiness.mjs';
import { createLarkNativeAiOfflineFixture } from '../fixtures/lark-native-ai-offline-preview-fixtures.js';

const HEAD = 'a'.repeat(40);

test('terminal writes private readiness evidence and reports zero actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lark-ai-controlled-preview-'));
  const inputPath = join(directory, 'input.json');
  const outputPath = join(directory, 'plan.json');
  await writeFile(inputPath, JSON.stringify(validInput()), { mode: 0o600 });

  const result = await runLarkNativeAiControlledPreviewReadiness([
    '--input', inputPath,
    '--output', outputPath,
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready_for_controlled_preview');
  assert.equal(result.rowCount, 10);
  assert.equal(result.outputWritten, true);
  assert.equal(result.safety.aiCallCount, 0);
  assert.equal(result.safety.larkRecordWriteCount, 0);
  assert.equal(result.safety.notificationCount, 0);
  assert.equal(result.safety.production, 'BLOCKED');

  const plan = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(plan.planId, result.planId);
  assert.equal(plan.promptPackage.promptSha256, result.promptSha256);
  assert.equal(plan.larkPlan.rows.length, 10);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
});

test('terminal rejects execute and apply modes before reading input', async () => {
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewReadiness(['--execute']),
    (error) => error?.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTION_NOT_IMPLEMENTED',
  );
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewReadiness(['--apply']),
    (error) => error?.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTION_NOT_IMPLEMENTED',
  );
});

test('terminal requires an explicit private input file', async () => {
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewReadiness([]),
    (error) => error?.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_INPUT_REQUIRED',
  );
});

function validInput() {
  return {
    offlineInput: createLarkNativeAiOfflineFixture('executive_mixed_availability').input,
    repository: { branch: 'main', clean: true, exactHeadSha: HEAD },
    schemaAuthority: {
      validationStatus: 'validated',
      frozen: true,
      targetTable: '🧠 MKT_AI_Report_Runs',
      status: 'zero_drift',
      requiredViewCount: 6,
      exactViewFilterCount: 6,
      remainingLogicalActionCount: 0,
      evidenceSha256: 'b'.repeat(64),
    },
    remoteAuthority: {
      source: 'all_channel_audit_workstream',
      validationStatus: 'validated',
      frozen: true,
      evidenceSha256: 'c'.repeat(64),
      capturedAt: Date.parse('2026-08-03T05:00:00.000Z'),
      metaRemoteLockReleased: true,
      workerFlagsAllFalse: true,
      previewUrlsDisabled: true,
      productionBlocked: true,
      scheduleEnabled: false,
    },
    approval: {
      confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
      approvalId: 'approval-20260803-controlled-preview',
      approvedAt: Date.parse('2026-08-03T05:10:00.000Z'),
      approvedHeadSha: HEAD,
    },
  };
}
