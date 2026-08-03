import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runLarkNativeAiControlledPreviewExecutor } from '../../scripts/lark-native-ai-controlled-preview-executor.mjs';
import { buildControlledPreviewReadinessPlans } from '../helpers/lark-native-ai-controlled-preview-readiness-plans.js';

test('terminal writes a private plan-only 40-row execution plan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lark-ai-executor-'));
  const inputPath = join(directory, 'input.json');
  const outputPath = join(directory, 'plan.json');
  const input = await buildControlledPreviewReadinessPlans();
  await writeFile(inputPath, `${JSON.stringify({ ...input, existingRecords: [] })}\n`, { mode: 0o600 });

  const result = await runLarkNativeAiControlledPreviewExecutor([
    '--input', inputPath,
    '--output', outputPath,
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready_to_apply');
  assert.equal(result.desiredRowCount, 40);
  assert.equal(result.counts.create, 40);
  assert.equal(result.counts.write, 40);
  assert.equal(result.safety.executionAuthorized, false);
  assert.equal(result.safety.larkRecordWriteCount, 0);
  assert.equal(result.outputWritten, true);
  const mode = (await stat(outputPath)).mode & 0o777;
  assert.equal(mode, 0o600);
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(written.actions.length, 40);
  assert.equal(written.safety.remoteApplyImplemented, false);
});

test('terminal rejects execute and apply before reading any input', async () => {
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewExecutor(['--execute']),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_REMOTE_APPLY_NOT_IMPLEMENTED',
  );
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewExecutor(['--apply']),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_REMOTE_APPLY_NOT_IMPLEMENTED',
  );
});

test('terminal requires a private input path and rejects unknown arguments', async () => {
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewExecutor([]),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_INPUT_REQUIRED',
  );
  await assert.rejects(
    () => runLarkNativeAiControlledPreviewExecutor(['--unknown']),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_ARGUMENT_UNSUPPORTED',
  );
});
