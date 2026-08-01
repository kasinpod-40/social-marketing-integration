#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  META_D1_ONLY_CONFIRMATIONS,
  META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
  META_D1_ONLY_OPERATOR_PHASES,
  META_D1_ONLY_REQUIRED_TABLES,
  assertMetaD1OnlyConfirmation,
  buildMetaD1OnlyConfigWindow,
  buildMetaD1OnlyJob,
  buildMetaD1OnlySchemaSql,
  buildMetaD1OnlySnapshotSql,
  classifyMetaD1OnlyCompletion,
  compareMetaD1OnlySnapshots,
  createMetaD1OnlyEvidence,
  evidenceFileForMetaD1OnlyPhase,
  loadMetaD1OnlyTarget,
  normalizeMetaD1OnlySnapshot,
  parseMetaD1OnlyOperatorArgs,
  previousMetaD1OnlyPhase,
  safeMetaD1OnlyTarget,
  validateMetaD1OnlyContinuationRepositoryState,
  validateMetaD1OnlyEvidenceSequence,
  validateMetaD1OnlyReusableRestoreSequence,
  validateMetaD1OnlyTerminalRecoveryBaseline,
  validateMetaReadOnlySummary,
} from './lib/meta-d1-only-rollout-operator.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = join(repositoryRoot, 'outputs', 'meta-d1-only-rollout');

try {
  const options = parseMetaD1OnlyOperatorArgs(process.argv.slice(2));
  if (options.phase === 'plan') {
    await printPlan();
  } else if (!options.execute) {
    throw operatorFailure(
      'Executable Meta D1-only phases require --execute and an exact phase confirmation',
      'META_D1_ONLY_OPERATOR_EXECUTE_REQUIRED',
    );
  } else {
    await executePhase(options.phase);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_D1_ONLY_OPERATOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    emergencyRestoreRequired: error?.emergencyRestoreRequired === true,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function printPlan() {
  const plan = {
    contractVersion: META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
    planOnly: true,
    phases: META_D1_ONLY_OPERATOR_PHASES,
    confirmations: META_D1_ONLY_CONFIRMATIONS,
    targets: ['facebook', 'instagram', 'chemistry_k2', 'chemistry_k3'],
    executionModel: 'one_target_one_operation_one_evidence_chain',
    providerTransport: 'GET_only',
    d1BusinessWrites: 'allowed_only_inside_confirmed_window',
    larkWrites: false,
    schedules: false,
    production: false,
    remoteActionsPerformed: false,
  };
  if (process.env.MKT_META_D1_ONLY_TARGET) {
    const loaded = await loadReviewedTarget(process.env);
    const state = await repositoryState();
    if (state.head !== loaded.target.repositoryHead || !state.clean) {
      throw operatorFailure(
        'Target-bound plan requires the exact reviewed HEAD and a clean Working Tree',
        'META_D1_ONLY_PLAN_REPOSITORY_INVALID',
      );
    }
    await mkdir(loaded.evidenceRoot, { recursive: true, mode: 0o700 });
    const evidence = createEvidence(loaded.target, 'plan', {
      ...plan,
      target: safeMetaD1OnlyTarget(loaded.target),
      config: configEvidence(loaded.config),
      readOnlySummary: loaded.summary,
    }, null, {
      remoteMutationPerformed: false,
      businessWritesAllowed: false,
    });
    await writeEvidence(loaded, 'plan', evidence);
    Object.assign(plan, {
      target: safeMetaD1OnlyTarget(loaded.target),
      targetFingerprint: loaded.target.targetFingerprint,
      evidenceRoot: relative(repositoryRoot, loaded.evidenceRoot),
    });
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function executePhase(phase) {
  assertMetaD1OnlyConfirmation(phase, process.env);
  const loaded = await loadReviewedTarget(process.env);
  const state = await repositoryState(loaded.target.repositoryHead);
  const continuation = validateMetaD1OnlyContinuationRepositoryState({
    phase,
    targetRepositoryHead: loaded.target.repositoryHead,
    operatorRepositoryHead: state.head,
    clean: state.clean,
    changedPaths: state.changedPaths,
    targetIsAncestor: state.targetIsAncestor,
  }, process.env);
  await mkdir(loaded.evidenceRoot, { recursive: true, mode: 0o700 });
  const prior = await readPriorEvidence(loaded, phase);
  const data = phase === 'restore-all-false'
      && continuation.continuedAcrossRepositoryHead
    ? await reuseVerifiedAllFalseRestore(loaded)
    : await runPhase(loaded, phase);
  const permissions = phasePermissions(phase);
  if (data?.reusedExistingRestore === true) {
    permissions.remoteMutationPerformed = false;
  }
  const evidence = createEvidence(loaded.target, phase, {
    ...data,
    repositoryContinuation: continuation,
  }, prior, permissions);
  await writeEvidence(loaded, phase, evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function runPhase(loaded, phase) {
  switch (phase) {
    case 'preflight':
      return runPreflight(loaded);
    case 'backup':
      return runBackup(loaded);
    case 'deploy-safe-baseline':
      return runDeployment(loaded, phase, 'safe');
    case 'verify-safe-baseline':
      return verifyDeployment(loaded, phase, 'safe');
    case 'deploy-d1-only-gates':
      return runDeployment(loaded, phase, 'active');
    case 'verify-d1-only-deployment':
      return verifyDeployment(loaded, phase, 'active');
    case 'snapshot-before':
      return { snapshot: await readSnapshot(loaded) };
    case 'send-one-d1-only':
      return sendQueuePhase(loaded, phase);
    case 'verify-d1-only':
      return verifyInitialD1Only(loaded);
    case 'resend-same-operation':
      return sendQueuePhase(loaded, phase);
    case 'verify-idempotent-rerun':
      return verifyIdempotentRerun(loaded);
    case 'restore-all-false':
      return runDeployment(loaded, phase, 'safe');
    case 'verify-restore':
      return verifyDeployment(loaded, phase, 'safe');
    case 'summary':
      return summarize(loaded);
    default:
      throw operatorFailure(
        `Unsupported executable phase: ${phase}`,
        'META_D1_ONLY_OPERATOR_PHASE_INVALID',
      );
  }
}

async function loadReviewedTarget(env) {
  const raw = loadMetaD1OnlyTarget(env);
  const configPath = resolveRepositoryFile(raw.wranglerConfigPath);
  const summaryPath = resolveRepositoryOrAbsoluteFile(raw.readOnlySummaryPath);
  const [safeConfigText, summaryText] = await Promise.all([
    readFile(configPath, 'utf8'),
    readFile(summaryPath, 'utf8'),
  ]);
  const summaryValue = JSON.parse(summaryText);
  const summary = validateMetaReadOnlySummary(summaryValue, raw);
  const config = buildMetaD1OnlyConfigWindow(safeConfigText, raw);
  const targetFingerprint = sha256(JSON.stringify({
    base: raw.targetFingerprint,
    safeConfigSha256: config.safeSha256,
    activeConfigSha256: config.activeSha256,
    bindingFingerprint: config.bindingFingerprint,
    readOnlySummarySha256: summary.summarySha256,
  }));
  const target = Object.freeze({
    ...raw,
    configPath,
    summaryPath,
    targetFingerprint,
  });
  const evidenceRoot = join(outputRoot, target.targetKey, target.operationId);
  return Object.freeze({ target, config, summary, evidenceRoot });
}

async function runPreflight(loaded) {
  const { target, config, summary } = loaded;
  const [safeBundle, activeBundle, deployment, migrations, secretNames, schemaRow, baseline] =
    await Promise.all([
      buildBundle(target, config.safeText, 'safe'),
      buildBundle(target, config.activeText, 'active'),
      readDeploymentStatus(target),
      wranglerText(target, [
        'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote',
        '--config', target.configPath,
      ]),
      readSecretNames(target),
      readD1Row(target, buildMetaD1OnlySchemaSql()),
      readSnapshot(loaded),
    ]);
  const activeVersion = requireActiveVersion(deployment, target.expectedActiveVersion);
  const pendingMigrations = [...migrations.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0]);
  const acceptedPending = pendingMigrations.length === 0
    || (pendingMigrations.length === 1
      && pendingMigrations[0] === '0018_chatwoot_analytics.sql');
  if (!acceptedPending) {
    throw operatorFailure(
      `Unexpected pending migrations: ${pendingMigrations.join(', ')}`,
      'META_D1_ONLY_PENDING_MIGRATIONS_INVALID',
    );
  }
  if (!secretNames.includes(target.requiredSecretName)) {
    throw operatorFailure(
      `Required Worker Secret name is missing: ${target.requiredSecretName}`,
      'META_D1_ONLY_REQUIRED_SECRET_MISSING',
    );
  }
  const names = String(schemaRow.required_table_names ?? '')
    .split(',')
    .filter(Boolean)
    .sort();
  if (Number(schemaRow.required_table_count) !== META_D1_ONLY_REQUIRED_TABLES.length
    || JSON.stringify(names) !== JSON.stringify([...META_D1_ONLY_REQUIRED_TABLES].sort())) {
    throw operatorFailure(
      'Remote D1 is missing required Meta/Shared tables',
      'META_D1_ONLY_D1_SCHEMA_INCOMPLETE',
    );
  }
  const terminalRecovery = target.terminalRecovery
    ? validateMetaD1OnlyTerminalRecoveryBaseline(baseline)
    : null;
  if (!target.terminalRecovery
    && (baseline.syncRunStatus !== null
      || baseline.workStatus !== null
      || baseline.activeLockCount !== 0
      || baseline.queueOperationAttempts !== 0)) {
      throw operatorFailure(
        'The proposed Meta operation identity already exists or is active',
        'META_D1_ONLY_OPERATION_NOT_FRESH',
      );
  }
  return {
    target: safeMetaD1OnlyTarget(target),
    readOnlySummary: summary,
    config: configEvidence(config),
    safeBundleSha256: safeBundle.sha256,
    activeBundleSha256: activeBundle.sha256,
    activeVersion,
    pendingMigrations,
    requiredSecretNamePresent: true,
    requiredTableCount: META_D1_ONLY_REQUIRED_TABLES.length,
    baseline,
    terminalRecovery: terminalRecovery?.accepted === true,
    providerRequests: 0,
    remoteMutationCount: 0,
  };
}

async function runBackup(loaded) {
  const backupDir = join(loaded.evidenceRoot, 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const outputPath = join(
    backupDir,
    `meta-d1-only-before-${loaded.target.targetKey}-${loaded.target.operationId}.sql`,
  );
  await wrangler(loaded.target, [
    'd1', 'export', 'MKT_STATE_DB', '--remote',
    '--config', loaded.target.configPath,
    '--output', outputPath,
  ]);
  await chmod(outputPath, 0o600);
  const bytes = await readFile(outputPath);
  if (bytes.length === 0) {
    throw operatorFailure('Remote D1 backup is empty', 'META_D1_ONLY_BACKUP_EMPTY');
  }
  return {
    backupFile: relative(repositoryRoot, outputPath),
    backupBytes: bytes.length,
    backupSha256: sha256(bytes),
    remoteMutationCount: 0,
  };
}

async function runDeployment(loaded, phase, mode) {
  const text = mode === 'active' ? loaded.config.activeText : loaded.config.safeText;
  const priorVersion = phase === 'deploy-safe-baseline'
    ? loaded.target.expectedActiveVersion
    : await activeVersionFromRemote(loaded.target);
  const bundle = await buildBundle(loaded.target, text, phase);
  const result = await withGeneratedConfig(loaded.target, text, async (configPath) => wrangler(
    loaded.target,
    [
      'deploy',
      '--config', configPath,
      '--message',
      `${META_D1_ONLY_OPERATOR_CONTRACT_VERSION} phase=${phase} git=${loaded.target.repositoryHead}`
        + ` target=${loaded.target.targetKey}`,
    ],
  ));
  const deploymentVersionId = extractVersionId(result.stdout);
  return {
    mode,
    repositoryHead: loaded.target.repositoryHead,
    activeVersionBefore: priorVersion,
    deploymentVersionId,
    localBundleSha256: bundle.sha256,
    stdoutSha256: sha256(result.stdout),
    configSha256: mode === 'active'
      ? loaded.config.activeSha256
      : loaded.config.safeSha256,
    trueFlags: mode === 'active' ? loaded.config.activeTrueFlags : [],
    commandExitCode: 0,
  };
}

async function reuseVerifiedAllFalseRestore(loaded) {
  const evidence = [];
  for (const phase of [
    'plan',
    'preflight',
    'backup',
    'deploy-safe-baseline',
    'verify-safe-baseline',
    'deploy-d1-only-gates',
    'verify-d1-only-deployment',
    'snapshot-before',
    'send-one-d1-only',
    'verify-d1-only',
    'resend-same-operation',
    'restore-all-false',
    'verify-restore',
  ]) {
    evidence.push(await readEvidence(loaded, phase));
  }
  const prior = validateMetaD1OnlyReusableRestoreSequence(evidence, loaded.target);
  const verified = await verifyDeployment(loaded, 'verify-restore', 'safe');
  return {
    ...verified,
    deploymentVersionId: prior.deploymentVersionId,
    reusedExistingRestore: true,
    priorRestoreEvidenceSha256: prior.restoreEvidenceSha256,
    priorVerificationEvidenceSha256: prior.verificationEvidenceSha256,
    commandExitCode: 0,
  };
}

async function verifyDeployment(loaded, phase, mode) {
  const deployPhase = phase === 'verify-safe-baseline'
    ? 'deploy-safe-baseline'
    : phase === 'verify-d1-only-deployment'
      ? 'deploy-d1-only-gates'
      : 'restore-all-false';
  const deploymentEvidence = await readEvidence(loaded, deployPhase);
  const expectedVersion = deploymentEvidence.data?.deploymentVersionId;
  const [status, versionView, mainConsumers, dlqConsumers] = await Promise.all([
    readDeploymentStatus(loaded.target),
    readVersionView(loaded.target, expectedVersion),
    readQueueConsumers(loaded.target.mainQueueName),
    readQueueConsumers(loaded.target.dlqName),
  ]);
  const activeVersion = requireActiveVersion(status, expectedVersion);
  const expectedTrue = mode === 'active' ? loaded.config.activeTrueFlags : [];
  assertRemoteFlags(versionView, expectedTrue);
  assertQueueConsumer(mainConsumers, loaded.target.mainQueueName, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 5,
    deadLetterQueue: loaded.target.dlqName,
  });
  assertQueueConsumer(dlqConsumers, loaded.target.dlqName, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 10,
  });
  return {
    mode,
    activeVersion,
    expectedTrueFlags: expectedTrue,
    remoteFlagFingerprint: sha256(JSON.stringify(readAllRemoteEnabledFlags(versionView))),
    queueTopologyVerified: true,
    larkWriteEnabled: false,
    schedulesEnabled: false,
  };
}

async function sendQueuePhase(loaded, phase) {
  const attemptPath = join(loaded.evidenceRoot, `${phase}.attempt.json`);
  try {
    await stat(attemptPath);
    throw operatorFailure(
      `Queue send attempt already exists for ${phase}; automatic resend is blocked`,
      'META_D1_ONLY_QUEUE_SEND_ALREADY_ATTEMPTED',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const job = buildMetaD1OnlyJob(loaded.target);
  await writePrivateJson(attemptPath, {
    phase,
    operationId: loaded.target.operationId,
    workKey: loaded.target.workKey,
    generation: loaded.target.generation,
    jobSha256: sha256(JSON.stringify(job)),
    attemptedAt: new Date().toISOString(),
  });
  await sendQueueMessage(job, loaded.target);
  return {
    queueSendCommandCount: 1,
    accepted: true,
    operationId: loaded.target.operationId,
    workKey: loaded.target.workKey,
    syncRunId: loaded.target.syncRunId,
    jobSha256: sha256(JSON.stringify(job)),
    automaticResend: false,
  };
}

async function verifyInitialD1Only(loaded) {
  const before = (await readEvidence(loaded, 'snapshot-before')).data?.snapshot;
  const after = await pollForD1Completion(loaded);
  return {
    comparison: compareMetaD1OnlySnapshots(before, after, {
      terminalRecovery: loaded.target.terminalRecovery,
    }),
    snapshotAfter: after,
    larkMutationCount: 0,
  };
}

async function verifyIdempotentRerun(loaded) {
  const before = (await readEvidence(loaded, 'verify-d1-only')).data?.snapshotAfter;
  const minimumAttempts = normalizeMetaD1OnlySnapshot(before).mainQueueAttempts + 1;
  const after = await pollForRerun(loaded, minimumAttempts);
  return {
    comparison: compareMetaD1OnlySnapshots(before, after, { rerun: true }),
    snapshotAfter: after,
    larkMutationCount: 0,
  };
}

async function pollForD1Completion(loaded) {
  const maxPolls = positiveInteger(process.env.MKT_META_D1_ONLY_VERIFY_MAX_POLLS, 120);
  const intervalMs = positiveInteger(process.env.MKT_META_D1_ONLY_VERIFY_POLL_INTERVAL_MS, 5_000);
  let snapshot;
  for (let index = 0; index < maxPolls; index += 1) {
    snapshot = await readSnapshot(loaded);
    if (classifyMetaD1OnlyCompletion(snapshot).complete) return snapshot;
    if (index + 1 < maxPolls) await sleep(intervalMs);
  }
  const error = operatorFailure(
    'Bounded verification did not observe the accepted Meta D1-only boundary',
    'META_D1_ONLY_VERIFY_TIMEOUT',
  );
  error.emergencyRestoreRequired = true;
  throw error;
}

async function pollForRerun(loaded, minimumAttempts) {
  const maxPolls = positiveInteger(process.env.MKT_META_D1_ONLY_RERUN_MAX_POLLS, 30);
  const intervalMs = positiveInteger(process.env.MKT_META_D1_ONLY_VERIFY_POLL_INTERVAL_MS, 5_000);
  let snapshot;
  for (let index = 0; index < maxPolls; index += 1) {
    snapshot = await readSnapshot(loaded);
    const normalized = normalizeMetaD1OnlySnapshot(snapshot);
    if (normalized.mainQueueAttempts >= minimumAttempts
      && normalized.activeLockCount === 0
      && normalized.syncRunStatus === 'success') {
      return snapshot;
    }
    if (index + 1 < maxPolls) await sleep(intervalMs);
  }
  const error = operatorFailure(
    'Bounded verification did not observe the same-operation rerun',
    'META_D1_ONLY_RERUN_VERIFY_TIMEOUT',
  );
  error.emergencyRestoreRequired = true;
  throw error;
}

async function summarize(loaded) {
  const evidence = [];
  for (const phase of META_D1_ONLY_OPERATOR_PHASES.slice(0, -1)) {
    evidence.push(await readEvidence(loaded, phase));
  }
  const validated = validateMetaD1OnlyEvidenceSequence(evidence, loaded.target);
  const final = validated.at(-1);
  if (final.phase !== 'verify-restore' || final.data?.mode !== 'safe') {
    throw operatorFailure(
      'Meta D1-only summary requires a verified all-false restore',
      'META_D1_ONLY_SUMMARY_RESTORE_INCOMPLETE',
    );
  }
  return {
    accepted: true,
    targetKey: loaded.target.targetKey,
    operationId: loaded.target.operationId,
    phaseCount: validated.length,
    evidenceChainHeadSha256: final.evidenceSha256,
    d1OnlyVerified: true,
    idempotentRerunVerified: true,
    restoredAllFalse: true,
    larkMutationCount: 0,
    scheduleActivationCount: 0,
    nextGate: 'separate_next_target_or_lark_parity_approval',
  };
}

async function readSnapshot(loaded) {
  const row = await readD1Row(
    loaded.target,
    buildMetaD1OnlySnapshotSql(loaded.target),
  );
  return normalizeMetaD1OnlySnapshot(row);
}

async function readPriorEvidence(loaded, phase) {
  if (phase === 'preflight') {
    try {
      return await readEvidence(loaded, 'plan');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
  if (phase === 'restore-all-false') {
    for (const candidate of [
      'verify-idempotent-rerun',
      'resend-same-operation',
      'verify-d1-only',
      'send-one-d1-only',
      'verify-d1-only-deployment',
      'deploy-d1-only-gates',
    ]) {
      try {
        return await readEvidence(loaded, candidate);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    throw operatorFailure(
      'Guarded restore requires chain-bound activation evidence',
      'META_D1_ONLY_RESTORE_EVIDENCE_MISSING',
    );
  }
  const previous = previousMetaD1OnlyPhase(phase);
  return previous ? readEvidence(loaded, previous) : null;
}

function createEvidence(target, phase, data, prior, permissions) {
  return createMetaD1OnlyEvidence({
    phase,
    repositoryHead: target.repositoryHead,
    targetFingerprint: target.targetFingerprint,
    targetKey: target.targetKey,
    operationId: target.operationId,
    previousEvidenceSha256: prior?.evidenceSha256 ?? null,
    data,
    ...permissions,
  });
}

function phasePermissions(phase) {
  const deployment = new Set([
    'deploy-safe-baseline',
    'deploy-d1-only-gates',
    'restore-all-false',
  ]);
  const provider = new Set([
    'send-one-d1-only',
    'verify-d1-only',
    'resend-same-operation',
    'verify-idempotent-rerun',
  ]);
  return {
    remoteMutationPerformed: deployment.has(phase)
      || phase === 'send-one-d1-only'
      || phase === 'resend-same-operation',
    providerRequestMode: provider.has(phase) ? 'GET_only' : null,
    businessWritesAllowed: provider.has(phase),
  };
}

async function repositoryState(targetRepositoryHead = null) {
  const [head, status] = await Promise.all([
    gitText(['rev-parse', 'HEAD']),
    gitText(['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  if (!targetRepositoryHead || head === targetRepositoryHead) {
    return {
      head,
      clean: status.trim() === '',
      changedPaths: [],
      targetIsAncestor: true,
    };
  }
  const [paths, targetIsAncestor] = await Promise.all([
    gitText(['diff', '--name-only', `${targetRepositoryHead}..${head}`], { trim: false }),
    gitSucceeds(['merge-base', '--is-ancestor', targetRepositoryHead, head]),
  ]);
  return {
    head,
    clean: status.trim() === '',
    changedPaths: paths.split(/\r?\n/u).filter(Boolean),
    targetIsAncestor,
  };
}

async function gitSucceeds(args) {
  try {
    await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function buildBundle(target, configText, label) {
  return withGeneratedConfig(target, configText, async (configPath) => {
    const directory = await mkdtemp(join(tmpdir(), `meta-d1-only-${label}-`));
    try {
      const output = join(directory, 'worker.js');
      const result = await wrangler(target, [
        'deploy', '--dry-run', '--outdir', directory, '--config', configPath,
      ]);
      const bytes = await readFile(output);
      return {
        sha256: sha256(bytes),
        stdoutSha256: sha256(result.stdout),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function withGeneratedConfig(target, text, callback) {
  const path = join(
    repositoryRoot,
    `.meta-d1-only-${process.pid}-${Date.now()}-${basename(target.configPath)}`,
  );
  try {
    await writeFile(path, text, { mode: 0o600 });
    return await callback(path);
  } finally {
    await rm(path, { force: true });
  }
}

async function readD1Row(target, sql) {
  const output = await wranglerText(target, [
    'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', target.configPath,
    '--command', sql,
  ]);
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) {
    throw operatorFailure('Remote D1 query returned no row', 'META_D1_ONLY_D1_QUERY_EMPTY');
  }
  return row;
}

async function readSecretNames(target) {
  const output = await wranglerText(target, [
    'secret', 'list', '--name', target.workerName,
    '--config', target.configPath, '--format', 'json',
  ]);
  const parsed = JSON.parse(output);
  return Object.freeze(parsed.map((item) => String(item.name)).sort());
}

async function readDeploymentStatus(target) {
  const output = await wranglerText(target, [
    'deployments', 'status', '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]);
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function activeVersionFromRemote(target) {
  return requireActiveVersion(await readDeploymentStatus(target));
}

function requireActiveVersion(status, expected = null) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const active = versions.filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    throw operatorFailure(
      'Worker deployment does not have exactly one 100% active version',
      'META_D1_ONLY_ACTIVE_VERSION_INVALID',
    );
  }
  if (expected && active[0].version_id !== expected) {
    throw operatorFailure(
      'Worker active version differs from the reviewed target',
      'META_D1_ONLY_ACTIVE_VERSION_MISMATCH',
    );
  }
  return active[0].version_id;
}

async function readVersionView(target, versionId) {
  const output = await wranglerText(target, [
    'versions', 'view', versionId, '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]);
  return JSON.parse(output);
}

async function readQueueConsumers(queueName) {
  const result = await execFileAsync('npx', [
    'wrangler', 'queues', 'consumer', 'list', queueName, '--json',
  ], commandOptions());
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.consumers ?? []);
}

function assertRemoteFlags(versionView, expectedTrue) {
  const observed = readAllRemoteEnabledFlags(versionView);
  if (JSON.stringify(observed) !== JSON.stringify([...expectedTrue].sort())) {
    throw operatorFailure(
      `Remote Worker flags differ from approved Meta D1-only window: ${observed.join(', ')}`,
      'META_D1_ONLY_REMOTE_FLAG_MISMATCH',
    );
  }
}

function readAllRemoteEnabledFlags(value) {
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) flags.set(key, readBooleanLike(nested));
    }
    if (typeof node.name === 'string' && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(node.name, readBooleanLike(node.text ?? node.value ?? node.json ?? node.data));
    }
  });
  return [...flags.entries()].filter(([, enabled]) => enabled).map(([name]) => name).sort();
}

function assertQueueConsumer(consumers, queueName, expected) {
  const entry = consumers.find((item) => {
    const name = item?.queue_name ?? item?.queue ?? item?.name;
    return name === queueName || item?.queue_id === queueName;
  }) ?? (consumers.length === 1 ? consumers[0] : null);
  if (!entry) {
    throw operatorFailure(
      `Queue consumer is missing for ${queueName}`,
      'META_D1_ONLY_QUEUE_TOPOLOGY_INVALID',
    );
  }
  const observed = {
    maxConcurrency: Number(entry.max_concurrency ?? entry.settings?.max_concurrency),
    maxBatchSize: Number(entry.max_batch_size ?? entry.settings?.max_batch_size),
    maxBatchTimeout: Number(entry.max_batch_timeout ?? entry.settings?.max_batch_timeout),
    maxRetries: Number(entry.max_retries ?? entry.settings?.max_retries),
    deadLetterQueue: entry.dead_letter_queue ?? entry.settings?.dead_letter_queue ?? null,
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((observed[key] ?? null) !== value) {
      throw operatorFailure(
        `Queue consumer drift for ${queueName}: ${key}`,
        'META_D1_ONLY_QUEUE_TOPOLOGY_INVALID',
      );
    }
  }
}

async function sendQueueMessage(job, target) {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = target.accountId ?? requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const queueId = target.queueId ?? requiredEnv('MKT_META_D1_ONLY_QUEUE_ID');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`
      + `/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const responseBody = await response.json().catch(() => null);
  if (!response.ok || responseBody?.success !== true) {
    const error = operatorFailure(
      `Cloudflare Queue did not accept the Meta operation (HTTP ${response.status})`,
      'META_D1_ONLY_QUEUE_SEND_FAILED',
    );
    error.emergencyRestoreRequired = true;
    throw error;
  }
}

async function writeEvidence(loaded, phase, evidence) {
  await writePrivateJson(
    join(loaded.evidenceRoot, evidenceFileForMetaD1OnlyPhase(phase)),
    evidence,
  );
}

async function readEvidence(loaded, phase) {
  const path = join(loaded.evidenceRoot, evidenceFileForMetaD1OnlyPhase(phase));
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function configEvidence(config) {
  return {
    safeSha256: config.safeSha256,
    activeSha256: config.activeSha256,
    bindingFingerprint: config.bindingFingerprint,
    safeTrueFlags: config.safeTrueFlags,
    activeTrueFlags: config.activeTrueFlags,
  };
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (!path.startsWith(`${repositoryRoot}/`) && path !== repositoryRoot) {
    throw operatorFailure(
      'Meta D1-only config path must be inside the Repository',
      'META_D1_ONLY_PATH_INVALID',
    );
  }
  return path;
}

function resolveRepositoryOrAbsoluteFile(value) {
  return value.startsWith('/') ? resolve(value) : resolveRepositoryFile(value);
}

function extractVersionId(output) {
  const matches = String(output).match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
  ) ?? [];
  const unique = [...new Set(matches.map((item) => item.toLowerCase()))];
  if (unique.length !== 1) {
    throw operatorFailure(
      'Wrangler deployment output did not contain exactly one Worker version ID',
      'META_D1_ONLY_DEPLOYMENT_VERSION_INVALID',
    );
  }
  return unique[0];
}

function walk(value, callback) {
  callback(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, callback);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) walk(nested, callback);
  }
}

function readBooleanLike(value) {
  if (value === true || value === 1) return true;
  return String(value ?? '').trim().toLowerCase() === 'true';
}

async function gitText(args, options = {}) {
  const result = await execFileAsync('git', args, commandOptions());
  return options.trim === false ? result.stdout : result.stdout.trim();
}

async function wranglerText(target, args) {
  return (await wrangler(target, args)).stdout;
}

async function wrangler(target, args) {
  return execFileAsync('npx', ['wrangler', ...args], {
    ...commandOptions(),
    env: {
      ...process.env,
      ...(target.accountId ? { CLOUDFLARE_ACCOUNT_ID: target.accountId } : {}),
    },
  });
}

function commandOptions() {
  return {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw operatorFailure(`${name} is required`, 'META_D1_ONLY_LOCAL_CREDENTIAL_REQUIRED');
  }
  return value;
}

function positiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) {
    throw operatorFailure(
      'Meta D1-only polling limit is invalid',
      'META_D1_ONLY_POLLING_LIMIT_INVALID',
    );
  }
  return number;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function operatorFailure(message, code) {
  const error = new Error(message);
  error.name = 'MetaD1OnlyRolloutError';
  error.code = code;
  return error;
}
