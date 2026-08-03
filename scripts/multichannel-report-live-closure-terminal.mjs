#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { getReportLiveClosureDescriptor } from '../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  assertReviewedReportLiveClosureHandoff,
  runReportLiveClosureFramework,
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { REPORT_RUNTIME_CLOSEOUT_CONFIRMATION } from './lib/report-runtime-closeout-operator.js';
import { createReportLiveClosurePlanAdapters } from './lib/multichannel-report-live-closure-adapters.js';
import {
  OPERATOR_TERMINAL_EXIT_CODES,
  OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
  buildShellFreeCommandSpec,
  inspectPrivateJsonFile,
} from './lib/operator-terminal-reliability.js';

const execFileAsync = promisify(execFile);
export const MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION = 'RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE';
export const MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_CONTRACT =
  'multichannel_report_live_closure_handoff_v1';
export const MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT = Object.freeze({
  0: 'success_with_reviewed_completion_evidence',
  2: 'precheck_blocked_before_shared_operator_execution',
  1: 'shared_operator_execution_failure_with_safe_restore_evidence',
});

let currentStage = 'plan-only';
let sharedOperatorStarted = false;

export function parseReportLiveClosureArgs(argv = []) {
  const allowed = new Set(['--execute', '--platform=youtube', '--capability=organic']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw terminalError(
    `Unsupported Multichannel Report Live Closure arguments: ${unknown.join(', ')}`,
    'REPORT_LIVE_CLOSURE_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export async function buildYouTubeFirstAdopterPlan(input = {}) {
  const env = input.env ?? {};
  const args = parseReportLiveClosureArgs(input.argv ?? []);
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const reviewedReadiness = input.reviewedReadiness ?? null;
  const target = reviewedReadiness ? resolveExactTarget(input, reviewedReadiness) : null;
  let framework = null;

  if (reviewedReadiness) {
    const source = reviewedReadiness.evidence?.source ?? {};
    const adapters = createReportLiveClosurePlanAdapters({
      descriptor,
      target,
      reviewedReadiness,
      requestedAt: requireTimestamp(input.requestedAt, 'requestedAt'),
      periodEnd: requireDate(input.periodEnd ?? source.watermarkDate, 'periodEnd'),
      sourceWatermark: requireText(
        input.sourceWatermark ?? source.sourceWatermark,
        'source.sourceWatermark',
      ),
      timeZone: input.timeZone ?? source.reportingTimezone ?? 'Asia/Bangkok',
    });
    framework = await runReportLiveClosureFramework({
      descriptor,
      target,
      adapters,
      reviewedHandoff: input.reviewedHandoff ?? null,
      execute: false,
    });
  }

  if (args.execute) {
    currentStage = 'confirmation';
    assertExecutionConfirmation(env);
    currentStage = 'reviewed-handoff';
    const handoff = input.reviewedHandoff ?? await loadReviewedHandoff(env);
    const repository = handoff.repository ?? {};
    assertReviewedReportLiveClosureHandoff(handoff, { descriptor, repository });
    requireText(
      handoff.youtubeReadiness?.evidence?.source?.sourceWatermark,
      'youtubeReadiness.evidence.source.sourceWatermark',
    );
    const executeSharedOperator = input.executeSharedOperator ?? executeReviewedSharedOperator;
    currentStage = 'shared-operator-execution';
    const execution = await executeSharedOperator({ env, handoff });
    if (!execution || typeof execution !== 'object' || execution.ok !== true) throw terminalError(
      'Shared Report closeout operator did not return successful reviewed evidence',
      'REPORT_LIVE_CLOSURE_SHARED_OPERATOR_FAILED',
    );
    const result = sanitizeReportLiveClosureEvidence(execution);
    Object.defineProperties(result, {
      delegatedToSharedOperator: {
        value: true,
        enumerable: true,
        writable: false,
        configurable: false,
      },
      sharedOperator: {
        value: 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs',
        enumerable: true,
        writable: false,
        configurable: false,
      },
      exitCodeContract: {
        value: MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT,
        enumerable: true,
        writable: false,
        configurable: false,
      },
    });
    return Object.freeze(result);
  }

  return Object.freeze({
    ok: true,
    contractVersion: 'multichannel_report_live_closure_terminal_v5',
    reliabilityContractVersion: OPERATOR_TERMINAL_RELIABILITY_CONTRACT,
    mode: 'PLAN_ONLY',
    frameworkStatus: 'READY',
    firstAdopter: 'youtube',
    youtubeStatus: framework?.status === 'READY_FOR_LIVE'
      ? 'READY_FOR_RETAINED_HANDOFF_EXECUTION'
      : 'READY_FOR_LIVE_AUDIT',
    descriptor,
    target,
    identities: framework?.identities ?? Object.freeze([]),
    materializationPlan: framework?.plan ?? null,
    reviewedReadinessRequired: reviewedReadiness === null,
    reviewedHandoffRequired: true,
    exactSourceWatermarkRequired: true,
    localAcceptanceCommand: 'node scripts/multichannel-report-live-closure-acceptance.mjs',
    readOnlyAcceptanceCommand: 'node scripts/youtube-report-terminal-acceptance.mjs',
    readOnlyAssessmentCommand: buildShellFreeCommandSpec({
      executable: 'node',
      args: ['scripts/youtube-report-remote-readiness-reviewed-terminal.mjs', '--execute'],
      requiredEnv: [
        'CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR',
        'MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD',
        'MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE',
      ],
    }),
    sharedOperatorReviewCommand: buildShellFreeCommandSpec({
      executable: 'node',
      args: ['scripts/youtube-shared-report-closeout-review.mjs', '--execute'],
      requiredEnv: [
        'CONFIRM_YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW',
        'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
        'MKT_YOUTUBE_SHARED_REPORT_CLOSEOUT_REQUESTED_AT',
      ],
    }),
    liveCommand: buildShellFreeCommandSpec({
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
    }),
    liveCommandAuthorized: false,
    exitCodeContract: MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT,
    completionAuthorities: Object.freeze({
      sameInputReplay: 'shared_reviewed_multiwindow_same_input_replay_zero_drift',
      safeRestore: 'shared_reviewed_multiwindow_finally_all_false_restore',
      retainedEvidence: 'report-runtime-closeout-summary.json mode 0600',
    }),
    remoteWriteCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

export async function loadReviewedHandoff(env = {}) {
  const configuredPath = requireText(
    env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF,
    'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
  );
  let retained;
  try {
    retained = await inspectPrivateJsonFile(configuredPath, {
      field: 'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
      label: 'Retained Multichannel Report Live Closure handoff',
      requiredMode: 0o600,
    });
  } catch (error) {
    throw terminalError(
      'Unable to load retained Multichannel Report Live Closure handoff evidence',
      'REPORT_LIVE_CLOSURE_HANDOFF_LOAD_FAILED',
      { handoffPathPresent: Boolean(configuredPath), sourceCode: error?.code ?? null },
    );
  }
  const parsed = retained.value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.contractVersion !== MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_CONTRACT) throw terminalError(
    'Retained Multichannel Report Live Closure handoff is invalid',
    'REPORT_LIVE_CLOSURE_REVIEWED_HANDOFF_INVALID',
  );
  if (JSON.stringify(sanitizeReportLiveClosureEvidence(parsed)) !== JSON.stringify(parsed)) throw terminalError(
    'Retained Multichannel Report Live Closure handoff is not sanitized',
    'REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
  );
  return Object.freeze(parsed);
}

async function executeReviewedSharedOperator({ env }) {
  const handoffPath = requireText(
    env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF,
    'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
  );
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'multichannel-report-closeout-'));
  try {
    const childDevVarsPath = await resolveChildDevVarsPath(env, temporaryDirectory);
    sharedOperatorStarted = true;
    const result = await execFileAsync(process.execPath, [
      'scripts/report-runtime-closeout-reviewed-multiwindow.mjs', '--execute',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        DEV_VARS_FILE: childDevVarsPath,
        MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'youtube',
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
        CONFIRM_REPORT_RUNTIME_CLOSEOUT: REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
      },
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
    });
    return parseOperatorJson(result.stdout);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function resolveChildDevVarsPath(env = {}, temporaryDirectory) {
  const configuredPath = resolve(env.DEV_VARS_FILE ?? '.dev.vars');
  try {
    const file = await stat(configuredPath);
    if (!file.isFile()) throw terminalError(
      'DEV_VARS_FILE must be a regular file when present',
      'REPORT_LIVE_CLOSURE_DEV_VARS_INVALID',
    );
    if ((file.mode & 0o777) !== 0o600) throw terminalError(
      'DEV_VARS_FILE must use exact private mode 0600',
      'REPORT_LIVE_CLOSURE_DEV_VARS_MODE_INVALID',
      {
        expectedMode: '0600',
        observedMode: (file.mode & 0o777).toString(8).padStart(4, '0'),
      },
    );
    return configuredPath;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const root = requireText(temporaryDirectory, 'temporaryDirectory');
    const emptyPath = resolve(root, 'empty.dev.vars');
    await writeFile(emptyPath, '', { encoding: 'utf8', mode: 0o600 });
    await chmod(emptyPath, 0o600);
    return emptyPath;
  }
}

function parseOperatorJson(value) {
  const text = String(value ?? '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  throw terminalError(
    'Shared Report closeout operator returned invalid JSON evidence',
    'REPORT_LIVE_CLOSURE_SHARED_OPERATOR_JSON_INVALID',
  );
}

function resolveExactTarget(input, readiness) {
  const evidenceTarget = readiness.evidence?.target ?? {};
  return Object.freeze({
    customerKey: requireExact(evidenceTarget.accountKey, 'chemistry_k', 'accountKey'),
    customerProfile: requireExact(
      evidenceTarget.customerProfile,
      'integration_workspace',
      'customerProfile',
    ),
    accountId: requireText(
      input.accountId ?? input.reviewedHandoff?.youtubeIdentity?.accountId,
      'youtubeIdentity.accountId',
    ),
  });
}

function assertExecutionConfirmation(env) {
  if (env.CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE !== MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION) {
    throw terminalError(
      `Execution requires CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=${MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION}`,
      'REPORT_LIVE_CLOSURE_CONFIRMATION_REQUIRED',
    );
  }
}
function requireExact(value, expected, field) {
  const text = requireText(value, field);
  if (text !== expected) throw terminalError(
    `${field} must equal ${expected}`,
    'REPORT_LIVE_CLOSURE_TARGET_INVALID',
    { field, expected, observed: text },
  );
  return text;
}
function requireDate(value, field) {
  const text = requireText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw terminalError(
    `${field} must be YYYY-MM-DD`,
    'REPORT_LIVE_CLOSURE_TARGET_INVALID',
    { field },
  );
  return text;
}
function requireTimestamp(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw terminalError(
    `${field} must be an epoch millisecond`,
    'REPORT_LIVE_CLOSURE_TARGET_INVALID',
    { field },
  );
  return number;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw terminalError(
    `${field} is required`,
    'REPORT_LIVE_CLOSURE_TARGET_INVALID',
    { field },
  );
  return value.trim();
}
function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MultichannelReportLiveClosureTerminalError';
  error.code = code;
  error.details = details;
  return error;
}

function classifyTerminalFailure() {
  if (sharedOperatorStarted || currentStage === 'shared-operator-execution') return Object.freeze({
    exitCode: OPERATOR_TERMINAL_EXIT_CODES.executionFailed,
    exitClass: 'EXECUTION_FAILED',
  });
  return Object.freeze({
    exitCode: OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked,
    exitClass: 'PRECHECK_BLOCKED',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await buildYouTubeFirstAdopterPlan({
      env: process.env,
      argv: process.argv.slice(2),
    }), null, 2));
  } catch (error) {
    const exit = classifyTerminalFailure();
    console.error(JSON.stringify({
      ok: false,
      stage: currentStage,
      code: error?.code ?? 'REPORT_LIVE_CLOSURE_TERMINAL_FAILED',
      message: error?.message ?? 'Multichannel Report Live Closure terminal failed',
      details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
      exitClass: exit.exitClass,
      sharedOperatorStarted,
      exitCodeContract: MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT,
      remoteWriteCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }));
    process.exitCode = exit.exitCode;
  }
}
