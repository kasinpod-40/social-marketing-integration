#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  assertWooCommerceReportRuntimeCloseoutConfirmation,
  parseReportRuntimeCloseoutArgs,
} from './lib/report-runtime-closeout-operator.js';

const targetEnv = Object.freeze({
  ...process.env,
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'woocommerce',
});

try {
  const options = parseReportRuntimeCloseoutArgs(process.argv.slice(2));
  if (!options.execute) {
    runRequiredStep(
      'woocommerce-report-runtime-closeout-plan',
      ['scripts/report-runtime-closeout-operator.mjs'],
      targetEnv,
    );
  } else {
    assertWooCommerceReportRuntimeCloseoutConfirmation(targetEnv);
    runRequiredStep(
      'report-runtime-finalizer',
      ['scripts/report-runtime-finalize-operator.mjs', '--execute'],
      {
        ...targetEnv,
        CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
      },
    );
    runRequiredStep(
      'woocommerce-report-runtime-closeout',
      ['scripts/report-runtime-closeout-operator.mjs', '--execute'],
      targetEnv,
    );
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_WRAPPER_FAILED',
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
    const error = new Error(`Required WooCommerce Report closeout step failed: ${name}`);
    error.name = 'WooCommerceReportRuntimeCloseoutWrapperError';
    error.code = 'WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_REQUIRED_STEP_FAILED';
    error.details = { name, exitCode: result.status ?? 1 };
    throw error;
  }
}

export const WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ONE_COMMAND = Object.freeze({
  confirmation: WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  command: `CONFIRM_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT=${WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION} node scripts/woocommerce-report-runtime-closeout.mjs --execute`,
});
