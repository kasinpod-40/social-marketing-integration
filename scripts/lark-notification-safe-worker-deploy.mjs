#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  compareLarkNotificationSafeDeployWindow,
  validateLarkNotificationCurrentSchemaState,
  validateLarkNotificationDormantWorkSchemaReadbackRow,
} from './lib/lark-notification-dormant-work-authority.js';
import {
  LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION,
  LARK_NOTIFICATION_REMOTE_INDEXES,
  LARK_NOTIFICATION_REMOTE_ROLLOUT_CONTRACT_VERSION,
  auditLarkNotificationMigrationSource,
  buildLarkNotificationRemoteSchemaReadbackSql,
  createLarkNotificationRemoteTargetFingerprint,
  extractLarkNotificationWranglerD1Rows,
  loadLarkNotificationRemoteRolloutTarget,
  sha256Hex,
  validateLarkNotificationBackupEvidence,
  validateLarkNotificationNoPendingMigrations,
  validateLarkNotificationRemoteWranglerConfig,
} from './lib/lark-notification-remote-rollout-operator.js';
import {
  LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION,
  assertLarkNotificationSafeWorkerDeployConfirmation,
  parseLarkNotificationDeploymentStatus,
  parseLarkNotificationSafeWorkerDeployArgs,
  validateLarkNotificationSafeWorkerDeployEvidence,
} from './lib/lark-notification-safe-worker-deploy.js';
import {
  parseWranglerDeploymentOutput,
} from './lib/tiktok-post-lark-rollout-operator.js';

const REQUIRED_BASELINE = 'f82055177270380604f3eca97699beae81771629';
const WORKER_NAME = 'social-mkt-sync-worker';
const MIGRATION_FILE = resolve('migrations/0019_lark_notification_delivery.sql');
const EVIDENCE_ROOT = resolve(
  process.env.MKT_NOTIFICATION_ROLLOUT_EVIDENCE_DIR
    ?? 'outputs/lark-notification-remote-rollout',
);

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const mode = parseLarkNotificationSafeWorkerDeployArgs(process.argv.slice(2));
  if (mode.execute !== true) {
    printPlan();
    return;
  }

  const fileEnv = await readDevVars();
  const env = {
    MKT_NOTIFICATION_ROLLOUT_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_NOTIFICATION_ROLLOUT_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    ...fileEnv,
    ...process.env,
  };
  assertLarkNotificationSafeWorkerDeployConfirmation(env);
  const target = loadLarkNotificationRemoteRolloutTarget(env);
  await mkdir(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const result = await deploySafeWorker(target, env);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    phase: 'deploy-safe',
    evidenceRoot: EVIDENCE_ROOT,
    ...result,
  }, null, 2)}\n`);
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    phase: 'deploy-safe',
    confirmation: LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION,
    requiredBaseline: REQUIRED_BASELINE,
    requiredEvidence: [
      'preflight.json',
      'backup.json',
      'migrate.json',
      'schema-readback.json',
    ],
    safety: {
      notificationRuntimeEnabled: false,
      notificationSendEnabled: false,
      notificationMirrorEnabled: false,
      queueSend: false,
      larkWrite: false,
      notificationSend: false,
      automationActivation: false,
      scheduleActivation: false,
      production: false,
    },
    note: 'Plan only. Execution validates the retained Migration evidence, snapshots current Remote state immediately before deployment, performs one all-false Worker deploy, verifies the exact version at 100 percent traffic, and validates notification invariants again.',
  }, null, 2)}\n`);
}

async function deploySafeWorker(target, env) {
  assertRepositoryState();
  const [preflight, backup, migrate, schemaReadback, local] = await Promise.all([
    requirePassedEvidence('preflight'),
    requirePassedEvidence('backup'),
    requirePassedEvidence('migrate'),
    requirePassedEvidence('schema-readback'),
    loadReviewedLocalState(target, env),
  ]);
  await validateEvidenceChain({
    preflight,
    backup,
    migrate,
    schemaReadback,
    local,
  });

  runCommand('node', [
    '--test',
    'tests/application/lark-notification-safe-worker-deploy.test.js',
    'tests/application/lark-notification-active-job-router.test.js',
    'tests/connectors/d1-lark-notification-delivery-store.test.js',
  ]);
  runCommand('npx', ['wrangler', 'whoami']);
  runCommand('npx', [
    'wrangler', 'deploy', '--dry-run', '--config', target.wranglerConfig,
  ]);

  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateLarkNotificationNoPendingMigrations(migrations.stdout);

  // Historical preflight counts are intentionally not reused here. Meta and
  // Report closeout may legitimately advance Business facts after Migration
  // read-back. The deploy gate uses a fresh lock-free snapshot immediately
  // before deployment and validates notification-specific invariants again
  // immediately afterwards.
  const before = readCurrentRemoteSchemaState(target);

  const outputFile = join(
    tmpdir(),
    `mkt-lark-notification-safe-deploy-${randomUUID()}.ndjson`,
  );
  const deploymentStartedAt = new Date().toISOString();
  let deploymentCompletedAt = null;
  let deploymentVersionId = null;
  try {
    runCommand('npx', [
      'wrangler', 'deploy', '--config', target.wranglerConfig,
    ], {
      env: { WRANGLER_OUTPUT_FILE_PATH: outputFile },
    });
    deploymentCompletedAt = new Date().toISOString();
    const structuredOutput = await readFile(outputFile, 'utf8');
    deploymentVersionId = parseDeploymentIdentity(structuredOutput);

    const deploymentStatus = runCommand('npx', [
      'wrangler', 'deployments', 'status',
      '--config', target.wranglerConfig,
      '--json',
    ]);
    const active = parseLarkNotificationDeploymentStatus(
      deploymentStatus.stdout,
      deploymentVersionId,
    );

    const after = readCurrentRemoteSchemaState(target);
    const deployWindow = compareLarkNotificationSafeDeployWindow(
      before,
      after,
      LARK_NOTIFICATION_REMOTE_INDEXES.length,
    );
    const evidence = {
      contractVersion: LARK_NOTIFICATION_REMOTE_ROLLOUT_CONTRACT_VERSION,
      phase: 'deploy-safe',
      status: 'passed',
      capturedAt: new Date().toISOString(),
      repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
      targetFingerprint: local.targetFingerprint,
      configSha256: local.configSha256,
      migration: LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION,
      migrationSha256: local.migration.sha256,
      deploymentStartedAt,
      deploymentCompletedAt,
      deploymentVersionId,
      activeVersionId: active.activeVersionId,
      trafficPercentage: active.trafficPercentage,
      notificationFlagsAllFalse: local.config.notificationFlagsAllFalse,
      notificationFlagSourcePolicy: local.config.notificationFlagSourcePolicy,
      remoteStateComparedTo: 'fresh_pre_deploy_snapshot',
      retainedActiveWorkCountBefore: deployWindow.before.active_work,
      retainedActiveWorkCountAfter: deployWindow.after.active_work,
      activeLocksBefore: deployWindow.before.active_locks,
      activeLocksAfter: deployWindow.after.active_locks,
      notificationSchemaDrift: false,
      externalStateChangeObserved: deployWindow.externalStateChangeObserved,
      externalStateChangedFields: deployWindow.externalStateChangedFields,
      queueSendCount: 0,
      larkWriteCount: 0,
      notificationSendCount: 0,
      automationActivationCount: 0,
      scheduleActivationCount: 0,
      production: 'BLOCKED',
    };
    validateLarkNotificationSafeWorkerDeployEvidence(evidence);
    await saveEvidence('deploy-safe', evidence);
    return {
      evidenceFile: evidencePath('deploy-safe'),
      deploymentVersionId,
      trafficPercentage: active.trafficPercentage,
      notificationFlagsAllFalse: true,
      retainedActiveWorkCount: deployWindow.after.active_work,
      activeLocks: deployWindow.after.active_locks,
      notificationSchemaDrift: false,
      externalStateChangeObserved: deployWindow.externalStateChangeObserved,
      externalStateChangedFields: deployWindow.externalStateChangedFields,
      nextGate: 'controlled_uat_requires_separate_approval',
    };
  } catch (error) {
    deploymentCompletedAt ??= new Date().toISOString();
    await saveEvidence('deploy-safe-failure', {
      contractVersion: LARK_NOTIFICATION_REMOTE_ROLLOUT_CONTRACT_VERSION,
      phase: 'deploy-safe',
      status: 'failed',
      capturedAt: new Date().toISOString(),
      targetFingerprint: local.targetFingerprint,
      deploymentStartedAt,
      deploymentCompletedAt,
      deploymentVersionId,
      notificationFlagsAllFalse: local.config.notificationFlagsAllFalse,
      errorCode: error?.code ?? 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_FAILED',
      automaticRetryForbidden: true,
      queueSendCount: 0,
      larkWriteCount: 0,
      notificationSendCount: 0,
      automationActivationCount: 0,
      scheduleActivationCount: 0,
    });
    throw error;
  } finally {
    await rm(outputFile, { force: true });
  }
}

async function loadReviewedLocalState(target, env) {
  await Promise.all([
    requireReadableFile(target.wranglerConfig),
    requireReadableFile(MIGRATION_FILE),
  ]);
  const [configText, migrationText] = await Promise.all([
    readFile(target.wranglerConfig, 'utf8'),
    readFile(MIGRATION_FILE, 'utf8'),
  ]);
  const config = validateLarkNotificationRemoteWranglerConfig(configText, env);
  const migration = auditLarkNotificationMigrationSource(migrationText);
  return Object.freeze({
    config,
    configSha256: sha256Hex(configText),
    migration,
    targetFingerprint: createLarkNotificationRemoteTargetFingerprint(target, config),
  });
}

async function validateEvidenceChain(input) {
  const { preflight, backup, migrate, schemaReadback, local } = input;
  const valid = preflight.contractVersion === LARK_NOTIFICATION_REMOTE_ROLLOUT_CONTRACT_VERSION
    && preflight.targetFingerprint === local.targetFingerprint
    && preflight.migration?.sha256 === local.migration.sha256
    && backup.targetFingerprint === local.targetFingerprint
    && backup.migrationSha256 === local.migration.sha256
    && migrate.targetFingerprint === local.targetFingerprint
    && migrate.migrationSha256 === local.migration.sha256
    && schemaReadback.targetFingerprint === local.targetFingerprint
    && schemaReadback.migrationSha256 === local.migration.sha256;
  if (!valid) {
    throw deployError(
      'Lark notification safe Worker deploy evidence does not match the reviewed target and Migration',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_EVIDENCE_INVALID',
    );
  }
  validateLarkNotificationBackupEvidence(
    backup,
    await readFile(backup.backupFile),
  );
  // The retained evidence remains the authority that Migration 0019 was
  // applied without drift at that moment. Current live counts are validated
  // separately using a fresh snapshot immediately around deployment.
  validateLarkNotificationDormantWorkSchemaReadbackRow(
    schemaReadback.remote,
    preflight.remote,
    LARK_NOTIFICATION_REMOTE_INDEXES.length,
  );
}

function readCurrentRemoteSchemaState(target) {
  const query = runD1Query(target, buildLarkNotificationRemoteSchemaReadbackSql());
  return validateLarkNotificationCurrentSchemaState(
    extractLarkNotificationWranglerD1Rows(query.stdout)[0],
    LARK_NOTIFICATION_REMOTE_INDEXES.length,
  );
}

function parseDeploymentIdentity(output) {
  try {
    return parseWranglerDeploymentOutput(output, { workerName: WORKER_NAME })
      .deploymentVersionId;
  } catch {
    throw deployError(
      'Wrangler safe Worker deployment identity is unavailable',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_ID_UNAVAILABLE',
    );
  }
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw deployError(
      'Lark notification safe Worker deploy must run from main',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_REPOSITORY_INVALID',
      { branch },
    );
  }
  runCommand('git', ['merge-base', '--is-ancestor', REQUIRED_BASELINE, 'HEAD']);
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw deployError(
      'Lark notification safe Worker deploy requires a clean Git working tree',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_REPOSITORY_INVALID',
      { dirtyPaths: dirty.split(/\r?\n/u) },
    );
  }
}

function runD1Query(target, sql) {
  return runCommand('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
    '--command', sql,
    '--json',
  ]);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw deployError(
      `Command failed: ${command}`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_COMMAND_FAILED',
      {
        command,
        args: sanitizeCommandArgs(args),
        status: result.status,
      },
    );
  }
  return Object.freeze({
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  });
}

function sanitizeCommandArgs(args) {
  return args.map((arg, index) => (
    args[index - 1] === '--command' ? '[READ_ONLY_SQL_REDACTED]' : arg
  ));
}

function readCommand(command, args) {
  return runCommand(command, args).stdout;
}

async function requireReadableFile(path) {
  await access(path, constants.R_OK);
}

async function saveEvidence(name, value) {
  await writeFile(evidencePath(name), `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function requirePassedEvidence(name) {
  let value;
  try {
    value = JSON.parse(await readFile(evidencePath(name), 'utf8'));
  } catch (cause) {
    throw deployError(
      `Lark notification rollout evidence is missing: ${name}`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_EVIDENCE_MISSING',
      { phase: name, cause: cause?.code ?? 'READ_FAILED' },
    );
  }
  if (value?.phase !== name || value?.status !== 'passed') {
    throw deployError(
      `Lark notification rollout evidence is not passed: ${name}`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_EVIDENCE_INVALID',
      { phase: name },
    );
  }
  return value;
}

function evidencePath(name) {
  return join(EVIDENCE_ROOT, `${name}.json`);
}

function deployError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationSafeWorkerDeployError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
