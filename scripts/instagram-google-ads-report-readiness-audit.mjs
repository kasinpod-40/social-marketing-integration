#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  INSTAGRAM_GOOGLE_ADS_CHANNELS,
  INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION,
  INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS,
  assertInstagramGoogleAdsReadinessConfirmation,
  assessInstagramGoogleAdsReadiness,
  parseInstagramGoogleAdsReadinessArgs,
} from './lib/instagram-google-ads-report-readiness-audit.js';

let stage = 'init';

try {
  const options = parseInstagramGoogleAdsReadinessArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeAssessment();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'INSTAGRAM_GOOGLE_ADS_READINESS_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    remoteMutationCount: 0,
    providerRequestCount: 0,
    signedDeliveryReplayCount: 0,
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
    contractVersion: 'instagram_google_ads_report_readiness_audit_v1',
    command: `CONFIRM_INSTAGRAM_GOOGLE_ADS_READINESS_AUDIT=${INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION} MKT_INSTAGRAM_GOOGLE_ADS_READINESS_INPUT=<sanitized-read-only-evidence.json> node scripts/instagram-google-ads-report-readiness-audit.mjs --execute`,
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
    },
    channels: INSTAGRAM_GOOGLE_ADS_CHANNELS,
    windows: INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS,
    independentDecisions: true,
    inputContract: 'sanitized read-only Repository/Worker/D1/Lark evidence only',
    remoteCollectorImplemented: false,
    catalogPromotionAuthorized: false,
    remoteMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeAssessment() {
  stage = 'confirmation';
  assertInstagramGoogleAdsReadinessConfirmation(process.env);
  stage = 'read-sanitized-evidence';
  const inputPath = requireInputPath(process.env.MKT_INSTAGRAM_GOOGLE_ADS_READINESS_INPUT);
  const evidence = JSON.parse(await readFile(inputPath, 'utf8'));
  stage = 'assess-readiness';
  const result = assessInstagramGoogleAdsReadiness(evidence);
  const allReady = result.promotionReadyCount === INSTAGRAM_GOOGLE_ADS_CHANNELS.length;
  process.stdout.write(`${JSON.stringify({ ok: allReady, ...result }, null, 2)}\n`);
  if (!allReady) process.exitCode = 2;
}

function requireInputPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error('MKT_INSTAGRAM_GOOGLE_ADS_READINESS_INPUT is required for --execute');
    error.code = 'INSTAGRAM_GOOGLE_ADS_READINESS_INPUT_REQUIRED';
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
