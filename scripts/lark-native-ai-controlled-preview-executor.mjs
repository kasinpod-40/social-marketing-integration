#!/usr/bin/env node

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildLarkNativeAiControlledPreviewExecutionPlan } from '../packages/application/src/reports/build-lark-native-ai-controlled-preview-execution-plan.js';

export async function runLarkNativeAiControlledPreviewExecutor(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.execute || options.apply) {
    throw codedError(
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_REMOTE_APPLY_NOT_IMPLEMENTED',
      'This terminal builds and verifies a 40-row execution plan only; Remote Lark Record access is not implemented.',
    );
  }
  if (!options.inputPath) {
    throw codedError(
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_INPUT_REQUIRED',
      '--input <private-executor-input.json> is required.',
    );
  }
  const inputPath = resolve(options.inputPath);
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const plan = await buildLarkNativeAiControlledPreviewExecutionPlan(input);
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
    await chmod(outputPath, 0o600);
  }
  return {
    ok: plan.status !== 'blocked',
    contractVersion: plan.contractVersion,
    planId: plan.planId,
    status: plan.status,
    nextAction: plan.nextAction,
    windows: plan.windows,
    desiredRowCount: plan.desiredRowCount,
    existingRecordCount: plan.existingRecordCount,
    counts: plan.counts,
    blockerCodes: plan.blockers.map(({ code }) => code),
    outputWritten: Boolean(options.outputPath),
    safety: plan.safety,
  };
}

function parseArgs(argv) {
  const options = { inputPath: null, outputPath: null, execute: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--input') options.inputPath = requireArg(argv[++index], '--input');
    else if (arg === '--output') options.outputPath = requireArg(argv[++index], '--output');
    else throw codedError('LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_ARGUMENT_UNSUPPORTED', `Unsupported argument: ${arg}`);
  }
  return options;
}

function requireArg(value, option) {
  if (!value || value.startsWith('--')) {
    throw codedError('LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_ARGUMENT_VALUE_REQUIRED', `${option} requires a value.`);
  }
  return value;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function main() {
  try {
    const result = await runLarkNativeAiControlledPreviewExecutor();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === 'blocked' ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code ?? 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_FAILED',
      message: error?.message ?? String(error),
      safety: {
        remoteApplyImplemented: false,
        executionAuthorized: false,
        aiCallCount: 0,
        larkRecordReadCount: 0,
        larkRecordWriteCount: 0,
        remoteActionCount: 0,
        notificationCount: 0,
        scheduleEnabled: false,
        production: 'BLOCKED',
      },
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
