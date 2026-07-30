#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_AUTHORIZATION,
} from './lib/report-runtime-refresh-authorization.js';
import {
  ORGANIC_DASHBOARD_READINESS_REFRESH_CONFIRMATION,
  ORGANIC_DASHBOARD_READINESS_REFRESH_CONTRACT_VERSION,
  ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS,
  assertOrganicDashboardReadinessCloseoutSummary,
  assertOrganicDashboardReadinessRefreshConfirmation,
  assertOrganicDashboardReadinessSequence,
} from './lib/organic-dashboard-readiness-refresh.js';

const outputRoot = resolve(
  process.env.MKT_ORGANIC_DASHBOARD_READINESS_EVIDENCE_DIR
    ?? 'outputs/organic-dashboard-readiness-refresh',
);
const finalizerRoot = join(outputRoot, 'finalizer');
const finalizerEvidence = join(finalizerRoot, 'report-runtime-finalize-summary.json');
let currentStage = 'init';

try {
  assertOrganicDashboardReadinessRefreshConfirmation(process.env);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  currentStage = 'finalize-schema-and-settings';
  runRequired('report-runtime-finalizer', ['scripts/report-runtime-finalize-operator.mjs', '--execute'], {
    ...process.env,
    MKT_REPORT_RUNTIME_FINALIZE_EVIDENCE_DIR: finalizerRoot,
    CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
  });
  const finalizer = JSON.parse(await readFile(finalizerEvidence, 'utf8'));
  if (finalizer.ok !== true
    || finalizer.repository?.clean !== true
    || Number(finalizer.schema?.conflicts ?? -1) !== 0
    || Number(finalizer.schema?.readbackActions ?? -1) !== 0
    || Number(finalizer.settings?.canonicalActive ?? -1) !== 66
    || finalizer.runtime?.reportD1ReadEnabled !== false
    || finalizer.runtime?.presetMaterializationEnabled !== false
    || finalizer.runtime?.schedulesEnabled !== false
    || finalizer.runtime?.aiSummaryEnabled !== false) {
    throw refreshError(
      'Report finalizer did not reach the required safe converged state',
      'ORGANIC_DASHBOARD_READINESS_FINALIZER_INVALID',
    );
  }

  const windows = [];
  let reusedWindowCount = 0;
  let executedWindowCount = 0;
  for (const windowDays of ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS) {
    const evidenceDir = join(outputRoot, `${windowDays}d-refresh`);
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    const closeoutPath = join(evidenceDir, 'report-runtime-closeout-summary.json');
    const verificationPath = join(evidenceDir, 'organic-dashboard-readiness-verification.json');
    const closeoutExists = await fileExists(closeoutPath);
    const verificationExists = await fileExists(verificationPath);

    if (closeoutExists !== verificationExists) throw refreshError(
      `Partial ${windowDays}D readiness evidence requires manual diagnosis`,
      'ORGANIC_DASHBOARD_READINESS_PARTIAL_EVIDENCE',
      { windowDays, closeoutExists, verificationExists },
    );

    let reused = false;
    if (!closeoutExists) {
      const files = await readdir(evidenceDir);
      if (files.length !== 0) throw refreshError(
        `Recorded ${windowDays}D attempt blocks automatic repetition`,
        'ORGANIC_DASHBOARD_READINESS_RECORDED_ATTEMPT',
        { windowDays, fileCount: files.length },
      );

      currentStage = `${windowDays}d-stabilized-refresh`;
      runRequired(
        `${windowDays}d-stabilized-refresh`,
        ['scripts/report-runtime-stabilized-closeout.mjs', '--execute'],
        {
          ...process.env,
          MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerEvidence,
          MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: evidenceDir,
          MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: String(windowDays),
          MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
          MKT_REPORT_RUNTIME_REFRESH_AUTHORIZATION:
            REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_AUTHORIZATION,
          CONFIRM_REPORT_RUNTIME_CLOSEOUT: 'EXECUTE_REPORT_RUNTIME_CLOSEOUT',
        },
      );

      currentStage = `${windowDays}d-readiness-verification`;
      runRequired(
        `${windowDays}d-readiness-verification`,
        ['scripts/verify-organic-dashboard-readiness-window.mjs'],
        {
          ...process.env,
          MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: evidenceDir,
          MKT_ORGANIC_DASHBOARD_READINESS_WINDOW_DAYS: String(windowDays),
        },
      );
      executedWindowCount += 1;
    } else {
      reused = true;
      reusedWindowCount += 1;
    }

    const closeoutSummary = JSON.parse(await readFile(closeoutPath, 'utf8'));
    const closeout = assertOrganicDashboardReadinessCloseoutSummary(closeoutSummary, windowDays);
    const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
    if (verification.ok !== true
      || verification.contractVersion !== ORGANIC_DASHBOARD_READINESS_REFRESH_CONTRACT_VERSION
      || verification.decision !== 'ORGANIC_DASHBOARD_READINESS_WINDOW_VERIFIED'
      || Number(verification.windowDays) !== windowDays
      || verification.reportId !== closeout.reportId
      || verification.payloadChecksum !== closeout.payloadChecksum
      || Number(verification.metricCount) !== 17
      || Number(verification.valueMismatchCount) !== 0
      || Number(verification.metadataMismatchCount) !== 0
      || verification.restoredAllFalse !== true
      || verification.remoteMutationDuringVerification !== false) {
      throw refreshError(
        `Stored ${windowDays}D readiness verification is invalid`,
        'ORGANIC_DASHBOARD_READINESS_STORED_VERIFICATION_INVALID',
        { windowDays },
      );
    }
    windows.push(Object.freeze({
      windowDays,
      reportId: verification.reportId,
      payloadChecksum: verification.payloadChecksum,
      metricCount: Number(verification.metricCount),
      valueMismatchCount: Number(verification.valueMismatchCount),
      metadataMismatchCount: Number(verification.metadataMismatchCount),
      scopeCounts: verification.scopeCounts,
      availabilityCounts: verification.availabilityCounts,
      incompleteBaseline: verification.incompleteBaseline,
      coverageRate: verification.coverageRate,
      restoredAllFalse: verification.restoredAllFalse,
      finalWorkerVersion: verification.finalWorkerVersion,
      reused,
      evidencePath: verificationPath,
    }));
  }

  currentStage = 'aggregate-readiness-refresh';
  assertOrganicDashboardReadinessSequence(windows);
  const reportIds = windows.map((window) => window.reportId);
  if (new Set(reportIds).size !== windows.length) throw refreshError(
    'Organic Dashboard readiness windows do not have unique Stable Report IDs',
    'ORGANIC_DASHBOARD_READINESS_REPORT_ID_DUPLICATE',
  );

  const summary = Object.freeze({
    ok: true,
    contractVersion: ORGANIC_DASHBOARD_READINESS_REFRESH_CONTRACT_VERSION,
    decision: 'ORGANIC_DASHBOARD_READINESS_REFRESHED',
    repositoryHead: finalizer.repository.head,
    finalizerEvidence,
    execution: {
      windowCount: windows.length,
      executedWindowCount,
      reusedWindowCount,
      totalMetricRows: windows.reduce((sum, window) => sum + window.metricCount, 0),
    },
    windows,
    safety: {
      stableReportIds: true,
      manualD1OrLarkEditing: false,
      syntheticHistoryCreated: false,
      businessFactsDeleted: false,
      providerCalls: 0,
      schedulesEnabled: false,
      aiEnabled: false,
      production: false,
      restoredAllFalseAfterEveryWindow: windows.every((window) => window.restoredAllFalse),
    },
  });
  const evidencePath = join(outputRoot, 'organic-dashboard-readiness-refresh-summary.json');
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'ORGANIC_DASHBOARD_READINESS_REFRESH_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function runRequired(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
  });
  if (result.error || result.status !== 0) throw refreshError(
    `Required Organic Dashboard readiness step failed: ${name}`,
    'ORGANIC_DASHBOARD_READINESS_STEP_FAILED',
    { name, exitCode: result.status ?? 1 },
  );
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
async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
function refreshError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'OrganicDashboardReadinessRefreshError';
  error.code = code;
  error.details = details;
  return error;
}
