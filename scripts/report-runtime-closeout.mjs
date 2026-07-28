#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  assertReportRuntimeCloseoutConfirmation,
  parseReportRuntimeCloseoutArgs,
} from './lib/report-runtime-closeout-operator.js';

try {
  const options = parseReportRuntimeCloseoutArgs(process.argv.slice(2));
  if (!options.execute) {
    const result = spawnSync(
      process.execPath,
      ['scripts/report-runtime-closeout-operator.mjs'],
      { stdio: 'inherit', env: process.env },
    );
    process.exitCode = result.status ?? 1;
  } else {
    assertReportRuntimeCloseoutConfirmation(process.env);
    runRequiredStep(
      'report-runtime-finalizer',
      ['scripts/report-runtime-finalize-operator.mjs', '--execute'],
      {
        ...process.env,
        CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
      },
    );
    runRequiredStep(
      'report-runtime-closeout',
      ['scripts/report-runtime-closeout-operator.mjs', '--execute'],
      process.env,
    );
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'REPORT_RUNTIME_CLOSEOUT_WRAPPER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function runRequiredStep(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    const error = new Error(`Required Report closeout step failed: ${name}`);
    error.name = 'ReportRuntimeCloseoutWrapperError';
    error.code = 'REPORT_RUNTIME_CLOSEOUT_REQUIRED_STEP_FAILED';
    error.details = { name, exitCode: result.status ?? 1 };
    throw error;
  }
}

export const REPORT_RUNTIME_CLOSEOUT_ONE_COMMAND = Object.freeze({
  confirmation: REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  command: `CONFIRM_REPORT_RUNTIME_CLOSEOUT=${REPORT_RUNTIME_CLOSEOUT_CONFIRMATION} node scripts/report-runtime-closeout.mjs --execute`,
});
