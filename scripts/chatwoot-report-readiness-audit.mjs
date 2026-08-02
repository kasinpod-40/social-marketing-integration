#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CHATWOOT_REPORT_READINESS_CONFIRMATION,
  assessChatwootReportReadiness,
  assertChatwootReportReadinessConfirmation,
  parseChatwootReportReadinessArgs,
  sanitizeChatwootReadinessEvidence,
} from './lib/chatwoot-report-readiness-audit.js';

let stage = 'init';
try {
  const options = parseChatwootReportReadinessArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeAudit();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'CHATWOOT_REPORT_READINESS_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeChatwootReadinessEvidence(error?.details ?? {}),
    remoteMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'chatwoot_report_readiness_audit_v1',
    command: `CONFIRM_CHATWOOT_REPORT_READINESS_AUDIT=${CHATWOOT_REPORT_READINESS_CONFIRMATION} MKT_CHATWOOT_REPORT_READINESS_INPUT=<sanitized-evidence.json> node scripts/chatwoot-report-readiness-audit.mjs --execute`,
    windows: [1, 3, 7, 30],
    expectedMetricCount: 139,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    catalogPromotionAuthorized: false,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeAudit() {
  stage = 'confirmation';
  assertChatwootReportReadinessConfirmation(process.env);
  stage = 'load-evidence';
  const path = resolve(requireText(
    process.env.MKT_CHATWOOT_REPORT_READINESS_INPUT,
    'MKT_CHATWOOT_REPORT_READINESS_INPUT',
  ));
  const evidence = JSON.parse(await readFile(path, 'utf8'));
  stage = 'assess';
  const assessment = assessChatwootReportReadiness(evidence);
  const summary = sanitizeChatwootReadinessEvidence({
    ok: assessment.promotionReady,
    evidence,
    assessment,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!assessment.promotionReady) process.exitCode = 2;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${field} is required`);
    error.code = 'CHATWOOT_REPORT_READINESS_INPUT_PATH_REQUIRED';
    throw error;
  }
  return value.trim();
}
