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
  compareMetaLarkSnapshots,
  createMetaLarkEvidence,
  evidenceFileForMetaLarkPhase,
  loadMetaLarkTarget,
  normalizeMetaLarkSnapshot,
  parseMetaLarkOperatorArgs,
  previousMetaLarkPhase,
  safeMetaLarkTarget,
  validateMetaD1OnlySummaryForLark,
  validateMetaLarkEvidenceSequence,
  validateMetaLarkInventory,
} from './lib/meta-lark-parity-rollout-operator.js';
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
    await printPlan();
    return;
  }
  if (!options.execute) {
    throw operatorFailure(
      'Executable Meta Lark phases require --execute and an exact phase confirmation',
      'META_LARK_OPERATOR_EXECUTE_REQUIRED',
    );
  }
  const env = await loadEnvironment();
  assertMetaLarkConfirmation(options.phase, env);
  const loaded = await loadReviewedTarget(env);
  const state = await repositoryState();
  if (state.head !== loaded.target.repositoryHead || !state.clean) {
    throw operatorFailure(
      'Meta Lark rollout requires exact reviewed HEAD and a clean Working Tree',
      'META_LARK_REPOSITORY_STATE_INVALID',
    );
  }
  await mkdir(loaded.evidenceRoot, { recursive: true, mode: 0o700 });
  const prior = await readPriorEvidence(loaded, options.phase);
  const data = await runPhase(loaded, options.phase, env);
  const evidence = createEvidence(loaded.target, options.phase, data, prior, phasePermissions(options.phase));
  await writeEvidence(loaded, options.phase, evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function printPlan() {
  const plan = {
    contractVersion: META_LARK_OPERATOR_CONTRACT_VERSION,
    planOnly: true,
    phases: META_LARK_OPERATOR_PHASES,
    confirmations: META_LARK_CONFIRMATIONS,
    targets: ['facebook', 'instagram', 'chemistry_k2', 'chemistry_k3'],
    executionModel: 'lark_preflight_now_then_continue_each_d1_ready_target',
    reusesSourceStaging: true,
    reusesSameOperation: true,
    providerRequestsDuringContinuation: 0,
    larkMetadataPreflightMutationCount: 0,
    schedules: false,
    production: false,
    remoteActionsPerformed: false,
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function runPhase(loaded, phase, env) {
  switch (phase) {
    case 'lark-preflight': return runLarkPreflight(loaded, env);
    case 'd1-ready': return runD1Ready(loaded);
    case 'deploy-safe-baseline': return runDeployment(loaded, phase, 'safe');
    case 'verify-safe-baseline': return verifyDeployment(loaded, phase, 'safe');
    case 'deploy-lark-gates': return runDeployment(loaded, phase, 'active');
    case 'verify-lark-deployment': return verifyDeployment(loaded, phase, 'active');
    case 'snapshot-before': return { snapshot: await readSnapshot(loaded) };
    case 'send-lark-continuation': return sendQueuePhase(loaded, phase);
    case 'verify-lark': return verifyLarkCompletion(loaded);
    case 'resend-same-operation': return sendQueuePhase(loaded, phase);
    case 'verify-idempotent-rerun': return verifyLarkRerun(loaded);
    case 'restore-all-false': return runDeployment(loaded, phase, 'safe');
    case 'verify-restore': return verifyDeployment(loaded, phase, 'safe');
    case 'summary': return summarize(loaded);
    default: throw operatorFailure(`Unsupported Meta Lark phase: ${phase}`, 'META_LARK_OPERATOR_PHASE_INVALID');
  }
}

async function loadReviewedTarget(env) {
  const raw = loadMetaLarkTarget(env);
  const configPath = resolveRepositoryFile(raw.wranglerConfigPath);
  const d1SummaryPath = resolveRepositoryOrAbsoluteFile(raw.d1SummaryPath);
  const safeConfigText = await readFile(configPath, 'utf8');
  const config = buildMetaLarkConfigWindow(safeConfigText, raw);
  const tableIds = readLarkTableIdsFromEnv(env, META_END_TO_END_REQUIRED_LARK_TABLE_KEYS);
  assertConfigTableIds(safeConfigText, env, tableIds);
  const targetFingerprint = sha256(JSON.stringify({
    base: raw.targetFingerprint,
    safeConfigSha256: config.safeSha256,
    activeConfigSha256: config.activeSha256,
    bindingFingerprint: config.bindingFingerprint,
    tableIdFingerprint: sha256(JSON.stringify(Object.values(tableIds).sort())),
  }));
  const target = Object.freeze({
    ...raw,
    configPath,
    d1SummaryPath,
    targetFingerprint,
  });
  const evidenceRoot = join(outputRoot, target.targetKey, target.operationId);
  return Object.freeze({ target, config, tableIds, evidenceRoot });
}

async function runLarkPreflight(loaded, env) {
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const fieldsByKey = {};
  for (const key of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    fieldsByKey[key] = await client.listFields({ tableId: loaded.tableIds[key] });
  }
  const inventory = validateMetaLarkInventory({
    tableIds: loaded.tableIds,
    remoteTables,
    fieldsByKey,
  });
  return {
    target: safeMetaLarkTarget(loaded.target),
    inventory,
    larkRequestCount: 1 + META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.length,
    larkMutationCount: 0,
    recordReadCount: 0,
    credentialValuesPersisted: false,
    config: configEvidence(loaded.config),
  };
}

async function runD1Ready(loaded) {
  const summary = JSON.parse(await readFile(loaded.target.d1SummaryPath, 'utf8'));
  const validatedSummary = validateMetaD1OnlySummaryForLark(summary, loaded.target);
  const snapshot = await readSnapshot(loaded);
  assertD1ReadySnapshot(snapshot);
  const secretNames = await readSecretNames(loaded.target);
  for (const name of [loaded.target.requiredSecretName, 'LARK_APP_SECRET']) {
    if (!secretNames.includes(name)) {
      throw operatorFailure(`Required Worker Secret name is missing: ${name}`, 'META_LARK_REQUIRED_SECRET_MISSING');
    }
  }
  return {
    d1Summary: validatedSummary,
    snapshot,
    requiredSecretNamesPresent: true,
    providerRequests: 0,
    larkMutationCount: 0,
  };
}

function assertD1ReadySnapshot(snapshotInput) {
  const snapshot = normalizeMetaLarkSnapshot(snapshotInput);
  const ready = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === null
    && snapshot.d1PhaseComplete
    && !snapshot.preflightPhaseComplete
    && !snapshot.larkPhaseComplete
    && !snapshot.completionPhaseComplete
    && snapshot.activeLockCount === 0
    && snapshot.coverageRunCount > 0
    && snapshot.invalidCoverageCount === 0
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.workCompletedAt === null;
  if (!ready) {
    throw operatorFailure('Meta target has not reached the accepted D1-only boundary', 'META_LARK_D1_BOUNDARY_INVALID');
  }
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
      'deploy', '--config', configPath, '--message',
      `${META_LARK_OPERATOR_CONTRACT_VERSION} phase=${phase} git=${loaded.target.repositoryHead}`
        + ` target=${loaded.target.targetKey}`,
    ],
  ));
  return {
    mode,
    repositoryHead: loaded.target.repositoryHead,
    activeVersionBefore: priorVersion,
    deploymentVersionId: extractVersionId(result.stdout),
    localBundleSha256: bundle.sha256,
    stdoutSha256: sha256(result.stdout),
    configSha256: mode === 'active' ? loaded.config.activeSha256 : loaded.config.safeSha256,
    trueFlags: mode === 'active' ? loaded.config.activeTrueFlags : [],
    commandExitCode: 0,
  };
}

async function verifyDeployment(loaded, phase, mode) {
  const deployPhase = phase === 'verify-safe-baseline'
    ? 'deploy-safe-baseline'
    : phase === 'verify-lark-deployment'
      ? 'deploy-lark-gates'
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
    larkWriteEnabled: mode === 'active',
    schedulesEnabled: false,
  };
}

async function sendQueuePhase(loaded, phase) {
  const attemptPath = join(loaded.evidenceRoot, `${phase}.attempt.json`);
  try {
    await stat(attemptPath);
    throw operatorFailure(`Queue send attempt already exists for ${phase}`, 'META_LARK_QUEUE_SEND_ALREADY_ATTEMPTED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const job = buildMetaLarkContinuationJob(loaded.target);
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
    providerRequestsExpected: 0,
    automaticResend: false,
  };
}

async function verifyLarkCompletion(loaded) {
  const before = (await readEvidence(loaded, 'snapshot-before')).data?.snapshot;
  const after = await pollForLarkCompletion(loaded);
  return {
    comparison: compareMetaLarkSnapshots(before, after, loaded.target),
    snapshotAfter: after,
    providerRequestCount: 0,
  };
}

async function verifyLarkRerun(loaded) {
  const before = (await readEvidence(loaded, 'verify-lark')).data?.snapshotAfter;
  const minimumAttempts = normalizeMetaLarkSnapshot(before).queueOperationAttempts + 1;
  const after = await pollForRerun(loaded, minimumAttempts);
  return {
    comparison: compareMetaLarkSnapshots(before, after, loaded.target, { rerun: true }),
    snapshotAfter: after,
    providerRequestCount: 0,
  };
}

async function pollForLarkCompletion(loaded) {
  const maxPolls = positiveInteger(process.env.MKT_META_LARK_VERIFY_MAX_POLLS, 120);
  const intervalMs = positiveInteger(process.env.MKT_META_LARK_VERIFY_POLL_INTERVAL_MS, 5_000);
  let snapshot;
  for (let index = 0; index < maxPolls; index += 1) {
    snapshot = await readSnapshot(loaded);
    if (classifyMetaLarkCompletion(snapshot, loaded.target).complete) return snapshot;
    if (index + 1 < maxPolls) await sleep(intervalMs);
  }
  const error = operatorFailure('Bounded verification did not observe Meta Lark completion', 'META_LARK_VERIFY_TIMEOUT');
  error.emergencyRestoreRequired = true;
  throw error;
}

async function pollForRerun(loaded, minimumAttempts) {
  const maxPolls = positiveInteger(process.env.MKT_META_LARK_RERUN_MAX_POLLS, 30);
  const intervalMs = positiveInteger(process.env.MKT_META_LARK_VERIFY_POLL_INTERVAL_MS, 5_000);
  let snapshot;
  for (let index = 0; index < maxPolls; index += 1) {
    snapshot = await readSnapshot(loaded);
    const normalized = normalizeMetaLarkSnapshot(snapshot);
    if (normalized.queueOperationAttempts >= minimumAttempts
      && classifyMetaLarkCompletion(normalized, loaded.target).complete) return normalized;
    if (index + 1 < maxPolls) await sleep(intervalMs);
  }
  const error = operatorFailure('Bounded verification did not observe Meta Lark idempotent rerun', 'META_LARK_RERUN_VERIFY_TIMEOUT');
  error.emergencyRestoreRequired = true;
  throw error;
}

async function summarize(loaded) {
  const evidence = [];
  for (const phase of META_LARK_OPERATOR_PHASES.slice(1, -1)) {
    evidence.push(await readEvidence(loaded, phase));
  }
  const validated = validateMetaLarkEvidenceSequence(evidence, loaded.target);
  const final = validated.at(-1);
  if (final.phase !== 'verify-restore' || final.data?.mode !== 'safe') {
    throw operatorFailure('Meta Lark summary requires a verified all-false restore', 'META_LARK_SUMMARY_RESTORE_INCOMPLETE');
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
  return normalizeMetaLarkSnapshot(await readD1Row(
    loaded.target,
    buildMetaLarkSnapshotSql(loaded.target),
  ));
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
    throw operatorFailure('Guarded restore requires chain-bound Lark activation evidence', 'META_LARK_RESTORE_EVIDENCE_MISSING');
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
    'send-lark-continuation', 'verify-lark', 'resend-same-operation', 'verify-idempotent-rerun',
  ]);
  return {
    remoteMutationPerformed: deployment.has(phase)
      || phase === 'send-lark-continuation'
      || phase === 'resend-same-operation',
    larkWritesAllowed: larkWrite.has(phase),
  };
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
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
      const result = await wrangler(target, ['deploy', '--dry-run', '--outdir', directory, '--config', configPath]);
      const bytes = await readFile(output);
      return { sha256: sha256(bytes), stdoutSha256: sha256(result.stdout) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function withGeneratedConfig(target, text, callback) {
  const path = join(repositoryRoot, `.meta-lark-${process.pid}-${Date.now()}-${basename(target.configPath)}`);
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
    '--config', target.configPath, '--command', sql,
  ]);
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) throw operatorFailure('Remote D1 query returned no row', 'META_LARK_D1_QUERY_EMPTY');
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
    throw operatorFailure('Worker does not have exactly one 100% active version', 'META_LARK_ACTIVE_VERSION_INVALID');
  }
  if (expected && active[0].version_id !== expected) {
    throw operatorFailure('Worker active version differs from the reviewed target', 'META_LARK_ACTIVE_VERSION_MISMATCH');
  }
  return active[0].version_id;
}

async function readVersionView(target, versionId) {
  return JSON.parse(await wranglerText(target, [
    'versions', 'view', versionId, '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]));
}

async function readQueueConsumers(queueName) {
  const result = await execFileAsync('npx', ['wrangler', 'queues', 'consumer', 'list', queueName, '--json'], commandOptions());
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.consumers ?? []);
}

function assertRemoteFlags(versionView, expectedTrue) {
  const observed = readAllRemoteEnabledFlags(versionView);
  if (JSON.stringify(observed) !== JSON.stringify([...expectedTrue].sort())) {
    throw operatorFailure(`Remote Worker flags differ from approved Meta Lark window: ${observed.join(', ')}`, 'META_LARK_REMOTE_FLAG_MISMATCH');
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
  if (!entry) throw operatorFailure(`Queue consumer is missing for ${queueName}`, 'META_LARK_QUEUE_TOPOLOGY_INVALID');
  const observed = {
    maxConcurrency: Number(entry.max_concurrency ?? entry.settings?.max_concurrency),
    maxBatchSize: Number(entry.max_batch_size ?? entry.settings?.max_batch_size),
    maxBatchTimeout: Number(entry.max_batch_timeout ?? entry.settings?.max_batch_timeout),
    maxRetries: Number(entry.max_retries ?? entry.settings?.max_retries),
    deadLetterQueue: entry.dead_letter_queue ?? entry.settings?.dead_letter_queue ?? null,
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((observed[key] ?? null) !== value) {
      throw operatorFailure(`Queue consumer drift for ${queueName}: ${key}`, 'META_LARK_QUEUE_TOPOLOGY_INVALID');
    }
  }
}

async function sendQueueMessage(job, target) {
  const token = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = target.accountId ?? requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const queueId = target.queueId ?? requiredEnv('MKT_META_LARK_QUEUE_ID');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`
      + `/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const responseBody = await response.json().catch(() => null);
  if (!response.ok || responseBody?.success !== true) {
    const error = operatorFailure(`Cloudflare Queue did not accept the Meta Lark operation (HTTP ${response.status})`, 'META_LARK_QUEUE_SEND_FAILED');
    error.emergencyRestoreRequired = true;
    throw error;
  }
}

async function writeEvidence(loaded, phase, evidence) {
  await writePrivateJson(join(loaded.evidenceRoot, evidenceFileForMetaLarkPhase(phase)), evidence);
}

async function readEvidence(loaded, phase) {
  return JSON.parse(await readFile(join(loaded.evidenceRoot, evidenceFileForMetaLarkPhase(phase)), 'utf8'));
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
    if (env?.[envName] !== value || !configContainsString(configText, envName, value)) {
      throw operatorFailure(`Lark table mapping drift for ${key}`, 'META_LARK_TABLE_MAPPING_DRIFT');
    }
  }
}

function configContainsString(text, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`${escapedKey}\\s*=\\s*["']${escapedValue}["']`, 'u').test(text);
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (!path.startsWith(`${repositoryRoot}/`) && path !== repositoryRoot) {
    throw operatorFailure('Meta Lark config path must be inside the Repository', 'META_LARK_PATH_INVALID');
  }
  return path;
}

function resolveRepositoryOrAbsoluteFile(value) {
  return value.startsWith('/') ? resolve(value) : resolveRepositoryFile(value);
}

function extractVersionId(output) {
  const matches = String(output).match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu) ?? [];
  const unique = [...new Set(matches.map((item) => item.toLowerCase()))];
  if (unique.length !== 1) throw operatorFailure('Deployment output did not contain exactly one Worker version ID', 'META_LARK_DEPLOYMENT_VERSION_INVALID');
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
    env: { ...process.env, ...(target.accountId ? { CLOUDFLARE_ACCOUNT_ID: target.accountId } : {}) },
  });
}

function commandOptions() {
  return { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw operatorFailure(`${name} is required`, 'META_LARK_LOCAL_CREDENTIAL_REQUIRED');
  return value;
}

function positiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) {
    throw operatorFailure('Meta Lark polling limit is invalid', 'META_LARK_POLLING_LIMIT_INVALID');
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
  error.name = 'MetaLarkParityRolloutError';
  error.code = code;
  return error;
}
