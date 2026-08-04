#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  getReportPlatformContract,
} from '../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  loadReviewedHandoff,
} from './multichannel-report-live-closure-terminal.mjs';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  REPORT_ALL_READY_CHANNELS_CONFIRMATION,
  REPORT_ALL_READY_CHANNELS_CONTRACT,
  resolveRunAllChannelAuthority,
  selectAllReadyReportChannels,
} from './lib/report-all-ready-channels.js';

const execFileAsync = promisify(execFile);

export function parseReportAllReadyArgs(argv = []) {
  const unknown = argv.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) throw terminalError(
    `Unsupported Run All Report argument: ${unknown.join(', ')}`,
    'REPORT_ALL_READY_CHANNELS_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export async function runAllReadyChannelReports(input = {}) {
  const env = input.env ?? {};
  const options = parseReportAllReadyArgs(input.argv ?? []);
  if (!options.execute) return buildPlan();
  if (env.CONFIRM_REPORT_ALL_READY_CHANNELS !== REPORT_ALL_READY_CHANNELS_CONFIRMATION) {
    throw terminalError(
      `Execution requires CONFIRM_REPORT_ALL_READY_CHANNELS=${REPORT_ALL_READY_CHANNELS_CONFIRMATION}`,
      'REPORT_ALL_READY_CHANNELS_CONFIRMATION_REQUIRED',
    );
  }

  const handoff = input.handoff ?? await loadReviewedHandoff(env);
  const selection = selectAllReadyReportChannels({ handoff });
  if (selection.readyCount === 0) throw terminalError(
    'No reviewed channel is ready for Report materialization',
    'REPORT_ALL_READY_CHANNELS_NONE_READY',
    { waiting: selection.waiting },
  );

  const executeChannel = input.executeChannel ?? executeReviewedChannel;
  const completed = [];
  for (const channel of selection.ready) {
    const result = await executeChannel({
      env,
      handoff,
      channel,
      authority: resolveRunAllChannelAuthority(handoff, channel.platformScope),
    });
    if (!result || typeof result !== 'object' || result.ok !== true) throw terminalError(
      `Shared Report closeout failed for ${channel.platformScope}`,
      'REPORT_ALL_READY_CHANNELS_CHANNEL_FAILED',
      { platformScope: channel.platformScope },
    );
    completed.push(Object.freeze({
      platformScope: channel.platformScope,
      capability: channel.capability,
      status: result.status ?? result.mode ?? 'completed',
    }));
  }

  return Object.freeze(sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: REPORT_ALL_READY_CHANNELS_CONTRACT,
    mode: 'EXECUTED',
    completed: Object.freeze(completed),
    waiting: selection.waiting,
    completedCount: completed.length,
    waitingCount: selection.waitingCount,
    windows: REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
    providerRequestCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }));
}

function buildPlan() {
  return Object.freeze({
    ok: true,
    planOnly: true,
    contractVersion: REPORT_ALL_READY_CHANNELS_CONTRACT,
    reviewedChannels: Object.freeze(REPORT_RUNTIME_REVIEWED_CHANNELS.map((platformScope) => {
      const contract = getReportPlatformContract(platformScope);
      return Object.freeze({
        platformScope,
        capability: contract.capability,
        sourceStatus: contract.sourceStatus,
      });
    })),
    behavior: Object.freeze({
      ready: 'materialize_sequentially_with_existing_shared_closeout',
      notReady: 'skip_with_reason',
      planned: 'skip_without_fabricating_report',
      failure: 'stop_after_existing_channel_safe_restore',
    }),
    windows: REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
    exactCommand: [
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-all-channel-handoff.json>',
      `CONFIRM_REPORT_ALL_READY_CHANNELS=${REPORT_ALL_READY_CHANNELS_CONFIRMATION}`,
      'node scripts/report-all-ready-channels-terminal.mjs --execute',
    ].join(' \\\n'),
    remoteReadCount: 0,
    remoteWriteCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

async function executeReviewedChannel({ env, handoff, channel, authority }) {
  const directory = await mkdtemp(join(tmpdir(), `report-run-all-${channel.platformScope}-`));
  try {
    const handoffPath = join(directory, 'handoff.json');
    const channelHandoff = Object.freeze({
      ...handoff,
      closeoutAuthority: authority,
    });
    await writeFile(handoffPath, `${JSON.stringify(channelHandoff, null, 2)}\n`, { mode: 0o600 });
    await chmod(handoffPath, 0o600);
    const result = await execFileAsync(process.execPath, [
      'scripts/multichannel-report-live-closure-terminal.mjs',
      `--platform=${channel.platformScope}`,
      `--capability=${channel.capability}`,
      '--execute',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: channel.platformScope,
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
        CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE:
          MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseJson(result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseJson(value) {
  const text = String(value ?? '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  throw terminalError(
    'Shared Report closeout returned invalid JSON',
    'REPORT_ALL_READY_CHANNELS_JSON_INVALID',
  );
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportAllReadyChannelsTerminalError';
  error.code = code;
  error.details = details;
  return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await runAllReadyChannelReports({
      env: process.env,
      argv: process.argv.slice(2),
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      stage: 'report-all-ready-channels',
      code: error?.code ?? 'REPORT_ALL_READY_CHANNELS_FAILED',
      message: error?.message ?? 'Run All Report failed',
      details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
      providerRequestCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }));
    process.exitCode = 2;
  }
}
