#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getReportLiveClosureDescriptor } from '../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  assertReviewedReportLiveClosureHandoff,
  runReportLiveClosureFramework,
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { createReportLiveClosurePlanAdapters } from './lib/multichannel-report-live-closure-adapters.js';

export const MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION = 'RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE';
export const MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF_CONTRACT =
  'multichannel_report_live_closure_handoff_v1';

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
  const argv = input.argv ?? [];
  const args = parseReportLiveClosureArgs(argv);
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
      sourceWatermark: requireText(input.sourceWatermark ?? source.watermarkDate, 'sourceWatermark'),
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
    assertExecutionConfirmation(env);
    const handoff = input.reviewedHandoff ?? await loadReviewedHandoff(env);
    const repository = handoff.repository ?? {};
    assertReviewedReportLiveClosureHandoff(handoff, { descriptor, repository });
    throw terminalError(
      'The retained handoff is valid, but direct Live execution remains blocked until the shared Report closeout operator is reviewed for YouTube Organic',
      'REPORT_LIVE_CLOSURE_SHARED_OPERATOR_YOUTUBE_NOT_REVIEWED',
      {
        reviewedHandoff: true,
        requiredOperator: 'scripts/report-runtime-closeout-operator.mjs',
      },
    );
  }

  return Object.freeze({
    ok: true,
    contractVersion: 'multichannel_report_live_closure_terminal_v2',
    mode: 'PLAN_ONLY',
    frameworkStatus: 'READY',
    firstAdopter: 'youtube',
    youtubeStatus: framework?.status === 'READY_FOR_LIVE'
      ? 'READY_FOR_LIVE_HANDOFF'
      : 'READY_FOR_LIVE_AUDIT',
    descriptor,
    target,
    identities: framework?.identities ?? Object.freeze([]),
    materializationPlan: framework?.plan ?? null,
    reviewedReadinessRequired: reviewedReadiness === null,
    reviewedHandoffRequired: true,
    readOnlyAssessmentCommand: [
      'CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=RUN_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR',
      'MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha>',
      'node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs --execute',
    ].join(' \\\n'),
    exactLiveCommand: [
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json>',
      `CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=${MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION}`,
      'node scripts/multichannel-report-live-closure-terminal.mjs --platform=youtube --capability=organic --execute',
    ].join(' \\\n'),
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
  const handoffPath = resolve(configuredPath);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(handoffPath, 'utf8'));
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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await buildYouTubeFirstAdopterPlan({
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
