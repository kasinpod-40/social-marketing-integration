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
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_LARK_CONFIRMATIONS,
  META_LARK_OPERATOR_CONTRACT_VERSION,
  META_LARK_OPERATOR_PHASES,
  assertMetaLarkConfirmation,
  buildMetaLarkConfigWindow,
  buildMetaLarkContinuationJob,
  buildMetaLarkSnapshotSql,
  classifyMetaLarkCompletion,
  classifyMetaLarkPollingSnapshot,
  compareMetaLarkSnapshots,
  createMetaLarkEvidence,
  evidenceFileForMetaLarkPhase,
  loadMetaLarkTarget,
  normalizeMetaLarkSnapshot,
  parseMetaLarkOperatorArgs,
  previousMetaLarkPhase,
  safeMetaLarkTarget,
  validateMetaD1OnlySummaryForLark,
  validateMetaLarkD1ReadyBoundary,
  validateMetaLarkOrphanedRunningStability,
  validateMetaLarkEvidenceSequence,
  validateMetaLarkInventory,
} from './lib/meta-lark-parity-rollout-operator.js';
import { resolveCloudflareBearerAuth } from './lib/woocommerce-final-one-command.js';
import { isMetaRemoteReadTransientError } from './lib/meta-d1-only-rollout-operator.js';
import {
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  LARK_TABLE_ENV,
  readLarkTableIdsFromEnv,
} from '../packages/config/src/lark-table-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_META_LARK_EVIDENCE_DIR
    ?? join(repositoryRoot, 'outputs', 'meta-lark-parity-rollout'),
);

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_LARK_OPERATOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    emergencyRestoreRequired: error?.emergencyRestoreRequired === true,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseMetaLarkOperatorArgs(process.argv.slice(2));
  if (options.phase === 'plan') {
    printPlan();
    return;
  }
  if (!options.execute) {
    throw failure(
      'Executable Meta Lark phases require --execute and exact confirmation',
      'META_LARK_OPERATOR_EXECUTE_REQUIRED',
    );
  }

  const env = await loadEnvironment();
  assertMetaLarkConfirmation(options.phase, env);
  const loaded = await loadReviewedTarget(env);
  const state = await repositoryState();
  if (state.head !== loaded.target.repositoryHead || !state.clean) {
    throw failure(
      'Meta Lark rollout requires exact reviewed HEAD and a clean Working Tree',
      'META_LARK_REPOSITORY_STATE_INVALID',
    );
  }

  await mkdir(loaded.evidenceRoot, { recursive: true, mode: 0o700 });
  const prior = await readPriorEvidence(loaded, options.phase);
  const data = await runPhase(loaded, options.phase, env);
  const evidence = createEvidence(
    loaded.target,
    options.phase,
    data,
    prior,
    phasePermissions(options.phase),
  );
  await writeEvidence(loaded, options.phase, evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    contractVersion: META_LARK_OPERATOR_CONTRACT_VERSION,
    planOnly: true,
    phases: META_LARK_OPERATOR_PHASES,
    confirmations: META_LARK_CONFIRMATIONS,
    targets: ['facebook', 'instagram', 'chemistry_k2', 'chemistry_k3'],
    executionModel: 'preflight_lark_now_continue_each_d1_ready_target',
    sameOperationContinuation: true,
    stagedProviderSourceReused: true,
    providerRequestsDuringContinuation: 0,
    larkMetadataMutationCount: 0,
    schedules: false,
    production: false,
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

async function runPhase(loaded, phase, env) {
  switch (phase) {
    case 'lark-preflight':
      return runLarkPreflight(loaded, env);
    case 'd1-ready':
      return runD1Ready(loaded);
    case 'deploy-safe-baseline':
      return deploy(loaded, phase, 'safe');
    case 'verify-safe-baseline':
      return verifyDeployment(loaded, phase, 'safe');
    case 'deploy-lark-gates':
      return deploy(loaded, phase, 'active');
    case 'verify-lark-deployment':
      return verifyDeployment(loaded, phase, 'active');
    case 'snapshot-before':
      return { snapshot: await readSnapshot(loaded) };
    case 'send-lark-continuation':
    case 'resend-same-operation':
      return sendQueuePhase(loaded, phase);
    case 'verify-lark':
      return verifyInitialLark(loaded);
    case 'verify-idempotent-rerun':
      return verifyLarkRerun(loaded);
    case 'restore-all-false':
      return deploy(loaded, phase, 'safe');
    case 'verify-restore':
      return verifyDeployment(loaded, phase, 'safe');
    case 'verify-late-completion':
      return verifyLateCompletion(loaded);
    case 'summary':
      return summarize(loaded);
    default:
      throw failure(`Unsupported Meta Lark phase: ${phase}`, 'META_LARK_OPERATOR_PHASE_INVALID');
  }
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

async function loadReviewedTarget(env) {
  const raw = loadMetaLarkTarget(env);
  const configPath = resolveRepositoryFile(raw.wranglerConfigPath);
  const d1SummaryPath = resolveRepositoryOrAbsoluteFile(raw.d1SummaryPath);
  const safeConfigText = await readFile(configPath, 'utf8');
  const config = buildMetaLarkConfigWindow(safeConfigText, raw);
  const tableIds = readLarkTableIdsFromEnv(env, META_END_TO_END_REQUIRED_LARK_TABLE_KEYS);
  assertConfigTableIds(safeConfigText, env, tableIds);

  const target = Object.freeze({
    ...raw,
    configPath,
    d1SummaryPath,
    targetFingerprint: sha256(stableJson({
      base: raw.targetFingerprint,
      safeConfigSha256: config.safeSha256,
      activeConfigSha256: config.activeSha256,
      bindingFingerprint: config.bindingFingerprint,
      tableIdFingerprint: sha256(stableJson(Object.values(tableIds).sort())),
    })),
  });
  return Object.freeze({
    target,
    config,
    tableIds,
    evidenceRoot: join(outputRoot, target.targetKey, target.operationId),
  });
}

async function runLarkPreflight(loaded, env) {
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const fieldsByKey = {};
  for (const key of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    fieldsByKey[key] = await client.listFields({ tableId: loaded.tableIds[key] });
  }
  return {
    target: safeMetaLarkTarget(loaded.target),
    inventory: validateMetaLarkInventory({
      tableIds: loaded.tableIds,
      remoteTables,
      fieldsByKey,
    }),
    larkRequestCount: 1 + META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.length,
    larkMutationCount: 0,
    recordReadCount: 0,
    credentialValuesPersisted: false,
    config: configEvidence(loaded.config),
  };
}

async function runD1Ready(loaded) {
  const summary = JSON.parse(await readFile(loaded.target.d1SummaryPath, 'utf8'));
  const d1Summary = validateMetaD1OnlySummaryForLark(summary, loaded.target);
  let snapshot = await readSnapshot(loaded);
  let boundary = validateMetaLarkD1ReadyBoundary(snapshot, loaded.target);
  let orphanedRunningStability = null;
  if (boundary.orphanedRunningRecovery) {
    await sleep(30_000);
    const stableSnapshot = await readSnapshot(loaded);
    orphanedRunningStability = validateMetaLarkOrphanedRunningStability(
      snapshot,
      stableSnapshot,
      loaded.target,
    );
    snapshot = stableSnapshot;
    boundary = validateMetaLarkD1ReadyBoundary(snapshot, loaded.target);
  }

  const secretNames = await readSecretNames(loaded.target);
  for (const name of [loaded.target.requiredSecretName, 'LARK_APP_SECRET']) {
    if (!secretNames.includes(name)) {
      throw failure(`Required Worker Secret name is missing: ${name}`, 'META_LARK_REQUIRED_SECRET_MISSING');
    }
  }
  return {
    d1Summary,
    snapshot,
    terminalRecovery: boundary.terminalRecovery,
    orphanedRunningRecovery: boundary.orphanedRunningRecovery,
    orphanedRunningStability,
    requiredSecretNamesPresent: true,
    providerRequests: 0,
    larkMutationCount: 0,
  };
}

async function deploy(loaded, phase, mode) {
  const text = mode === 'active' ? loaded.config.activeText : loaded.config.safeText;
  const activeVersionBefore = phase === 'deploy-safe-baseline'
    ? loaded.target.expectedActiveVersion
    : await activeVersionFromRemote(loaded.target);
  const bundle = await buildBundle(loaded.target, text, phase);
  const result = await withGeneratedConfig(loaded.target, text, async (configPath) => wrangler(
    loaded.target,
    [
      'deploy',
      '--config', configPath,
      '--message',
      `${META_LARK_OPERATOR_CONTRACT_VERSION} phase=${phase}`
        + ` git=${loaded.target.repositoryHead} target=${loaded.target.targetKey}`,
    ],
  ));
  return {
    mode,
    activeVersionBefore,
    deploymentVersionId: extractVersionId(result.stdout),
    repositoryHead: loaded.target.repositoryHead,
    localBundleSha256: bundle.sha256,
    stdoutSha256: sha256(result.stdout),
    configSha256: mode === 'active' ? loaded.config.activeSha256 : loaded.config.safeSha256,
    trueFlags: mode === 'active' ? loaded.config.activeTrueFlags : [],
    commandExitCode: 0,
  };
}

async function verifyDeployment(loaded, phase, mode) {
  const deploymentPhase = phase === 'verify-safe-baseline'
    ? 'deploy-safe-baseline'
    : phase === 'verify-lark-deployment'
      ? 'deploy-lark-gates'
      : 'restore-all-false';
  const deployment = await readEvidence(loaded, deploymentPhase);
  const expectedVersion = deployment.data?.deploymentVersionId;
  const [status, versionView, mainConsumers, dlqConsumers] = await Promise.all([
    readDeploymentStatus(loaded.target),
    readVersionView(loaded.target, expectedVersion),
    readQueueConsumers(loaded.target.mainQueueName),
    readQueueConsumers(loaded.target.dlqName),
  ]);
  const activeVersion = requireActiveVersion(status, expectedVersion);
  const expectedTrueFlags = mode === 'active' ? loaded.config.activeTrueFlags : [];
  assertRemoteFlags(versionView, expectedTrueFlags);
  assertRemoteTableIds(versionView, loaded.tableIds);
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
    expectedTrueFlags,
    remoteFlagFingerprint: sha256(stableJson(readAllRemoteEnabledFlags(versionView))),
    remoteTableMappingFingerprint: sha256(stableJson(readRemoteTableIds(versionView))),
    queueTopologyVerified: true,
    larkWriteEnabled: mode === 'active',
    schedulesEnabled: false,
  };
}

async function sendQueuePhase(loaded, phase) {
  const attemptPath = join(loaded.evidenceRoot, `${phase}.attempt.json`);
  try {
    await stat(attemptPath);
    throw failure(`Queue send attempt already exists for ${phase}`, 'META_LARK_QUEUE_SEND_ALREADY_ATTEMPTED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const job = buildMetaLarkContinuationJob(loaded.target);
  await writePrivateJson(attemptPath, {
    phase,
    operationId: loaded.target.operationId,
    workKey: loaded.target.workKey,
    generation: loaded.target.generation,
    jobSha256: sha256(stableJson(job)),
    attemptedAt: new Date().toISOString(),
  });
  await sendQueueMessage(job, loaded.target);
  return {
    queueSendCommandCount: 1,
    accepted: true,
    operationId: loaded.target.operationId,
    workKey: loaded.target.workKey,
    syncRunId: loaded.target.syncRunId,
    jobSha256: sha256(stableJson(job)),
    providerRequestsExpected: 0,
    automaticResend: false,
  };
}

async function verifyInitialLark(loaded) {
  const before = (await readEvidence(loaded, 'snapshot-before')).data?.snapshot;
  const normalizedBefore = normalizeMetaLarkSnapshot(before);
  const minimumAttempts = normalizedBefore.mainQueueAttempts + 1;
  const after = await pollForCompletion(
    loaded,
    minimumAttempts,
    normalizedBefore.syncRunFinishedAt,
  );
  return {
    comparison: compareMetaLarkSnapshots(before, after, loaded.target),
    snapshotAfter: after,
    providerRequestCount: 0,
  };
}

async function verifyLarkRerun(loaded) {
  const before = (await readEvidence(loaded, 'verify-lark')).data?.snapshotAfter;
  const normalizedBefore = normalizeMetaLarkSnapshot(before);
  const minimumAttempts = normalizedBefore.mainQueueAttempts + 1;
  const after = await pollForRerun(
    loaded,
    minimumAttempts,
    normalizedBefore.syncRunFinishedAt,
  );
  return {
    comparison: compareMetaLarkSnapshots(before, after, loaded.target, { rerun: true }),
    snapshotAfter: after,
    providerRequestCount: 0,
  };
}

async function pollForCompletion(loaded, minimumAttempts, previousFinishedAt) {
  const maxPolls = boundedInteger(process.env.MKT_META_LARK_VERIFY_MAX_POLLS, 120);
  const intervalMs = boundedInteger(process.env.MKT_META_LARK_VERIFY_POLL_INTERVAL_MS, 5_000);
  for (let index = 0; index < maxPolls; index += 1) {
    const snapshot = await readPollingSnapshot(loaded);
    if (!snapshot) {
      if (index + 1 < maxPolls) await sleep(intervalMs);
      continue;
    }
    const classified = classifyMetaLarkPollingSnapshot(
      snapshot,
      loaded.target,
      minimumAttempts,
      previousFinishedAt,
    );
    if (classified.state === 'complete') return classified.snapshot;
    if (classified.state === 'terminal_failure') {
      const error = failure(
        'Meta Lark continuation reached a terminal failed sync run',
        'META_LARK_TERMINAL_FAILURE',
        { errorCode: classified.errorCode },
      );
      error.emergencyRestoreRequired = true;
      throw error;
    }
    if (index + 1 < maxPolls) await sleep(intervalMs);
  }
  const error = failure(
    'Bounded verification did not observe Meta Lark completion',
    'META_LARK_VERIFY_TIMEOUT',
  );
  error.emergencyRestoreRequired = true;
  throw error;
}

async function pollForRerun(loaded, minimumAttempts, previousFinishedAt) {
  const maxPolls = boundedInteger(process.env.MKT_META_LARK_RERUN_MAX_POLLS, 30);
  const intervalMs = boundedInteger(process.env.MKT_META_LARK_VERIFY_POLL_INTERVAL_MS, 5_000);
  for (let index = 0; index < maxPolls; index += 1) {
    const snapshot = await readPollingSnapshot(loaded);
    if (!snapshot) {
      if (index + 1 < maxPolls) await sleep(intervalMs);
      continue;
    }
    const classified = classifyMetaLarkPollingSnapshot(
      snapshot,
      loaded.target,
      minimumAttempts,
      previousFinishedAt,
    );
    if (classified.state === 'complete') {
      return classified.snapshot;
    }
    if (classified.state === 'terminal_failure') {
      const error = failure(
        'Meta Lark idempotent rerun reached a terminal failed sync run',
        'META_LARK_TERMINAL_FAILURE',
        { errorCode: classified.errorCode },
      );
      error.emergencyRestoreRequired = true;
      throw error;
    }
    if (index + 1 < maxPolls) await sleep(intervalMs);
  }
  const error = failure(
    'Bounded verification did not observe Meta Lark idempotent rerun',
    'META_LARK_RERUN_VERIFY_TIMEOUT',
  );
  error.emergencyRestoreRequired = true;
  throw error;
}

async function readPollingSnapshot(loaded) {
  try {
    return await readSnapshot(loaded);
  } catch (error) {
    if (!isMetaRemoteReadTransientError(error)) throw error;
    return null;
  }
}

async function verifyLateCompletion(loaded) {
  const before = (await readEvidence(loaded, 'snapshot-before')).data?.snapshot;
  const after = await readSnapshot(loaded);
  const comparison = compareMetaLarkSnapshots(before, after, loaded.target);
  const beforeAttempts = normalizeMetaLarkSnapshot(before).mainQueueAttempts;
  const sameOperationAttemptsObserved = after.mainQueueAttempts - beforeAttempts;
  if (!after.clearedPhaseCompletion || sameOperationAttemptsObserved < 2) {
    throw failure(
      'Late Meta completion lacks cleared-phase and repeated same-operation proof',
      'META_LARK_LATE_COMPLETION_PROOF_INVALID',
    );
  }
  return {
    comparison,
    snapshotAfter: after,
    sameOperationAttemptsObserved,
    clearedPhaseCompletionVerified: true,
    providerRequestCount: 0,
  };
}

async function summarize(loaded) {
  const late = await readEvidence(loaded, 'verify-late-completion').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  const phases = late
    ? [
        'lark-preflight',
        'd1-ready',
        'deploy-safe-baseline',
        'verify-safe-baseline',
        'deploy-lark-gates',
        'verify-lark-deployment',
        'snapshot-before',
        'send-lark-continuation',
        'restore-all-false',
        'verify-restore',
        'verify-late-completion',
      ]
    : META_LARK_OPERATOR_PHASES
        .slice(1, -1)
        .filter((phase) => phase !== 'verify-late-completion');
  const evidence = [];
  for (const phase of phases) {
    evidence.push(await readEvidence(loaded, phase));
  }
  const validated = validateMetaLarkEvidenceSequence(evidence, loaded.target);
  const final = validated.at(-1);
  const restore = validated.find((item) => item.phase === 'verify-restore');
  const lateValid = final.phase === 'verify-late-completion'
    && final.data?.clearedPhaseCompletionVerified === true
    && Number(final.data?.sameOperationAttemptsObserved) >= 2;
  if (restore?.data?.mode !== 'safe'
    || (!lateValid && final.phase !== 'verify-restore')) {
    throw failure(
      'Meta Lark summary requires verified all-false restore',
      'META_LARK_SUMMARY_RESTORE_INCOMPLETE',
    );
  }
  return {
    accepted: true,
    targetKey: loaded.target.targetKey,
    operationId: loaded.target.operationId,
    phaseCount: validated.length,
    evidenceChainHeadSha256: final.evidenceSha256,
    larkParityVerified: true,
    idempotentRerunVerified: true,
    restoredAllFalse: true,
    providerRequestCount: 0,
    scheduleActivationCount: 0,
    nextGate: 'separate_next_target_or_full_meta_summary_approval',
  };
}

async function readSnapshot(loaded) {
  const row = await readD1Row(loaded.target, buildMetaLarkSnapshotSql(loaded.target));
  return normalizeMetaLarkSnapshot(row);
}

async function readPriorEvidence(loaded, phase) {
  if (phase === 'lark-preflight') return null;
  if (phase === 'restore-all-false') {
    for (const candidate of [
      'verify-idempotent-rerun',
      'resend-same-operation',
      'verify-lark',
      'send-lark-continuation',
      'verify-lark-deployment',
      'deploy-lark-gates',
    ]) {
      try {
        return await readEvidence(loaded, candidate);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    throw failure(
      'Guarded restore requires chain-bound active evidence',
      'META_LARK_RESTORE_EVIDENCE_MISSING',
    );
  }
  if (phase === 'summary') {
    try {
      return await readEvidence(loaded, 'verify-late-completion');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return readEvidence(loaded, 'verify-restore');
    }
  }
  const previous = previousMetaLarkPhase(phase);
  return previous === 'plan' ? null : readEvidence(loaded, previous);
}

function createEvidence(target, phase, data, prior, permissions) {
  return createMetaLarkEvidence({
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
  const deployment = new Set(['deploy-safe-baseline', 'deploy-lark-gates', 'restore-all-false']);
  const larkWrite = new Set([
    'send-lark-continuation',
    'verify-lark',
    'resend-same-operation',
    'verify-idempotent-rerun',
  ]);
  return {
    remoteMutationPerformed: deployment.has(phase)
      || phase === 'send-lark-continuation'
      || phase === 'resend-same-operation',
    larkWritesAllowed: larkWrite.has(phase),
  };
}

async function repositoryState() {
  const [head, status] = await Promise.all([
    gitText(['rev-parse', 'HEAD']),
    gitText(['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  return { head, clean: status.trim() === '' };
}

async function buildBundle(target, configText, label) {
  return withGeneratedConfig(target, configText, async (configPath) => {
    const directory = await mkdtemp(join(tmpdir(), `meta-lark-${label}-`));
    try {
      const output = join(directory, 'worker.js');
      const result = await wrangler(target, [
        'deploy',
        '--dry-run',
        '--outdir', directory,
        '--config', configPath,
      ]);
      return {
        sha256: sha256(await readFile(output)),
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
    `.meta-lark-${process.pid}-${Date.now()}-${basename(target.configPath)}`,
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
    'd1',
    'execute',
    'MKT_STATE_DB',
    '--remote',
    '--json',
    '--config', target.configPath,
    '--command', sql,
  ]);
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) throw failure('Remote D1 query returned no row', 'META_LARK_D1_QUERY_EMPTY');
  return row;
}

async function readSecretNames(target) {
  const parsed = JSON.parse(await wranglerText(target, [
    'secret',
    'list',
    '--name', target.workerName,
    '--config', target.configPath,
    '--format', 'json',
  ]));
  return Object.freeze(parsed.map((item) => String(item.name)).sort());
}

async function readDeploymentStatus(target) {
  const parsed = JSON.parse(await wranglerText(target, [
    'deployments',
    'status',
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function activeVersionFromRemote(target) {
  return requireActiveVersion(await readDeploymentStatus(target));
}

function requireActiveVersion(status, expected = null) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const active = versions.filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    throw failure(
      'Worker does not have exactly one 100% active version',
      'META_LARK_ACTIVE_VERSION_INVALID',
    );
  }
  if (expected && active[0].version_id !== expected) {
    throw failure(
      'Worker active version differs from reviewed target',
      'META_LARK_ACTIVE_VERSION_MISMATCH',
    );
  }
  return active[0].version_id;
}

async function readVersionView(target, versionId) {
  return JSON.parse(await wranglerText(target, [
    'versions',
    'view', versionId,
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]));
}

async function readQueueConsumers(queueName) {
  const result = await execFileAsync(
    'npx',
    ['wrangler', 'queues', 'consumer', 'list', queueName, '--json'],
    commandOptions(),
  );
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.consumers ?? []);
}

function assertRemoteFlags(versionView, expectedTrue) {
  const observed = readAllRemoteEnabledFlags(versionView);
  if (JSON.stringify(observed) !== JSON.stringify([...expectedTrue].sort())) {
    throw failure(
      `Remote Worker flags differ from approved Meta Lark window: ${observed.join(', ')}`,
      'META_LARK_REMOTE_FLAG_MISMATCH',
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
  return [...flags.entries()]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort();
}

function assertRemoteTableIds(versionView, expected) {
  const observed = readRemoteTableIds(versionView);
  for (const key of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    if (observed[key] !== expected[key]) {
      throw failure(
        `Remote Lark table mapping drift for ${key}`,
        'META_LARK_REMOTE_TABLE_MAPPING_DRIFT',
      );
    }
  }
}

function readRemoteTableIds(value) {
  const byEnvName = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (Object.values(LARK_TABLE_ENV).includes(key)) {
        byEnvName.set(key, readStringLike(nested));
      }
    }
    if (typeof node.name === 'string' && Object.values(LARK_TABLE_ENV).includes(node.name)) {
      byEnvName.set(node.name, readStringLike(node.text ?? node.value ?? node.json ?? node.data));
    }
  });
  return Object.fromEntries(META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((key) => [
    key,
    byEnvName.get(LARK_TABLE_ENV[key]) ?? null,
  ]));
}

function assertQueueConsumer(consumers, queueName, expected) {
  const entry = consumers.find((item) => {
    const name = item?.queue_name ?? item?.queue ?? item?.name;
    return name === queueName || item?.queue_id === queueName;
  }) ?? (consumers.length === 1 ? consumers[0] : null);
  if (!entry) {
    throw failure(`Queue consumer is missing for ${queueName}`, 'META_LARK_QUEUE_TOPOLOGY_INVALID');
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
      throw failure(
        `Queue consumer drift for ${queueName}: ${key}`,
        'META_LARK_QUEUE_TOPOLOGY_INVALID',
      );
    }
  }
}

async function sendQueueMessage(job, target) {
  const token = await resolveQueueBearerToken(target);
  const accountId = target.accountId ?? requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const queueId = target.queueId ?? requiredEnv('MKT_META_LARK_QUEUE_ID');
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
    const error = failure(
      `Cloudflare Queue did not accept Meta Lark operation (HTTP ${response.status})`,
      'META_LARK_QUEUE_SEND_FAILED',
    );
    error.emergencyRestoreRequired = true;
    throw error;
  }
}

async function resolveQueueBearerToken(target) {
  const explicit = process.env.CLOUDFLARE_API_TOKEN;
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim();
  const auth = resolveCloudflareBearerAuth({
    authOutput: await wranglerText(target, ['auth', 'token', '--json']),
  });
  return auth.token;
}

async function writeEvidence(loaded, phase, evidence) {
  await writePrivateJson(
    join(loaded.evidenceRoot, evidenceFileForMetaLarkPhase(phase)),
    evidence,
  );
}

async function readEvidence(loaded, phase) {
  return JSON.parse(await readFile(
    join(loaded.evidenceRoot, evidenceFileForMetaLarkPhase(phase)),
    'utf8',
  ));
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

function assertConfigTableIds(configText, env, tableIds) {
  for (const key of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    const envName = LARK_TABLE_ENV[key];
    const value = tableIds[key];
    if (env?.[envName] !== value || readJsoncString(configText, envName) !== value) {
      throw failure(`Lark table mapping drift for ${key}`, 'META_LARK_TABLE_MAPPING_DRIFT');
    }
  }
}

function readJsoncString(text, key) {
  const regex = new RegExp(
    `["']?${escapeRegex(key)}["']?\\s*:\\s*["']([^"']+)["']`,
    'u',
  );
  return text.match(regex)?.[1] ?? null;
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (!path.startsWith(`${repositoryRoot}/`) && path !== repositoryRoot) {
    throw failure('Meta Lark config path must be inside Repository', 'META_LARK_PATH_INVALID');
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
    throw failure(
      'Deployment output did not contain exactly one Worker version ID',
      'META_LARK_DEPLOYMENT_VERSION_INVALID',
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

function readStringLike(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return null;
  return String(value).trim();
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
  if (!value) throw failure(`${name} is required`, 'META_LARK_LOCAL_CREDENTIAL_REQUIRED');
  return value;
}

function boundedInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) {
    throw failure('Meta Lark polling limit is invalid', 'META_LARK_POLLING_LIMIT_INVALID');
  }
  return number;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function failure(message, code) {
  const error = new Error(message);
  error.name = 'MetaLarkParityRolloutError';
  error.code = code;
  return error;
}
