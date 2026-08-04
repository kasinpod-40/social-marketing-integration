#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  reviewYouTubeSharedReportCloseoutOperator,
} from './lib/youtube-shared-report-closeout-review.js';
import {
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';

export const YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONFIRMATION =
  'RUN_YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW';

export function parseYouTubeSharedCloseoutReviewArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw terminalError(
    `Unsupported YouTube shared closeout review arguments: ${unknown.join(', ')}`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_ARGUMENT_INVALID',
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export async function runYouTubeSharedCloseoutReview(input = {}) {
  const env = input.env ?? {};
  const options = parseYouTubeSharedCloseoutReviewArgs(input.argv ?? []);
  if (!options.execute) return Object.freeze({
    ok: true,
    planOnly: true,
    contractVersion: 'youtube_shared_report_closeout_review_terminal_v1',
    command: [
      `CONFIRM_YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW=${YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONFIRMATION}`,
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json>',
      'MKT_YOUTUBE_SHARED_REPORT_CLOSEOUT_REQUESTED_AT=<epoch-ms>',
      'node scripts/youtube-shared-report-closeout-review.mjs --execute',
    ].join(' \\\n'),
    remoteReadCount: 0,
    remoteMutationCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  });

  if (env.CONFIRM_YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW
    !== YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONFIRMATION) throw terminalError(
    `Execution requires CONFIRM_YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW=${YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONFIRMATION}`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONFIRMATION_REQUIRED',
  );
  const path = resolve(requireText(
    env.MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF,
    'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF',
  ));
  let handoff;
  try {
    handoff = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw terminalError(
      'Unable to load retained Multichannel Report Live Closure handoff',
      'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_HANDOFF_LOAD_FAILED',
      { sourceCode: error?.code ?? null },
    );
  }
  return reviewYouTubeSharedReportCloseoutOperator({
    handoff,
    requestedAt: requireTimestamp(
      env.MKT_YOUTUBE_SHARED_REPORT_CLOSEOUT_REQUESTED_AT,
      'MKT_YOUTUBE_SHARED_REPORT_CLOSEOUT_REQUESTED_AT',
    ),
  });
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw terminalError(
    `${field} is required`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return value.trim();
}
function requireTimestamp(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw terminalError(
    `${field} must be an epoch millisecond`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return number;
}
function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeSharedReportCloseoutReviewTerminalError';
  error.code = code;
  error.details = details;
  return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await runYouTubeSharedCloseoutReview({
      env: process.env,
      argv: process.argv.slice(2),
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      stage: 'youtube-shared-report-closeout-review',
      code: error?.code ?? 'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_FAILED',
      message: error?.message ?? 'YouTube shared Report closeout review failed',
      details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
      remoteReadCount: 0,
      remoteMutationCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      production: 'BLOCKED',
    }));
    process.exitCode = 2;
  }
}
