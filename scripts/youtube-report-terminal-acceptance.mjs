#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportRuntimeCloseoutConfigWindow } from './lib/report-runtime-closeout-operator.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
} from './lib/youtube-report-remote-readiness-collector.js';
import {
  YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV,
  loadYouTubeReportRemoteLockReleaseEvidence,
} from './lib/youtube-report-remote-lock-release.js';
import {
  OPERATOR_TERMINAL_EXIT_CODES,
  OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
  assertWritableEvidencePath,
  buildShellFreeCommandSpec,
  collectAcceptanceGate,
  runJsonProcess,
  sanitizeOperatorTerminalValue,
} from './lib/operator-terminal-reliability.js';

export const YOUTUBE_REPORT_TERMINAL_ACCEPTANCE_CONTRACT =
  'youtube_report_terminal_acceptance_v1';

const repositoryRoot = resolve(process.cwd());
const reviewedTerminalPath = fileURLToPath(
  new URL('./youtube-report-remote-readiness-reviewed-terminal.mjs', import.meta.url),
);
const configPath = resolve(
  process.env.MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_WRANGLER_CONFIG
    ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputPath = resolve(
  process.env.MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_EVIDENCE
    ?? 'outputs/youtube-report-remote-readiness/readiness-summary.json',
);
const REQUIRED_LARK_CREDENTIALS = Object.freeze([
  'LARK_APP_ID',
  'LARK_APP_SECRET',
]);

try {
  const summary = await runYouTubeReportTerminalAcceptance({ env: process.env });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.ok
    ? OPERATOR_TERMINAL_EXIT_CODES.success
    : OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: YOUTUBE_REPORT_TERMINAL_ACCEPTANCE_CONTRACT,
    reliabilityContractVersion: OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
    mode: 'LOCAL_ACCEPTANCE_ONLY',
    stage: 'local-terminal-acceptance',
    code: error?.code ?? 'YOUTUBE_REPORT_TERMINAL_ACCEPTANCE_FAILED',
    message: String(error?.message ?? error),
    details: sanitizeOperatorTerminalValue(error?.details ?? {}),
    exitClass: 'EXECUTION_FAILED',
    remoteReadCount: 0,
    remoteWriteCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = OPERATOR_TERMINAL_EXIT_CODES.executionFailed;
}

export async function runYouTubeReportTerminalAcceptance(input = {}) {
  const env = Object.freeze({ ...process.env, ...(input.env ?? {}) });
  const gates = [];
  const command = buildShellFreeCommandSpec({
    executable: process.execPath,
    args: [reviewedTerminalPath, '--execute'],
    requiredEnv: [
      'CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR',
      'MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD',
      YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV,
    ],
  });

  await collectAcceptanceGate(gates, 'node-runtime', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (!Number.isSafeInteger(major) || major < 22) throw acceptanceError(
      'Node.js 22 or newer is required',
      'YOUTUBE_REPORT_TERMINAL_NODE_VERSION_UNSUPPORTED',
      { observedMajor: major },
    );
    return { major, supported: true };
  });

  await collectAcceptanceGate(gates, 'shell-free-command-contract', () => ({
    ...command,
    environmentValuesInterpolatedByShell: false,
    literalCommentLinesAccepted: false,
  }));

  await collectAcceptanceGate(gates, 'reviewed-terminal-plan-spawn', () => {
    const child = runJsonProcess({
      executable: process.execPath,
      args: [reviewedTerminalPath],
    }, { cwd: repositoryRoot, env });
    if (child.status !== 0
      || child.stdout?.planOnly !== true
      || child.stdout?.internalCollectorDirectExecutionBlocked !== true
      || child.stdout?.remoteMutationCount !== 0) throw acceptanceError(
      'Reviewed terminal plan process did not prove the expected safe contract',
      'YOUTUBE_REPORT_TERMINAL_PLAN_PROCESS_INVALID',
      { status: child.status },
    );
    return {
      status: child.status,
      planOnly: true,
      directExecutionBlocked: true,
      remoteMutationCount: 0,
    };
  });

  const reviewedHead = await collectAcceptanceGate(gates, 'reviewed-head-input', () => {
    const value = String(env.MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD ?? '').trim();
    if (!/^[0-9a-f]{40}$/u.test(value)) throw acceptanceError(
      'MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD must be an exact lowercase commit SHA',
      'YOUTUBE_REPORT_TERMINAL_REVIEWED_HEAD_REQUIRED',
    );
    return value;
  });

  const repository = await collectAcceptanceGate(gates, 'repository-exact-main', () => {
    const observed = collectRepositoryState(reviewedHead);
    if (observed.branch !== 'main'
      || observed.clean !== true
      || observed.head !== observed.reviewedHead) throw acceptanceError(
      'Repository must be clean exact reviewed main before the command is runnable',
      'YOUTUBE_REPORT_TERMINAL_REPOSITORY_NOT_READY',
      observed,
    );
    return observed;
  });

  await collectAcceptanceGate(gates, 'wrangler-config-local-contract', async () => {
    const sourceText = await readFile(configPath, 'utf8');
    const config = buildReportRuntimeCloseoutConfigWindow(sourceText);
    return {
      configPresent: true,
      safeTrueFlagCount: config.safeTrueFlags.length,
      activeTrueFlagCount: config.activeTrueFlags.length,
      requiredTableMappingCount: Object.keys(config.tableIds).length,
      bindingFingerprintPresent: Boolean(config.bindingFingerprint),
      tableFingerprintPresent: Boolean(config.tableIdFingerprint),
    };
  });

  const localEnv = await collectAcceptanceGate(gates, 'local-secret-source', async () => {
    const fileEnv = await readOptionalPrivateDevVars(devVarsPath);
    const merged = Object.freeze({ ...fileEnv, ...env });
    const missing = REQUIRED_LARK_CREDENTIALS.filter((name) => !nonEmpty(merged[name]));
    if (!nonEmpty(merged.LARK_APP_TOKEN) && !nonEmpty(merged.LARK_BASE_APP_TOKEN)) {
      missing.push('LARK_APP_TOKEN_OR_LARK_BASE_APP_TOKEN');
    }
    if (missing.length > 0) throw acceptanceError(
      'Required Lark credentials are missing from process environment or private .dev.vars',
      'YOUTUBE_REPORT_TERMINAL_CREDENTIALS_MISSING',
      { missingCredentialNames: missing.sort() },
    );
    return {
      devVarsPresent: Object.keys(fileEnv).length > 0,
      requiredCredentialCount: 3,
      missingCredentialCount: 0,
      secretValuesPrinted: false,
    };
  });

  await collectAcceptanceGate(gates, 'meta-remote-lock-release-evidence', async () => {
    if (!repository || !reviewedHead) throw acceptanceError(
      'Lock-release evidence cannot be accepted before exact repository identity passes',
      'YOUTUBE_REPORT_TERMINAL_LOCK_EVIDENCE_DEPENDENCY_BLOCKED',
    );
    const release = await loadYouTubeReportRemoteLockReleaseEvidence({
      env,
      expectedHead: reviewedHead,
    });
    return {
      released: release.released,
      exactHeadMatch: release.auditHead === reviewedHead,
      evidenceDigestPresent: Boolean(release.evidenceSha256),
      capturedAtPresent: Number.isSafeInteger(release.capturedAt),
    };
  });

  await collectAcceptanceGate(gates, 'evidence-output-path', () => (
    assertWritableEvidencePath(outputPath)
  ));

  await collectAcceptanceGate(gates, 'confirmation-value', () => {
    if (env.CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR
      !== YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION) throw acceptanceError(
      `CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR must equal ${YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION}`,
      'YOUTUBE_REPORT_TERMINAL_CONFIRMATION_REQUIRED',
    );
    return { exactConfirmation: true };
  });

  const blockers = Object.freeze(gates
    .filter((gate) => gate.status === 'blocked')
    .map((gate) => Object.freeze({
      gate: gate.name,
      code: gate.code,
      message: gate.message,
      details: gate.details ?? {},
    })));

  return Object.freeze({
    ok: blockers.length === 0,
    contractVersion: YOUTUBE_REPORT_TERMINAL_ACCEPTANCE_CONTRACT,
    reliabilityContractVersion: OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
    mode: 'LOCAL_ACCEPTANCE_ONLY',
    decision: blockers.length === 0 ? 'READY_TO_RUN_REVIEWED_REMOTE_READ' : 'LOCAL_PRECHECK_BLOCKED',
    command,
    exitCodeContract: Object.freeze({
      0: 'success_with_retained_evidence',
      2: 'precheck_or_readiness_blocked_without_remote_mutation',
      1: 'execution_failure_with_failure_evidence',
    }),
    repository: repository ?? null,
    localCredentialSourceReady: Boolean(localEnv),
    gates: Object.freeze(gates),
    blockers,
    allBlockersReportedInSingleRun: true,
    remoteReadCount: 0,
    remoteWriteCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

function collectRepositoryState(reviewedHead) {
  return Object.freeze({
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', 'HEAD']),
    reviewedHead,
    clean: git(['status', '--porcelain', '--untracked-files=all'], false).trim() === '',
  });
}

function git(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw acceptanceError(
    `Unable to inspect repository with git ${args.join(' ')}`,
    'YOUTUBE_REPORT_TERMINAL_GIT_FAILED',
    { status: result.status, sourceCode: result.error?.code ?? null },
  );
  const value = String(result.stdout ?? '');
  return trim ? value.trim() : value;
}

async function readOptionalPrivateDevVars(path) {
  try {
    const file = await stat(path);
    if (!file.isFile()) throw acceptanceError(
      '.dev.vars must be a regular file',
      'YOUTUBE_REPORT_TERMINAL_DEV_VARS_INVALID',
    );
    if ((file.mode & 0o077) !== 0) throw acceptanceError(
      '.dev.vars must use private mode 0600',
      'YOUTUBE_REPORT_TERMINAL_DEV_VARS_MODE_INVALID',
      { expectedMode: '0600' },
    );
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({});
    throw error;
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function acceptanceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeReportTerminalAcceptanceError';
  error.code = code;
  error.details = details;
  return error;
}
