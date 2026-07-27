#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CHATWOOT_REMOTE_EXPECTED_MIGRATION,
  CHATWOOT_REMOTE_READINESS_CONFIRMATIONS,
  CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
  CHATWOOT_REMOTE_READINESS_PHASES,
  assertChatwootRemoteReadinessConfirmation,
  auditChatwootMigrationSource,
  buildChatwootRemotePreflightSql,
  buildChatwootRemoteSchemaReadbackSql,
  createChatwootRemoteTargetFingerprint,
  extractChatwootWranglerD1Rows,
  loadChatwootRemoteReadinessTarget,
  parseChatwootRemoteReadinessArgs,
  sha256Hex,
  validateChatwootBackupEvidence,
  validateChatwootNoPendingMigrations,
  validateChatwootPendingMigrations,
  validateChatwootRemotePreflightRow,
  validateChatwootRemoteSchemaReadbackRow,
  validateChatwootRemoteWranglerConfig,
} from './lib/chatwoot-remote-readiness-operator.js';

const REQUIRED_BASELINE = 'f3e330339b114536c3a1a9ee7567abf5a76fa78b';
const MIGRATION_FILE = resolve('migrations/0018_chatwoot_analytics.sql');
const EVIDENCE_ROOT = resolve(
  process.env.MKT_CHATWOOT_READINESS_EVIDENCE_DIR
    ?? 'outputs/chatwoot-remote-readiness',
);

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_REMOTE_READINESS_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const mode = parseChatwootRemoteReadinessArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    printPlan(mode);
    return;
  }

  const target = loadChatwootRemoteReadinessTarget(process.env);
  assertChatwootRemoteReadinessConfirmation(mode.phase, process.env);
  await mkdir(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const result = await runPhase(mode.phase, target);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    phase: mode.phase,
    evidenceRoot: EVIDENCE_ROOT,
    ...result,
  }, null, 2)}\n`);
}

function printPlan(mode) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    requestedPhase: mode.phase === 'plan' ? null : mode.phase,
    contractVersion: CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
    requiredBaseline: REQUIRED_BASELINE,
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    phases: CHATWOOT_REMOTE_READINESS_PHASES,
    confirmations: CHATWOOT_REMOTE_READINESS_CONFIRMATIONS,
    evidenceRoot: EVIDENCE_ROOT,
    safety: {
      defaultMode: 'plan_only',
      providerRequest: false,
      tokenRead: false,
      queueSend: false,
      dlqAction: false,
      larkMutation: false,
      workerDeployment: false,
      scheduleOrWebhookActivation: false,
      production: false,
    },
    note: mode.phase === 'plan'
      ? 'Plan only. No Git, Wrangler, D1, Worker, Queue, Lark or Chatwoot command was executed.'
      : `Preview only. Re-run with --phase=${mode.phase} --execute and the exact phase confirmation.`,
  }, null, 2)}\n`);
}

async function runPhase(phase, target) {
  switch (phase) {
    case 'preflight': return runPreflight(target);
    case 'backup': return runBackup(target);
    case 'migrate': return runMigration(target);
    case 'schema-readback': return runSchemaReadback(target);
    default: throw operatorError(
      `Unsupported executable Chatwoot readiness phase: ${phase}`,
      'CHATWOOT_REMOTE_READINESS_PHASE_INVALID',
    );
  }
}

async function loadReviewedLocalState(target) {
  await Promise.all([
    requireReadableFile(target.wranglerConfig),
    requireReadableFile(MIGRATION_FILE),
  ]);
  const [configText, migrationText] = await Promise.all([
    readFile(target.wranglerConfig, 'utf8'),
    readFile(MIGRATION_FILE, 'utf8'),
  ]);
  const config = validateChatwootRemoteWranglerConfig(configText);
  const migration = auditChatwootMigrationSource(migrationText);
  const targetFingerprint = createChatwootRemoteTargetFingerprint(target, config);
  return Object.freeze({
    config,
    configSha256: sha256Hex(configText),
    migration,
    targetFingerprint,
  });
}

async function runPreflight(target) {
  assertRepositoryState();
  const local = await loadReviewedLocalState(target);

  runCommand('npm', ['run', 'check']);
  runCommand('node', [
    '--test',
    'tests/application/chatwoot-remote-readiness-operator.test.js',
    'tests/application/chatwoot-runtime-wiring.test.js',
  ]);
  runCommand('npm', ['run', 'deploy:dry-run']);
  runCommand('npx', ['wrangler', 'whoami']);
  runCommand('npx', [
    'wrangler', 'd1', 'info', target.databaseName,
    '--config', target.wranglerConfig,
    '--json',
  ]);

  const [migrations, secrets, query] = [
    runCommand('npx', [
      'wrangler', 'd1', 'migrations', 'list', target.databaseName,
      '--remote',
      '--config', target.wranglerConfig,
    ]),
    runCommand('npx', [
      'wrangler', 'secret', 'list',
      '--config', target.wranglerConfig,
      '--json',
    ]),
    runD1Query(target, buildChatwootRemotePreflightSql()),
  ];
  const pendingMigrations = validateChatwootPendingMigrations(migrations.stdout);
  const secretNames = extractSecretNames(secrets.stdout);
  const remote = validateChatwootRemotePreflightRow(
    extractChatwootWranglerD1Rows(query.stdout)[0],
  );

  const evidence = {
    contractVersion: CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
    phase: 'preflight',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
    requiredBaseline: REQUIRED_BASELINE,
    targetFingerprint: local.targetFingerprint,
    configSha256: local.configSha256,
    migration: local.migration,
    pendingMigrations,
    remote,
    secretNameCount: secretNames.length,
    secretNameFingerprint: sha256Hex(JSON.stringify(secretNames)),
    chatwootTokenSecretPresent: secretNames.includes('CHATWOOT_API_ACCESS_TOKEN'),
    remoteMutationCount: 0,
    providerRequestCount: 0,
  };
  await saveEvidence('preflight', evidence);
  return {
    evidenceFile: evidencePath('preflight'),
    pendingMigrations,
    targetFingerprint: local.targetFingerprint,
    remote,
  };
}

async function runBackup(target) {
  assertRepositoryState();
  const preflight = await requirePassedEvidence('preflight');
  const local = await loadReviewedLocalState(target);
  assertEvidenceBinding(preflight, local);

  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateChatwootPendingMigrations(migrations.stdout);

  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, '');
  const backupFile = join(
    EVIDENCE_ROOT,
    `social-mkt-state-dev-before-0018-${timestamp}.sql`,
  );
  runCommand('npx', [
    'wrangler', 'd1', 'export', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
    '--output', backupFile,
    '--skip-confirmation',
  ]);
  await requireReadableFile(backupFile);
  const contents = await readFile(backupFile);
  if (contents.byteLength === 0) {
    throw operatorError(
      'Chatwoot Remote D1 backup is empty',
      'CHATWOOT_REMOTE_READINESS_BACKUP_EMPTY',
    );
  }
  const sha256 = createHash('sha256').update(contents).digest('hex');
  await writeFile(`${backupFile}.sha256`, `${sha256}  ${basename(backupFile)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const evidence = {
    contractVersion: CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
    phase: 'backup',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint: local.targetFingerprint,
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    migrationSha256: local.migration.sha256,
    backupFile,
    sizeBytes: contents.byteLength,
    sha256,
    remoteMutationCount: 0,
  };
  await saveEvidence('backup', evidence);
  return { evidenceFile: evidencePath('backup'), backupFile, sha256 };
}

async function runMigration(target) {
  assertRepositoryState();
  const [preflight, backup, local] = await Promise.all([
    requirePassedEvidence('preflight'),
    requirePassedEvidence('backup'),
    loadReviewedLocalState(target),
  ]);
  assertEvidenceBinding(preflight, local);
  if (backup.targetFingerprint !== local.targetFingerprint
      || backup.migrationSha256 !== local.migration.sha256) {
    throw operatorError(
      'Chatwoot backup evidence does not match the reviewed target or Migration source',
      'CHATWOOT_REMOTE_READINESS_EVIDENCE_MISMATCH',
    );
  }
  const backupContents = await readFile(backup.backupFile);
  validateChatwootBackupEvidence(backup, backupContents);

  const before = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateChatwootPendingMigrations(before.stdout);
  runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'apply', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ], { env: { CI: 'true' } });
  const after = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateChatwootNoPendingMigrations(after.stdout);

  const evidence = {
    contractVersion: CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
    phase: 'migrate',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint: local.targetFingerprint,
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    migrationSha256: local.migration.sha256,
    backup: {
      file: backup.backupFile,
      sizeBytes: backup.sizeBytes,
      sha256: backup.sha256,
    },
    pendingAfter: [],
    schemaReadbackRequired: true,
    providerRequestCount: 0,
    queueActionCount: 0,
    larkMutationCount: 0,
  };
  await saveEvidence('migrate', evidence);
  return {
    evidenceFile: evidencePath('migrate'),
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    schemaReadbackRequired: true,
  };
}

async function runSchemaReadback(target) {
  assertRepositoryState();
  const [preflight, backup, migrate, local] = await Promise.all([
    requirePassedEvidence('preflight'),
    requirePassedEvidence('backup'),
    requirePassedEvidence('migrate'),
    loadReviewedLocalState(target),
  ]);
  assertEvidenceBinding(preflight, local);
  if (backup.targetFingerprint !== local.targetFingerprint
      || migrate.targetFingerprint !== local.targetFingerprint
      || backup.migrationSha256 !== local.migration.sha256
      || migrate.migrationSha256 !== local.migration.sha256) {
    throw operatorError(
      'Chatwoot schema read-back evidence chain does not match the reviewed target',
      'CHATWOOT_REMOTE_READINESS_EVIDENCE_MISMATCH',
    );
  }
  validateChatwootBackupEvidence(backup, await readFile(backup.backupFile));

  const migrations = runCommand('npx', [
    'wrangler', 'd1', 'migrations', 'list', target.databaseName,
    '--remote',
    '--config', target.wranglerConfig,
  ]);
  validateChatwootNoPendingMigrations(migrations.stdout);
  const query = runD1Query(target, buildChatwootRemoteSchemaReadbackSql());
  const remote = validateChatwootRemoteSchemaReadbackRow(
    extractChatwootWranglerD1Rows(query.stdout)[0],
    preflight.remote,
  );

  const evidence = {
    contractVersion: CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
    phase: 'schema-readback',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    targetFingerprint: local.targetFingerprint,
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    migrationSha256: local.migration.sha256,
    remote,
    businessFactDrift: false,
    chatwootBusinessRowCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    larkMutationCount: 0,
  };
  await saveEvidence('schema-readback', evidence);
  return {
    evidenceFile: evidencePath('schema-readback'),
    remote,
    businessFactDrift: false,
  };
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw operatorError(
      'Chatwoot readiness operator must run from main',
      'CHATWOOT_REMOTE_READINESS_REPOSITORY_STATE_INVALID',
      { branch },
    );
  }
  runCommand('git', ['merge-base', '--is-ancestor', REQUIRED_BASELINE, 'HEAD']);
  const dirty = readCommand('git', ['status', '--porcelain']).trim();
  if (dirty) {
    throw operatorError(
      'Chatwoot readiness operator requires a clean Git working tree',
      'CHATWOOT_REMOTE_READINESS_REPOSITORY_STATE_INVALID',
      { dirtyPaths: dirty.split(/\r?\n/u) },
    );
  }
}

function assertEvidenceBinding(preflight, local) {
  if (preflight.contractVersion !== CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION
      || preflight.targetFingerprint !== local.targetFingerprint
      || preflight.migration?.sha256 !== local.migration.sha256
      || preflight.pendingMigrations?.length !== 1
      || preflight.pendingMigrations[0] !== CHATWOOT_REMOTE_EXPECTED_MIGRATION) {
    throw operatorError(
      'Chatwoot readiness evidence does not match the reviewed target and Migration',
      'CHATWOOT_REMOTE_READINESS_EVIDENCE_MISMATCH',
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

function extractSecretNames(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw operatorError(
      'Wrangler Secret list output is not valid JSON',
      'CHATWOOT_REMOTE_READINESS_SECRET_LIST_INVALID',
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.result)
      ? parsed.result
      : Array.isArray(parsed?.secrets)
        ? parsed.secrets
        : [];
  return [...new Set(list.map((item) => item?.name).filter((name) => (
    typeof name === 'string' && name.trim() !== ''
  )))].sort();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(
      `Command failed: ${command}`,
      'CHATWOOT_REMOTE_READINESS_COMMAND_FAILED',
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
  const sanitized = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index - 1] === '--command') {
      sanitized.push('[READ_ONLY_SQL_REDACTED]');
    } else {
      sanitized.push(args[index]);
    }
  }
  return sanitized;
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
    throw operatorError(
      `Chatwoot readiness evidence is missing: ${name}`,
      'CHATWOOT_REMOTE_READINESS_EVIDENCE_MISSING',
      { phase: name, cause: cause?.code ?? 'READ_FAILED' },
    );
  }
  if (value?.phase !== name || value?.status !== 'passed') {
    throw operatorError(
      `Chatwoot readiness evidence is not passed: ${name}`,
      'CHATWOOT_REMOTE_READINESS_EVIDENCE_INVALID',
      { phase: name },
    );
  }
  return value;
}

function evidencePath(name) {
  return join(EVIDENCE_ROOT, `${name}.json`);
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootRemoteReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
