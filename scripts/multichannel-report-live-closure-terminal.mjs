#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { getReportPlatformContract } from '../packages/application/src/reports/report-platform-adapter-registry.js';
import { getReportLiveClosureDescriptor } from '../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  runReportLiveClosureFramework,
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { REPORT_RUNTIME_CLOSEOUT_CONFIRMATION } from './lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import { createReportLiveClosurePlanAdapters } from './lib/multichannel-report-live-closure-adapters.js';

const execFileAsync = promisify(execFile);
export const MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION = 'RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE';
export const MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_CONTRACT =
  'multichannel_report_live_closure_handoff_v1';

export function parseReportLiveClosureArgs(argv = []) {
  let platformScope = 'youtube';
  let capability = null;
  let execute = false;
  for (const argument of argv) {
    if (argument === '--execute') {
      execute = true;
      continue;
    }
    if (argument.startsWith('--platform=')) {
      platformScope = argument.slice('--platform='.length).trim().toLowerCase();
      continue;
    }
    if (argument.startsWith('--capability=')) {
      capability = argument.slice('--capability='.length).trim().toLowerCase();
      continue;
    }
    throw terminalError(
      `Unsupported Multichannel Report Live Closure argument: ${argument}`,
      'REPORT_LIVE_CLOSURE_ARGUMENT_INVALID',
      { argument },
    );
  }
  if (!REPORT_RUNTIME_REVIEWED_CHANNELS.includes(platformScope)) throw terminalError(
    `Unsupported ready Report channel: ${platformScope}`,
    'REPORT_LIVE_CLOSURE_PLATFORM_INVALID',
    { platformScope, supportedPlatforms: REPORT_RUNTIME_REVIEWED_CHANNELS },
  );
  const contract = getReportPlatformContract(platformScope);
  if (capability !== null && capability !== contract.capability) throw terminalError(
    `Capability ${capability} does not match ${platformScope}`,
    'REPORT_LIVE_CLOSURE_CAPABILITY_INVALID',
    { platformScope, expected: contract.capability, observed: capability },
  );
  return Object.freeze({ execute, platformScope, capability: contract.capability });
}

export async function buildReadyChannelPlan(input = {}) {
  const env = input.env ?? {};
  const args = parseReportLiveClosureArgs(input.argv ?? []);
  const descriptor = getReportLiveClosureDescriptor(args.platformScope, args.capability);
  const reviewedReadiness = input.reviewedReadiness ?? null;
  const target = reviewedReadiness
    ? resolveExactTarget(input, reviewedReadiness, descriptor)
    : Object.freeze({
      customerKey: 'chemistry_k',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
    });
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
      reviewedHandoff: null,
      execute: false,
    });
  }

  if (args.execute) {
    assertExecutionConfirmation(env);
    const handoff = input.reviewedHandoff ?? await loadReviewedHandoff(env);
    const executeSharedOperator = input.executeSharedOperator ?? executeReviewedSharedOperator;
    const execution = await executeSharedOperator({
      env,
      handoff,
      platformScope: args.platformScope,
    });
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
    });
    return Object.freeze(result);
  }

  return Object.freeze({
    ok: true,
    contractVersion: 'multichannel_report_live_closure_terminal_v5',
    mode: 'PLAN_ONLY',
    frameworkStatus: 'READY',
    platformScope: args.platformScope,
    capability: args.capability,
    channelStatus: framework?.status === 'READY_FOR_LIVE'
      ? 'READY_FOR_RETAINED_HANDOFF_EXECUTION'
      : 'READY_FOR_LIVE_AUDIT',
    descriptor,
    target,
    identities: framework?.identities ?? Object.freeze([]),
    materializationPlan: framework?.plan ?? null,
    reviewedReadinessRequired: reviewedReadiness === null,
    reviewedHandoffRequired: true,
    exactSourceWatermarkRequired: true,
    exactLiveCommand: [
      `MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=${args.platformScope}`,
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json>',
      `CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=${MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION}`,
      `node scripts/multichannel-report-live-closure-terminal.mjs --platform=${args.platformScope} --capability=${args.capability} --execute`,
    ].join(' \\\n'),
    remoteWriteCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

/** Backward-compatible export retained for the original first-adopter tests. */
export async function buildYouTubeFirstAdopterPlan(input = {}) {
  const argv = input.argv ?? [];
  const hasPlatform = argv.some((argument) => argument.startsWith('--platform='));
  return buildReadyChannelPlan({
    ...input,
    argv: hasPlatform ? argv : [...argv, '--platform=youtube', '--capability=organic'],
  });
}

export async function loadReviewedHandoff(env = {}) {
  const configuredPath = requireText(
    env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF,
    'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
  );
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(configuredPath), 'utf8'));
  } catch (error) {
    throw terminalError(
      'Unable to load retained Multichannel Report Live Closure handoff evidence',
      'REPORT_LIVE_CLOSURE_HANDOFF_LOAD_FAILED',
      { handoffPathPresent: Boolean(configuredPath), sourceCode: error?.code ?? null },
    );
  }
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

async function executeReviewedSharedOperator({ env, platformScope }) {
  const handoffPath = requireText(
    env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF,
    'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
  );
  const result = await execFileAsync(process.execPath, [
    'scripts/report-runtime-closeout-reviewed-multiwindow.mjs', '--execute',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: platformScope,
      MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
      CONFIRM_REPORT_RUNTIME_CLOSEOUT: REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseOperatorJson(result.stdout);
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

function resolveExactTarget(input, readiness, descriptor) {
  const evidenceTarget = readiness.evidence?.target ?? {};
  return Object.freeze({
    customerKey: requireExact(evidenceTarget.accountKey, 'chemistry_k', 'accountKey'),
    customerProfile: requireExact(
      evidenceTarget.customerProfile,
      'integration_workspace',
      'customerProfile',
    ),
    accountKey: requireExact(evidenceTarget.accountKey, 'chemistry_k', 'accountKey'),
    platformScope: requireExact(
      evidenceTarget.platformScope,
      descriptor.platform,
      'platformScope',
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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await buildReadyChannelPlan({
      env: process.env,
      argv: process.argv.slice(2),
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      stage: 'multichannel-report-live-closure-terminal',
      code: error?.code ?? 'REPORT_LIVE_CLOSURE_TERMINAL_FAILED',
      message: error?.message ?? 'Multichannel Report Live Closure terminal failed',
      details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
      remoteWriteCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }));
    process.exitCode = 2;
  }
}
