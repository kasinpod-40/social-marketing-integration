#!/usr/bin/env node
import { getReportLiveClosureDescriptor } from '../packages/application/src/report-live-closure/channel-descriptors.js';
import { buildReportIdentities } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';

export const MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION = 'RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE';

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

export function buildYouTubeFirstAdopterPlan(env = {}, argv = []) {
  const args = parseReportLiveClosureArgs(argv);
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const target = Object.freeze({
    customerKey: requireText(env.MKT_CUSTOMER_KEY ?? 'chemistry_k', 'MKT_CUSTOMER_KEY'),
    customerProfile: requireText(env.MKT_CUSTOMER_PROFILE ?? 'integration_workspace', 'MKT_CUSTOMER_PROFILE'),
    accountId: requireText(env.MKT_YOUTUBE_ACCOUNT_ID ?? 'READ_FROM_EXISTING_AUTHORITY', 'MKT_YOUTUBE_ACCOUNT_ID'),
  });
  const identities = buildReportIdentities({ ...target, descriptor });
  const metaLockReleased = env.MKT_META_REMOTE_LOCK_RELEASED === 'true';
  const confirmed = env.CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE === MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION;

  if (args.execute && !metaLockReleased) throw terminalError(
    'Meta Remote lock is still active; Live closure execution is blocked',
    'REPORT_LIVE_CLOSURE_META_REMOTE_LOCK_ACTIVE',
  );
  if (args.execute && !confirmed) throw terminalError(
    `Execution requires CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=${MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION}`,
    'REPORT_LIVE_CLOSURE_CONFIRMATION_REQUIRED',
  );
  if (args.execute) throw terminalError(
    'Repository workstream prepares the reviewed command only; Audit Workstream must supply reviewed shared adapters before execution',
    'REPORT_LIVE_CLOSURE_EXECUTION_AUTHORITY_NOT_BOUND',
  );

  return Object.freeze({
    ok: true,
    contractVersion: 'multichannel_report_live_closure_terminal_v1',
    mode: 'PLAN_ONLY',
    frameworkStatus: 'READY',
    firstAdopter: 'youtube',
    youtubeStatus: 'READY_FOR_LIVE_AUDIT',
    descriptor,
    identities,
    exactLiveCommand: [
      'MKT_META_REMOTE_LOCK_RELEASED=true',
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
    console.log(JSON.stringify(buildYouTubeFirstAdopterPlan(process.env, process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      stage: 'multichannel-report-live-closure-terminal',
      code: error?.code ?? 'REPORT_LIVE_CLOSURE_TERMINAL_FAILED',
      message: error?.message ?? 'Multichannel Report Live Closure terminal failed',
      details: error?.details ?? {},
      remoteWriteCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }));
    process.exitCode = 2;
  }
}
