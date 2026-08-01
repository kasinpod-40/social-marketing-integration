#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  YOUTUBE_ACCEPTED_SOURCE_ENTITY_FLOOR,
  YOUTUBE_ORGANIC_METRIC_COUNT,
  YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION,
  YOUTUBE_REPORT_WINDOWS,
  assertYouTubeReportReadinessConfirmation,
  assessYouTubeReportLiveReadiness,
  parseYouTubeReportReadinessArgs,
} from './lib/youtube-report-live-readiness-audit.js';

let stage = 'init';

try {
  const options = parseYouTubeReportReadinessArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeAssessment();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'YOUTUBE_REPORT_READINESS_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    remoteMutationCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'youtube_report_live_readiness_audit_v1',
    command: `CONFIRM_YOUTUBE_REPORT_READINESS_AUDIT=${YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION} MKT_YOUTUBE_REPORT_READINESS_INPUT=<sanitized-read-only-evidence.json> node scripts/youtube-report-live-readiness-audit.mjs --execute`,
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
      platformScope: 'youtube',
    },
    windows: YOUTUBE_REPORT_WINDOWS,
    expectedMetricRowsPerWindow: YOUTUBE_ORGANIC_METRIC_COUNT,
    expectedMetricRowsTotal: YOUTUBE_ORGANIC_METRIC_COUNT * YOUTUBE_REPORT_WINDOWS.length,
    acceptedSourceEntityFloor: YOUTUBE_ACCEPTED_SOURCE_ENTITY_FLOOR,
    inputContract: 'sanitized read-only Repository/Worker/D1/Lark evidence only',
    remoteCollectorImplemented: false,
    remoteExecutionAuthorized: false,
    liveMaterializationAuthorized: false,
    remoteMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeAssessment() {
  stage = 'confirmation';
  assertYouTubeReportReadinessConfirmation(process.env);
  stage = 'read-sanitized-evidence';
  const inputPath = requireInputPath(process.env.MKT_YOUTUBE_REPORT_READINESS_INPUT);
  const raw = await readFile(inputPath, 'utf8');
  const evidence = JSON.parse(raw);
  stage = 'assess-readiness';
  const result = assessYouTubeReportLiveReadiness(evidence);
  process.stdout.write(`${JSON.stringify({ ok: result.readyForLive, ...result }, null, 2)}\n`);
  if (!result.readyForLive) process.exitCode = 2;
}

function requireInputPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error('MKT_YOUTUBE_REPORT_READINESS_INPUT is required for --execute');
    error.code = 'YOUTUBE_REPORT_READINESS_INPUT_REQUIRED';
    throw error;
  }
  return resolve(value.trim());
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|table.?id|queue.?id|database.?id|uuid)/iu.test(key))
    .map(([key, entry]) => [key, sanitize(entry)]));
}
