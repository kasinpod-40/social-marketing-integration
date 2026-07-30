#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION,
} from './lib/report-runtime-config-dlq-evidence-head-bridge.js';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION,
} from './lib/report-runtime-config-dlq-recovery.js';
import { REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION } from './lib/report-runtime-window-repair.js';

const RECOVERY_CONFIRMATION = 'RECOVER_REPORT_RUNTIME_3D_AND_CONTINUE';
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

  runRequired('report-runtime-finalizer', ['scripts/report-runtime-finalize-operator.mjs', '--execute'], {
    ...process.env,
    MKT_REPORT_RUNTIME_FINALIZE_EVIDENCE_DIR: finalizerRoot,
    CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
  });

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

  runRequired('remaining-window-sequence', ['scripts/report-runtime-window-repair.mjs', '--execute'], {
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
