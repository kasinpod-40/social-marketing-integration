#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION,
} from './lib/report-runtime-config-dlq-evidence-head-bridge.js';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION,
} from './lib/report-runtime-config-dlq-recovery.js';
import { REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION } from './lib/report-runtime-window-repair.js';

const RECOVERY_CONFIRMATION = 'RECOVER_REPORT_RUNTIME_3D_AND_CONTINUE';
const FRESH_CONFIG_DLQ_CONFIRMATION = 'RECOVER_EXACT_REPORT_1D_CONFIG_DLQ_AND_CONTINUE';
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_DIR
    ?? 'outputs/report-runtime-window-repair',
);

try {
  if (process.env.CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR_RECOVERY !== RECOVERY_CONFIRMATION) {
    throw recoveryFailure(
      `Execution requires CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR_RECOVERY=${RECOVERY_CONFIRMATION}`,
      'REPORT_RUNTIME_WINDOW_REPAIR_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const finalizerRoot = join(outputRoot, 'finalizer');
  const finalizerEvidence = join(finalizerRoot, 'report-runtime-finalize-summary.json');
  const threeDayEvidence = join(outputRoot, '3d-refresh');
  const oneDayEvidence = join(outputRoot, '1d-fresh');
  const thirtyDayEvidence = join(outputRoot, '30d-fresh');

  runRequired('report-runtime-finalizer', ['scripts/report-runtime-finalize-operator.mjs', '--execute'], {
    ...process.env,
    MKT_REPORT_RUNTIME_FINALIZE_EVIDENCE_DIR: finalizerRoot,
    CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
  });

  if (!(await fileExists(join(threeDayEvidence, 'report-runtime-closeout-summary.json')))) {
    runRequired(
      '3d-config-dlq-evidence-head-bridge',
      ['scripts/report-runtime-config-dlq-evidence-head-bridge.mjs'],
      {
        ...process.env,
        MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: threeDayEvidence,
        CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE:
          REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION,
      },
    );

    runRequired('3d-exact-config-dlq-recovery', ['scripts/report-runtime-config-dlq-recovery.mjs'], {
      ...process.env,
      MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerEvidence,
      MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: threeDayEvidence,
      CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION,
    });
  }

  if (!(await fileExists(join(oneDayEvidence, 'report-runtime-closeout-summary.json')))) {
    runRequired(
      '1d-exact-config-dlq-recovery',
      ['scripts/report-runtime-fresh-config-dlq-recovery.mjs'],
      {
        ...process.env,
        MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerEvidence,
        MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: oneDayEvidence,
        CONFIRM_REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY: FRESH_CONFIG_DLQ_CONFIRMATION,
      },
    );
  }

  if (!(await fileExists(join(thirtyDayEvidence, 'report-runtime-closeout-summary.json')))) {
    runRequired(
      '30d-stabilized-fresh-closeout',
      ['scripts/report-runtime-stabilized-closeout.mjs', '--execute'],
      {
        ...process.env,
        MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerEvidence,
        MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: thirtyDayEvidence,
        MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '30',
        MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'fresh',
        CONFIRM_REPORT_RUNTIME_CLOSEOUT: 'EXECUTE_REPORT_RUNTIME_CLOSEOUT',
      },
    );
  }

  runRequired('aggregate-verified-window-sequence', ['scripts/report-runtime-window-repair.mjs', '--execute'], {
    ...process.env,
    MKT_REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_DIR: outputRoot,
    CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR: REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  });
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'REPORT_RUNTIME_WINDOW_REPAIR_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function runRequired(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env,
  });
  if (result.error || result.status !== 0) throw recoveryFailure(
    `Required Report recovery step failed: ${name}`,
    'REPORT_RUNTIME_WINDOW_REPAIR_RECOVERY_STEP_FAILED',
    { name, exitCode: result.status ?? 1 },
  );
}

function recoveryFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeWindowRepairRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
