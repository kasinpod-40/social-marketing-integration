#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readDevVars } from './lib/dev-vars.js';
import { extractWranglerD1Rows } from './lib/tiktok-durable-recovery-operator.js';
import {
  TIKTOK_RESOLVED_GENERATION_ALERTS,
  TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION,
  TIKTOK_RESOLVED_GENERATION_ALERT_CLOSEOUT_VERSION,
  assertTikTokResolvedGenerationAlertConfirmation,
  buildTikTokResolvedGenerationAlertClosureSql,
  buildTikTokResolvedGenerationAlertEvidenceSql,
  validateTikTokResolvedGenerationAlertClosureRow,
  validateTikTokResolvedGenerationAlertEvidence,
} from './lib/tiktok-resolved-generation-alert-closeout.js';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const incidentName = args.find((value) => value.startsWith('--incident='))?.slice('--incident='.length) ?? 'current';
const incident = TIKTOK_RESOLVED_GENERATION_ALERTS[incidentName];
const invalidArgs = args.filter((value) => value !== '--execute' && !value.startsWith('--incident='));

try {
  if (invalidArgs.length > 0) throw operatorError('Unsupported argument', 'TIKTOK_ALERT_CLOSEOUT_ARGUMENT_INVALID');
  if (!incident) throw operatorError('Unsupported exact incident', 'TIKTOK_ALERT_CLOSEOUT_INCIDENT_INVALID');
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: 'plan',
      contractVersion: TIKTOK_RESOLVED_GENERATION_ALERT_CLOSEOUT_VERSION,
      classification: 'resolved_by_new_generation',
      alertId: incident.alertId,
      exactAlertUpdates: 0,
      queueActions: 0,
      dlqActions: 0,
      replayActions: 0,
      production: 'BLOCKED',
      nextCommand: `CONFIRM_TIKTOK_RESOLVED_GENERATION_ALERT=${TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION} node scripts/tiktok-resolved-generation-alert-closeout.mjs --incident=${incidentName} --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }

  const root = resolve(process.cwd());
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? resolve(root, '.dev.vars'));
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertTikTokResolvedGenerationAlertConfirmation(env.CONFIRM_TIKTOK_RESOLVED_GENERATION_ALERT);
  const configPath = resolve(env.WRANGLER_CONFIG ?? resolve(root, 'wrangler.sync.jsonc'));
  const wranglerEnv = buildWranglerOAuthEnvironment(env);

  const before = readOneRow(runD1(wranglerEnv, configPath, buildTikTokResolvedGenerationAlertEvidenceSql(incident)));
  const decision = validateTikTokResolvedGenerationAlertEvidence(before, incident);
  if (decision.alreadyResolved) {
    process.stdout.write(`${JSON.stringify(summary('already_resolved', 0), null, 2)}\n`);
    process.exit(0);
  }

  const closure = readOneRow(runD1(wranglerEnv, configPath, buildTikTokResolvedGenerationAlertClosureSql(Date.now(), incident)));
  validateTikTokResolvedGenerationAlertClosureRow(closure);
  const after = readOneRow(runD1(wranglerEnv, configPath, buildTikTokResolvedGenerationAlertEvidenceSql(incident)));
  const verified = validateTikTokResolvedGenerationAlertEvidence(after, incident);
  if (!verified.alreadyResolved) throw operatorError('Alert closeout did not converge', 'TIKTOK_ALERT_CLOSEOUT_VERIFY_FAILED');
  process.stdout.write(`${JSON.stringify(summary('resolved_by_new_generation', 1), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'TIKTOK_ALERT_CLOSEOUT_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    queueActions: 0,
    dlqActions: 0,
    replayActions: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function runD1(env, configPath, sql) {
  const result = spawnSync('npx', [
    'wrangler', 'd1', 'execute', 'social-mkt-state-dev', '--remote', '--json',
    '--config', configPath, '--command', sql,
  ], { cwd: process.cwd(), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw operatorError('Wrangler D1 command failed', 'TIKTOK_ALERT_CLOSEOUT_D1_FAILED', {
      exitCode: result.status ?? null,
      spawnErrorCode: result.error?.code ?? null,
    });
  }
  return extractWranglerD1Rows(result.stdout);
}

function readOneRow(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw operatorError('Expected exactly one D1 result row', 'TIKTOK_ALERT_CLOSEOUT_D1_SHAPE_INVALID', {
      rowCount: Array.isArray(rows) ? rows.length : null,
    });
  }
  return rows[0];
}

function summary(decision, exactAlertUpdates) {
  return Object.freeze({
    ok: true,
    decision,
    contractVersion: TIKTOK_RESOLVED_GENERATION_ALERT_CLOSEOUT_VERSION,
    classification: 'resolved_by_new_generation',
    alertId: incident.alertId,
    exactAlertUpdates,
    queueActions: 0,
    dlqActions: 0,
    replayActions: 0,
    workerDeployments: 0,
    scheduleChanges: 0,
    production: 'BLOCKED',
  });
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
