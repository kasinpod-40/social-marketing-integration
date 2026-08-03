#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReportLiveClosureDescriptor } from '../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  assertReviewedReportLiveClosureHandoff,
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { readOptionalDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
  REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutConfigWindow,
} from './lib/report-runtime-closeout-operator.js';
import {
  OPERATOR_TERMINAL_EXIT_CODES,
  OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
  assertWritableEvidencePath,
  buildShellFreeCommandSpec,
  collectAcceptanceGate,
  inspectPrivateJsonFile,
  runJsonProcess,
  sanitizeOperatorTerminalValue,
  writePrivateJson,
} from './lib/operator-terminal-reliability.js';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_CONTRACT,
} from './multichannel-report-live-closure-terminal.mjs';

export const MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_CONTRACT =
  'multichannel_report_live_closure_acceptance_v1';

const repositoryRoot = resolve(process.cwd());
const terminalPath = fileURLToPath(
  new URL('./multichannel-report-live-closure-terminal.mjs', import.meta.url),
);
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const handoffPath = resolve(
  process.env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF
    ?? 'outputs/multichannel-report-live-closure/reviewed-handoff.json',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const acceptanceEvidencePath = resolve(
  process.env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_EVIDENCE
    ?? 'outputs/multichannel-report-live-closure/terminal-acceptance-summary.json',
);
const closeoutEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR
    ?? 'outputs/youtube-report-runtime-closeout',
  'report-runtime-closeout-summary.json',
);
const REQUIRED_LARK_CREDENTIALS = Object.freeze(['LARK_APP_ID', 'LARK_APP_SECRET']);

try {
  const summary = await runMultichannelReportLiveClosureAcceptance({ env: process.env });
  const evidencePath = await writePrivateJson(acceptanceEvidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  process.exitCode = summary.ok
    ? OPERATOR_TERMINAL_EXIT_CODES.success
    : OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_CONTRACT,
    reliabilityContractVersion: OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
    mode: 'LOCAL_ACCEPTANCE_ONLY',
    stage: 'local-terminal-acceptance',
    code: error?.code ?? 'MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_FAILED',
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

export async function runMultichannelReportLiveClosureAcceptance(input = {}) {
  const env = Object.freeze({ ...process.env, ...(input.env ?? {}) });
  const gates = [];
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const liveCommand = buildShellFreeCommandSpec({
    executable: 'node',
    args: [
      'scripts/multichannel-report-live-closure-terminal.mjs',
      '--platform=youtube',
      '--capability=organic',
      '--execute',
    ],
    requiredEnv: [
      'MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE',
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
      'CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE',
    ],
  });

  await collectAcceptanceGate(gates, 'node-runtime', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (!Number.isSafeInteger(major) || major < 22) throw acceptanceError(
      'Node.js 22 or newer is required',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_NODE_VERSION_UNSUPPORTED',
      { observedMajor: major },
    );
    return { major, supported: true };
  });

  await collectAcceptanceGate(gates, 'shell-free-live-command-contract', () => ({
    ...liveCommand,
    environment: {
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'youtube',
      MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
      CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE:
        MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
    },
    environmentValuesInterpolatedByShell: false,
    literalCommentLinesAccepted: false,
  }));

  await collectAcceptanceGate(gates, 'terminal-plan-spawn', () => {
    const child = runJsonProcess({
      executable: process.execPath,
      args: [terminalPath],
    }, { cwd: repositoryRoot, env });
    if (child.status !== 0
      || child.stdout?.mode !== 'PLAN_ONLY'
      || child.stdout?.localAcceptanceCommand
        !== 'node scripts/multichannel-report-live-closure-acceptance.mjs'
      || child.stdout?.remoteWriteCount !== 0
      || child.stdout?.queueActionCount !== 0
      || child.stdout?.workerDeploymentCount !== 0) throw acceptanceError(
      'Multichannel terminal plan process did not prove the reviewed zero-Remote contract',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_PLAN_PROCESS_INVALID',
      { status: child.status },
    );
    return {
      status: child.status,
      planOnly: true,
      remoteWriteCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
    };
  });

  const repository = await collectAcceptanceGate(gates, 'repository-exact-main', () => {
    const observed = collectRepositoryState();
    if (observed.branch !== 'main' || observed.clean !== true) throw acceptanceError(
      'Repository must be clean exact main before Multichannel Live execution is runnable',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_REPOSITORY_NOT_READY',
      observed,
    );
    return observed;
  });

  const handoff = await collectAcceptanceGate(gates, 'private-reviewed-handoff', async () => {
    if (!repository) throw acceptanceError(
      'Reviewed handoff cannot be accepted before exact repository identity passes',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_DEPENDENCY_BLOCKED',
    );
    const retained = await inspectPrivateJsonFile(handoffPath, {
      field: 'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
      label: 'Retained Multichannel Report Live Closure handoff',
      requiredMode: 0o600,
    });
    const value = retained.value;
    if (value.contractVersion !== MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_CONTRACT) {
      throw acceptanceError(
        'Retained handoff contract version is invalid',
        'MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_INVALID',
      );
    }
    assertReviewedReportLiveClosureHandoff(value, { descriptor, repository });
    assertExactHandoffIdentity(value, repository);
    return value;
  });

  await collectAcceptanceGate(gates, 'private-finalizer-evidence', async () => {
    if (!repository) throw acceptanceError(
      'Finalizer evidence cannot be accepted before exact repository identity passes',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_FINALIZER_DEPENDENCY_BLOCKED',
    );
    const retained = await inspectPrivateJsonFile(finalizerEvidencePath, {
      field: 'MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE',
      label: 'Report Runtime finalizer evidence',
      requiredMode: 0o600,
    });
    assertReportRuntimeFinalizerEvidence(retained.value);
    if (retained.value.repository?.head !== repository.head) throw acceptanceError(
      'Report Runtime finalizer evidence must match the current exact main Head',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_FINALIZER_HEAD_MISMATCH',
      { exactHeadMatch: false },
    );
    return {
      exactHeadMatch: true,
      canonicalActiveSettings: REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
      allExecutionFlagsFalse: true,
    };
  });

  await collectAcceptanceGate(gates, 'wrangler-config-local-contract', async () => {
    const sourceText = await readFile(configPath, 'utf8');
    const config = buildReportRuntimeCloseoutConfigWindow(sourceText, {
      activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    });
    return {
      configPresent: true,
      safeTrueFlagCount: config.safeTrueFlags.length,
      activeTrueFlagCount: config.activeTrueFlags.length,
      requiredTableMappingCount: Object.keys(config.tableIds).length,
      bindingFingerprintPresent: Boolean(config.bindingFingerprint),
      tableFingerprintPresent: Boolean(config.tableIdFingerprint),
    };
  });

  await collectAcceptanceGate(gates, 'local-secret-source', async () => {
    const fileEnv = await readOptionalPrivateDevVars(devVarsPath);
    const merged = Object.freeze({ ...fileEnv, ...env });
    const missing = REQUIRED_LARK_CREDENTIALS.filter((name) => !nonEmpty(merged[name]));
    if (!nonEmpty(merged.LARK_APP_TOKEN) && !nonEmpty(merged.LARK_BASE_APP_TOKEN)) {
      missing.push('LARK_APP_TOKEN_OR_LARK_BASE_APP_TOKEN');
    }
    if (missing.length > 0) throw acceptanceError(
      'Required Lark credentials are missing from process environment or private .dev.vars',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_CREDENTIALS_MISSING',
      { missingCredentialNames: missing.sort() },
    );
    return {
      devVarsPresent: Object.keys(fileEnv).length > 0,
      processEnvironmentAccepted: true,
      requiredCredentialCount: 3,
      missingCredentialCount: 0,
      secretValuesPrinted: false,
    };
  });

  await collectAcceptanceGate(gates, 'evidence-output-paths', async () => {
    const acceptance = await assertWritableEvidencePath(acceptanceEvidencePath);
    const closeout = await assertWritableEvidencePath(closeoutEvidencePath);
    return {
      acceptanceParentWritable: acceptance.parentWritable,
      closeoutParentWritable: closeout.parentWritable,
    };
  });

  await collectAcceptanceGate(gates, 'execution-authority-contract', () => {
    if (MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION
        !== 'RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE'
      || REPORT_RUNTIME_CLOSEOUT_CONFIRMATION !== 'EXECUTE_REPORT_RUNTIME_CLOSEOUT') {
      throw acceptanceError(
        'Multichannel and shared Report confirmation authorities have drifted',
        'MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION_DRIFT',
      );
    }
    return {
      multichannelConfirmationExact: true,
      sharedOperatorConfirmationExact: true,
      reviewedHandoffPresent: Boolean(handoff),
      sameInputReplayRequired: true,
      zeroDriftRequired: true,
      allFalseRestoreRequired: true,
    };
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
    contractVersion: MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_CONTRACT,
    reliabilityContractVersion: OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
    mode: 'LOCAL_ACCEPTANCE_ONLY',
    decision: blockers.length === 0
      ? 'READY_TO_RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE'
      : 'LOCAL_PRECHECK_BLOCKED',
    liveCommand,
    liveEnvironment: Object.freeze({
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'youtube',
      MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
      CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE:
        MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
    }),
    exitCodeContract: Object.freeze({
      0: 'local_acceptance_passed',
      2: 'local_precheck_blocked_without_remote_action',
      1: 'acceptance_execution_failure_with_failure_evidence',
    }),
    repository: repository ?? null,
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

function collectRepositoryState() {
  return Object.freeze({
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', 'HEAD']),
    reviewedHead: git(['rev-parse', 'HEAD']),
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
    'MULTICHANNEL_REPORT_LIVE_CLOSURE_GIT_FAILED',
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
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_DEV_VARS_INVALID',
    );
    if ((file.mode & 0o777) !== 0o600) throw acceptanceError(
      '.dev.vars must use exact private mode 0600',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_DEV_VARS_MODE_INVALID',
      {
        expectedMode: '0600',
        observedMode: (file.mode & 0o777).toString(8).padStart(4, '0'),
      },
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({});
    throw error;
  }
  return readOptionalDevVars(path);
}

function assertExactHandoffIdentity(handoff, repository) {
  const readinessRepository = handoff.youtubeReadiness?.evidence?.repository ?? {};
  const sourceWatermark = handoff.youtubeReadiness?.evidence?.source?.sourceWatermark;
  const accountId = handoff.youtubeIdentity?.accountId;
  if (handoff.metaRemoteLock?.auditHead !== repository.head
    || readinessRepository.branch !== 'main'
    || readinessRepository.clean !== true
    || readinessRepository.head !== repository.head
    || readinessRepository.reviewedHead !== repository.head
    || !nonEmpty(sourceWatermark)
    || !nonEmpty(accountId)) throw acceptanceError(
    'Reviewed handoff must bind the exact main Head, lock release, source watermark and YouTube identity',
    'MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_IDENTITY_MISMATCH',
    {
      lockHeadMatched: handoff.metaRemoteLock?.auditHead === repository.head,
      readinessHeadMatched: readinessRepository.head === repository.head,
      sourceWatermarkPresent: nonEmpty(sourceWatermark),
      accountIdentityPresent: nonEmpty(accountId),
    },
  );
  if (JSON.stringify(sanitizeReportLiveClosureEvidence(handoff)) !== JSON.stringify(handoff)) {
    throw acceptanceError(
      'Reviewed handoff is not recursively sanitized',
      'MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
    );
  }
  return true;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function acceptanceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MultichannelReportLiveClosureAcceptanceError';
  error.code = code;
  error.details = details;
  return error;
}
