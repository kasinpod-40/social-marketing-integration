#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import {
  normalizeScopedWranglerQueueConsumers,
} from './lib/youtube-live-remote-contract-parser.js';
import {
  YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS,
  YOUTUBE_LARK_UAT_CONFIRMATIONS,
  YOUTUBE_LARK_UAT_CONTRACT_VERSION,
  YOUTUBE_LARK_UAT_PHASES,
  YOUTUBE_LARK_UAT_REQUIRED_POSITIVE_COUNT_KEYS,
  YOUTUBE_LARK_UAT_REQUIRED_TABLE_KEYS,
  assertYouTubeLarkUatConfirmation,
  buildYouTubeLarkFullSyncJob,
  buildYouTubeLarkUatConfigWindow,
  buildYouTubeLarkUatSnapshotSql,
  classifyYouTubeLarkCounts,
  classifyYouTubeLarkUatCompletion,
  compareYouTubeLarkUatRerun,
  createYouTubeLarkUatEvidence,
  evidenceFileForYouTubeLarkUatPhase,
  loadYouTubeLarkUatTarget,
  normalizeYouTubeLarkUatSnapshot,
  parseYouTubeLarkUatArgs,
  validateYouTubeLarkUatEvidence,
} from './lib/youtube-lark-full-sync-uat-operator.js';
import {
  createLarkBitableClientFromEnv,
} from '../packages/connectors/src/lark/lark-bitable.client.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_YOUTUBE_LARK_UAT_EVIDENCE_DIR
    ?? join(repositoryRoot, 'outputs', 'youtube-lark-full-sync-uat'),
);
const REQUIRED_SECRET_NAMES = Object.freeze([
  'LARK_APP_ID',
  'LARK_APP_SECRET',
  'YOUTUBE_API_KEY',
]);
const EXPECTED_CRONS = Object.freeze(['*/5 * * * *', '50 0 * * *']);
const BUSINESS_KEY_FIELDS = Object.freeze({
  rawYouTubeChannels: 'raw_channel_key',
  rawYouTubeVideos: 'raw_video_key',
  rawYouTubeAnalyticsDaily: 'raw_analytics_daily_key',
  mktAccounts: 'account_key',
  mktContent: 'content_key',
  mktContentDaily: 'content_daily_key',
});

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'YOUTUBE_LARK_UAT_OPERATOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    diagnostic: sanitizeDiagnostic(error?.details),
    remoteMutation: error?.remoteMutation ?? 'NONE_OR_PHASE_SCOPED',
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseYouTubeLarkUatArgs(process.argv.slice(2));
  if (options.phase === 'plan') {
    process.stdout.write(`${JSON.stringify({
      contractVersion: YOUTUBE_LARK_UAT_CONTRACT_VERSION,
      planOnly: true,
      phases: YOUTUBE_LARK_UAT_PHASES,
      confirmations: YOUTUBE_LARK_UAT_CONFIRMATIONS,
      activeTrueFlags: YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS,
      firstRunAnalyticsEnabled: false,
      scheduleActivationCount: 0,
      production: false,
      remoteActionsPerformed: false,
    }, null, 2)}\n`);
    return;
  }
  if (!options.execute) {
    throw failure(
      'Executable YouTube Lark UAT phases require --execute and exact confirmation',
      'YOUTUBE_LARK_UAT_EXECUTE_REQUIRED',
    );
  }

  const env = await loadEnvironment();
  assertYouTubeLarkUatConfirmation(options.phase, env);
  const loaded = await loadReviewedTarget(env);
  const state = await repositoryState();
  if (state.head !== loaded.target.repositoryHead || !state.clean) {
    throw failure(
      'YouTube Lark UAT requires exact reviewed HEAD and a clean Working Tree',
      'YOUTUBE_LARK_UAT_REPOSITORY_STATE_INVALID',
      { expectedHead: loaded.target.repositoryHead, observedHead: state.head, clean: state.clean },
    );
  }
  if (state.head !== state.originMainHead) {
    throw failure(
      'YouTube Lark UAT requires local HEAD equal to origin/main',
      'YOUTUBE_LARK_UAT_MAIN_CHANGED',
      { repositoryHead: state.head, originMainHead: state.originMainHead },
    );
  }

  await mkdir(loaded.evidenceRoot, { recursive: true, mode: 0o700 });
  const prior = await readPriorEvidence(loaded, options.phase);
  const data = await runPhase(loaded, options.phase, env);
  const evidence = createYouTubeLarkUatEvidence({
    phase: options.phase,
    repositoryHead: loaded.target.repositoryHead,
    targetFingerprint: loaded.target.targetFingerprint,
    operationId: loaded.target.operationId,
    priorEvidenceSha256: prior?.evidenceSha256 ?? null,
    data,
  });
  await writeEvidence(loaded, options.phase, evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

async function loadReviewedTarget(env) {
  const rawTarget = loadYouTubeLarkUatTarget(env);
  const configPath = resolveRepositoryFile(rawTarget.wranglerConfigPath);
  const sourceText = await readFile(configPath, 'utf8');
  const config = buildYouTubeLarkUatConfigWindow(sourceText, {
    channelId: rawTarget.channelId,
  });
  const target = Object.freeze({
    ...rawTarget,
    configPath,
    targetFingerprint: sha256(stableJson({
      baseTargetFingerprint: rawTarget.targetFingerprint,
      safeConfigSha256: config.safeSha256,
      activeConfigSha256: config.activeSha256,
      bindingFingerprint: config.bindingFingerprint,
      tableIdFingerprint: config.tableIdFingerprint,
    })),
  });
  return Object.freeze({
    target,
    config,
    evidenceRoot: join(outputRoot, target.operationId),
  });
}

async function repositoryState() {
  await gitText(['fetch', 'origin', 'main', '--quiet']);
  const [head, originMainHead, dirty] = await Promise.all([
    gitText(['rev-parse', 'HEAD']),
    gitText(['rev-parse', 'origin/main']),
    gitText(['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  return Object.freeze({ head, originMainHead, clean: dirty.trim() === '' });
}

async function runPhase(loaded, phase, env) {
  switch (phase) {
    case 'lark-preflight':
      return runLarkPreflight(loaded, env);
    case 'remote-preflight':
      return runRemotePreflight(loaded, env);
    case 'backup':
      return runBackup(loaded);
    case 'deploy-active':
      return runDeployment(loaded, phase, 'active');
    case 'verify-active':
      return verifyDeployment(loaded, phase, 'active', env);
    case 'snapshot-before':
      return runSnapshotBefore(loaded, env);
    case 'send-full-sync':
    case 'resend-same-operation':
      return sendQueuePhase(loaded, phase, env);
    case 'verify-full-sync':
      return verifyFullSync(loaded, env);
    case 'verify-idempotent-rerun':
      return verifyIdempotentRerun(loaded, env);
    case 'restore-all-false':
      return runDeployment(loaded, phase, 'safe');
    case 'verify-restore':
      return verifyDeployment(loaded, phase, 'safe', env);
    case 'summary':
      return summarize(loaded);
    default:
      throw failure(`Unsupported YouTube Lark UAT phase: ${phase}`, 'YOUTUBE_LARK_UAT_PHASE_INVALID');
  }
}

async function runLarkPreflight(loaded, env) {
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const remoteIds = new Set(remoteTables.map(readTableId).filter(Boolean));
  const seenIds = new Set();
  const fieldCounts = {};
  const missingTables = [];
  const missingKeyFields = [];

  for (const key of YOUTUBE_LARK_UAT_REQUIRED_TABLE_KEYS) {
    const tableId = loaded.config.tableIds[key];
    if (seenIds.has(tableId)) {
      throw failure(
        'YouTube Lark UAT table IDs must be unique',
        'YOUTUBE_LARK_UAT_DUPLICATE_TABLE_ID',
        { tableKey: key },
      );
    }
    seenIds.add(tableId);
    if (!remoteIds.has(tableId)) missingTables.push(key);
    const fields = await client.listFields({ tableId });
    fieldCounts[key] = fields.length;
    const keyField = BUSINESS_KEY_FIELDS[key];
    if (keyField && !fields.some((field) => readFieldName(field) === keyField)) {
      missingKeyFields.push(`${key}.${keyField}`);
    }
    if (!keyField && fields.length === 0) missingKeyFields.push(`${key}.<any_field>`);
  }
  if (missingTables.length > 0 || missingKeyFields.length > 0) {
    throw failure(
      'YouTube Lark UAT destination inventory is incomplete',
      'YOUTUBE_LARK_UAT_LARK_PREFLIGHT_INCOMPLETE',
      { missingTables, missingKeyFields },
    );
  }
  const counts = await readScopedLarkCounts(client, loaded);
  return Object.freeze({
    tableCount: YOUTUBE_LARK_UAT_REQUIRED_TABLE_KEYS.length,
    tableIdFingerprint: sha256(stableJson([...seenIds].sort())),
    fieldCountFingerprint: sha256(stableJson(fieldCounts)),
    counts,
    larkMetadataMutationCount: 0,
    credentialValuesPersisted: false,
  });
}

async function runRemotePreflight(loaded, env) {
  const [safeBundle, activeBundle, status, migrations, secretNames, snapshot] = await Promise.all([
    buildBundle(loaded, loaded.config.safeText, 'safe-preflight'),
    buildBundle(loaded, loaded.config.activeText, 'active-preflight'),
    readDeploymentStatus(loaded.target),
    wranglerText([
      'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote',
      '--config', loaded.target.configPath,
    ]),
    readSecretNames(loaded.target),
    readSnapshot(loaded),
  ]);
  const activeVersion = requireSingleActiveVersion(status);
  const [versionView, mainConsumers, dlqConsumers, triggerState] = await Promise.all([
    readVersionView(loaded.target, activeVersion),
    readQueueConsumers(loaded.target.mainQueueName),
    readQueueConsumers(loaded.target.dlqName),
    readRemoteTriggerState(loaded.target, env),
  ]);
  const contract = assertRemoteContract({
    loaded,
    versionView,
    mainConsumers,
    dlqConsumers,
    triggerState,
    mode: 'safe',
  });
  const pendingMigrations = [...migrations.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0]);
  if (pendingMigrations.length > 0) {
    throw failure(
      `Pending migrations block YouTube Lark UAT: ${pendingMigrations.join(', ')}`,
      'YOUTUBE_LARK_UAT_PENDING_MIGRATIONS',
      { pendingMigrations },
    );
  }
  const missingSecrets = REQUIRED_SECRET_NAMES.filter((name) => !secretNames.includes(name));
  if (missingSecrets.length > 0) {
    throw failure(
      'Required YouTube/Lark Worker Secret names are missing',
      'YOUTUBE_LARK_UAT_REQUIRED_SECRET_MISSING',
      { missingSecrets },
    );
  }
  assertFreshOperation(snapshot);
  return Object.freeze({
    activeVersion,
    activeTraffic: 100,
    safeBundleSha256: safeBundle.sha256,
    activeBundleSha256: activeBundle.sha256,
    safeConfigSha256: loaded.config.safeSha256,
    activeConfigSha256: loaded.config.activeSha256,
    bindingFingerprint: loaded.config.bindingFingerprint,
    tableIdFingerprint: loaded.config.tableIdFingerprint,
    remoteFlagFingerprint: contract.remoteFlagFingerprint,
    remoteTableMappingFingerprint: contract.remoteTableMappingFingerprint,
    queueTopologyVerified: true,
    triggerStateVerified: true,
    pendingMigrations,
    requiredSecretNameCount: REQUIRED_SECRET_NAMES.length,
    operationFresh: true,
    remoteMutationCount: 0,
  });
}

async function runBackup(loaded) {
  const remote = await readEvidence(loaded, 'remote-preflight');
  await assertActiveVersionUnchanged(loaded.target, remote.data.activeVersion);
  const backupDir = join(loaded.evidenceRoot, 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const outputPath = join(backupDir, `youtube-lark-uat-before-${loaded.target.operationId}.sql`);
  await wrangler([
    'd1', 'export', 'MKT_STATE_DB', '--remote',
    '--config', loaded.target.configPath,
    '--output', outputPath,
  ]);
  await chmod(outputPath, 0o600);
  const bytes = await readFile(outputPath);
  if (bytes.length === 0) {
    throw failure('YouTube Lark UAT D1 backup is empty', 'YOUTUBE_LARK_UAT_BACKUP_EMPTY');
  }
  return Object.freeze({
    activeVersion: remote.data.activeVersion,
    backupFile: relative(repositoryRoot, outputPath),
    backupBytes: bytes.length,
    backupSha256: sha256(bytes),
    d1BusinessMutationCount: 0,
  });
}

async function runDeployment(loaded, phase, mode) {
  const expectedBefore = mode === 'active'
    ? (await readEvidence(loaded, 'remote-preflight')).data.activeVersion
    : await resolveRestoreExpectedVersion(loaded);
  await assertActiveVersionUnchanged(loaded.target, expectedBefore);
  const attemptPath = join(loaded.evidenceRoot, `${phase}.attempt.json`);
  await assertAttemptAbsent(attemptPath, phase);
  const text = mode === 'active' ? loaded.config.activeText : loaded.config.safeText;
  await writePrivateJson(attemptPath, {
    phase,
    mode,
    repositoryHead: loaded.target.repositoryHead,
    targetFingerprint: loaded.target.targetFingerprint,
    expectedActiveVersion: expectedBefore,
    configSha256: mode === 'active' ? loaded.config.activeSha256 : loaded.config.safeSha256,
    attemptedAt: new Date().toISOString(),
  });
  const bundle = await buildBundle(loaded, text, phase);
  const result = await withGeneratedConfig(loaded, text, async (configPath) => wrangler([
    'deploy', '--config', configPath,
    '--message', `${YOUTUBE_LARK_UAT_CONTRACT_VERSION} phase=${phase}`
      + ` git=${loaded.target.repositoryHead} operation=${loaded.target.operationId}`,
  ]));
  const deploymentVersionId = extractVersionId(result.stdout);
  return Object.freeze({
    mode,
    activeVersionBefore: expectedBefore,
    deploymentVersionId,
    localBundleSha256: bundle.sha256,
    configSha256: mode === 'active' ? loaded.config.activeSha256 : loaded.config.safeSha256,
    trueFlags: mode === 'active' ? loaded.config.activeTrueFlags : [],
    commandExitCode: 0,
    stdoutSha256: sha256(result.stdout),
    remoteMutation: 'WORKER_DEPLOYMENT',
  });
}

async function verifyDeployment(loaded, phase, mode, env) {
  const deployPhase = mode === 'active' ? 'deploy-active' : 'restore-all-false';
  const deployment = await readEvidence(loaded, deployPhase);
  const expectedVersion = deployment.data.deploymentVersionId;
  const [status, versionView, mainConsumers, dlqConsumers, triggerState] = await Promise.all([
    readDeploymentStatus(loaded.target),
    readVersionView(loaded.target, expectedVersion),
    readQueueConsumers(loaded.target.mainQueueName),
    readQueueConsumers(loaded.target.dlqName),
    readRemoteTriggerState(loaded.target, env),
  ]);
  const activeVersion = requireSingleActiveVersion(status, expectedVersion);
  const contract = assertRemoteContract({
    loaded,
    versionView,
    mainConsumers,
    dlqConsumers,
    triggerState,
    mode,
  });
  return Object.freeze({
    mode,
    activeVersion,
    expectedTrueFlags: mode === 'active' ? loaded.config.activeTrueFlags : [],
    remoteFlagFingerprint: contract.remoteFlagFingerprint,
    remoteTableMappingFingerprint: contract.remoteTableMappingFingerprint,
    queueTopologyVerified: true,
    triggerStateVerified: true,
    schedulesEnabled: false,
    larkWriteEnabled: mode === 'active',
  });
}

async function runSnapshotBefore(loaded, env) {
  const active = await readEvidence(loaded, 'verify-active');
  await assertActiveVersionUnchanged(loaded.target, active.data.activeVersion);
  const client = createLarkBitableClientFromEnv(env);
  const [snapshot, larkCounts] = await Promise.all([
    readSnapshot(loaded),
    readScopedLarkCounts(client, loaded),
  ]);
  assertFreshOperation(snapshot);
  return Object.freeze({ snapshot, larkCounts, operationFresh: true });
}

async function sendQueuePhase(loaded, phase, env) {
  const active = await readEvidence(loaded, 'verify-active');
  await assertActiveVersionUnchanged(loaded.target, active.data.activeVersion);
  const queueId = requireText(env.MKT_YOUTUBE_LARK_UAT_QUEUE_ID, 'MKT_YOUTUBE_LARK_UAT_QUEUE_ID');
  const accountId = requireText(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requireText(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
  const job = buildYouTubeLarkFullSyncJob(loaded.target);
  const attemptPath = join(loaded.evidenceRoot, `${phase}.attempt.json`);
  await assertAttemptAbsent(attemptPath, phase);
  await writePrivateJson(attemptPath, {
    phase,
    operationId: loaded.target.operationId,
    workKey: loaded.target.workKey,
    generation: loaded.target.generation,
    jobSha256: sha256(stableJson(job)),
    attemptedAt: new Date().toISOString(),
  });
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`
      + `/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const responseBody = await response.json().catch(() => null);
  if (!response.ok || responseBody?.success !== true) {
    throw failure(
      `Cloudflare Queue accepted no YouTube Lark UAT message (HTTP ${response.status}); automatic resend is disabled`,
      'YOUTUBE_LARK_UAT_QUEUE_SEND_FAILED',
      { status: response.status },
      'QUEUE_SEND_ATTEMPTED',
    );
  }
  return Object.freeze({
    queueSendCommandCount: 1,
    accepted: true,
    operationId: loaded.target.operationId,
    workKey: loaded.target.workKey,
    generation: loaded.target.generation,
    jobSha256: sha256(stableJson(job)),
    remoteMutation: 'QUEUE_MESSAGE_SENT',
  });
}

async function verifyFullSync(loaded, env) {
  const after = await pollForCompletion(loaded, { minimumMainQueueAttempts: 1 });
  const completion = classifyYouTubeLarkUatCompletion(after);
  if (!completion.complete) {
    throw failure(
      'YouTube Lark UAT completion evidence is incomplete',
      'YOUTUBE_LARK_UAT_COMPLETION_INCOMPLETE',
      { missing: completion.missing },
    );
  }
  const client = createLarkBitableClientFromEnv(env);
  const lark = classifyYouTubeLarkCounts(await readScopedLarkCounts(client, loaded));
  if (!lark.complete) {
    throw failure(
      'YouTube Lark UAT did not repopulate all required Lark targets',
      'YOUTUBE_LARK_UAT_LARK_COUNTS_INCOMPLETE',
      { missingPositive: lark.missingPositive },
    );
  }
  return Object.freeze({
    completionObserved: true,
    snapshot: completion.snapshot,
    lark,
    analyticsEnabled: false,
    analyticsRowsRequired: false,
  });
}

async function verifyIdempotentRerun(loaded, env) {
  const initial = await readEvidence(loaded, 'verify-full-sync');
  const after = await pollForCompletion(loaded, { minimumMainQueueAttempts: 2 });
  const completion = classifyYouTubeLarkUatCompletion(after);
  if (!completion.complete) {
    throw failure(
      'YouTube Lark UAT rerun completion evidence is incomplete',
      'YOUTUBE_LARK_UAT_RERUN_INCOMPLETE',
      { missing: completion.missing },
    );
  }
  const client = createLarkBitableClientFromEnv(env);
  const afterLark = await readScopedLarkCounts(client, loaded);
  const comparison = compareYouTubeLarkUatRerun({
    before: initial.data.snapshot,
    after: completion.snapshot,
    beforeLark: initial.data.lark.counts,
    afterLark,
  });
  return Object.freeze({
    completionObserved: true,
    snapshot: completion.snapshot,
    lark: classifyYouTubeLarkCounts(afterLark),
    ...comparison,
  });
}

async function pollForCompletion(loaded, input = {}) {
  const maxPolls = positiveInteger(process.env.MKT_YOUTUBE_LARK_UAT_VERIFY_MAX_POLLS ?? 12, 'maxPolls');
  const intervalMs = positiveInteger(
    process.env.MKT_YOUTUBE_LARK_UAT_VERIFY_POLL_INTERVAL_MS ?? 5_000,
    'pollIntervalMs',
  );
  const minimumAttempts = positiveInteger(input.minimumMainQueueAttempts ?? 1, 'minimumMainQueueAttempts');
  let snapshot = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    snapshot = await readSnapshot(loaded);
    const completion = classifyYouTubeLarkUatCompletion(snapshot);
    if (completion.complete && completion.snapshot.mainQueueAttempts >= minimumAttempts) {
      return completion.snapshot;
    }
    if (attempt < maxPolls) await sleep(intervalMs);
  }
  throw failure(
    'Bounded verification did not observe completed YouTube Lark UAT state',
    'YOUTUBE_LARK_UAT_VERIFY_TIMEOUT',
    { minimumMainQueueAttempts: minimumAttempts },
  );
}

async function summarize(loaded) {
  const evidence = [];
  for (const phase of YOUTUBE_LARK_UAT_PHASES.slice(1, -1)) {
    evidence.push(await readEvidence(loaded, phase));
  }
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    const expectedPrior = index === 0 ? null : evidence[index - 1].evidenceSha256;
    if (item.priorEvidenceSha256 !== expectedPrior) {
      throw failure(
        'YouTube Lark UAT evidence chain is discontinuous',
        'YOUTUBE_LARK_UAT_EVIDENCE_CHAIN_INVALID',
        { phase: item.phase },
      );
    }
  }
  if (evidence.at(-1)?.phase !== 'verify-restore') {
    throw failure(
      'YouTube Lark UAT summary requires verified all-false restore',
      'YOUTUBE_LARK_UAT_SUMMARY_RESTORE_INCOMPLETE',
    );
  }
  return Object.freeze({
    accepted: true,
    fullSyncVerified: true,
    idempotentRerunVerified: true,
    restoredAllFalse: true,
    analyticsEnabled: false,
    scheduleActivationCount: 0,
    productionAllowed: false,
    evidencePhaseCount: evidence.length,
    evidenceChainHeadSha256: evidence.at(-1).evidenceSha256,
    queueSendCommandCount: evidence
      .filter((item) => ['send-full-sync', 'resend-same-operation'].includes(item.phase))
      .reduce((sum, item) => sum + Number(item.data.queueSendCommandCount ?? 0), 0),
  });
}

async function readScopedLarkCounts(client, loaded) {
  const tableIds = loaded.config.tableIds;
  const channelId = loaded.target.channelId;
  const accountKey = loaded.target.accountKey;
  const filters = {
    rawYouTubeChannels: [{ field_name: 'channel_id', operator: 'is', value: [channelId] }],
    rawYouTubeVideos: [{ field_name: 'channel_id', operator: 'is', value: [channelId] }],
    rawYouTubeAnalyticsDaily: [{ field_name: 'channel_id', operator: 'is', value: [channelId] }],
    mktAccounts: [
      { field_name: 'platform', operator: 'is', value: ['youtube'] },
      { field_name: 'account_id', operator: 'is', value: [channelId] },
    ],
    mktContent: [
      { field_name: 'platform', operator: 'is', value: ['youtube'] },
      { field_name: 'account_id', operator: 'is', value: [accountKey] },
    ],
    mktContentDaily: [
      { field_name: 'platform', operator: 'is', value: ['youtube'] },
      { field_name: 'account_id', operator: 'is', value: [accountKey] },
    ],
  };
  const counts = {
    mktSyncLog: 0,
    mktSystemAlerts: 0,
  };
  for (const [key, conditions] of Object.entries(filters)) {
    const records = await client.searchRecords({
      tableId: tableIds[key],
      filter: { conjunction: 'and', conditions },
      pageSize: 500,
      maxPages: 1_000,
    });
    counts[key] = records.length;
  }
  return Object.freeze(counts);
}

function assertFreshOperation(snapshotInput) {
  const snapshot = normalizeYouTubeLarkUatSnapshot(snapshotInput);
  const existing = [];
  if (snapshot.syncRunStatus !== null) existing.push('syncRun');
  if (snapshot.workStatus !== null || snapshot.workLifecycleStatus !== null) existing.push('work');
  if (snapshot.queueOperationAttempts !== 0 || snapshot.mainQueueAttempts !== 0) existing.push('queueAttempts');
  if (snapshot.dlqRecords !== 0) existing.push('dlq');
  if (snapshot.activeLockCount !== 0) existing.push('activeLock');
  if (snapshot.completionJsonPresent !== 0) existing.push('completion');
  if (existing.length > 0) {
    throw failure(
      'YouTube Lark UAT operation identity already exists or is active',
      'YOUTUBE_LARK_UAT_OPERATION_NOT_FRESH',
      { existing },
    );
  }
  return true;
}

function assertRemoteContract(input) {
  const expectedTrue = input.mode === 'active'
    ? [...input.loaded.config.activeTrueFlags].sort()
    : [];
  const bindings = readVersionBindings(input.versionView);
  const enabledBindings = bindings.filter((binding) => normalizeBindingType(binding?.type) === 'plain_text'
    && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(readBindingName(binding) ?? ''));
  const byName = new Map();
  for (const binding of enabledBindings) {
    const name = readBindingName(binding);
    if (byName.has(name)) {
      throw failure(
        'Remote Worker contains a duplicate execution flag binding',
        'YOUTUBE_LARK_UAT_REMOTE_FLAG_DUPLICATE',
        { name },
      );
    }
    byName.set(name, readRemoteBoolean(binding?.text ?? binding?.value, name));
  }
  const remoteTrue = [...byName.entries()]
    .filter(([, value]) => value)
    .map(([name]) => name)
    .sort();
  if (stableJson(remoteTrue) !== stableJson(expectedTrue)) {
    throw failure(
      'Remote Worker true flags differ from the reviewed YouTube Lark UAT window',
      'YOUTUBE_LARK_UAT_REMOTE_FLAG_MISMATCH',
      { expectedTrue, remoteTrue },
    );
  }
  for (const name of expectedTrue) {
    if (byName.get(name) !== true) {
      throw failure(
        'Remote Worker omitted a required active YouTube Lark UAT flag',
        'YOUTUBE_LARK_UAT_REMOTE_FLAG_MISMATCH',
        { name },
      );
    }
  }

  const d1 = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB'
      && normalizeBindingType(binding?.type) === 'd1'
  ), 'MKT_STATE_DB');
  const databaseId = String(d1.database_id ?? d1.databaseId ?? d1.id ?? '').toLowerCase();
  if (databaseId !== input.loaded.config.databaseId) {
    throw failure('Remote D1 UUID differs from the reviewed database', 'YOUTUBE_LARK_UAT_REMOTE_D1_MISMATCH');
  }
  const databaseName = String(d1.database_name ?? d1.databaseName ?? input.loaded.target.databaseName);
  if (databaseName !== input.loaded.target.databaseName) {
    throw failure('Remote D1 name differs from the reviewed database', 'YOUTUBE_LARK_UAT_REMOTE_D1_MISMATCH');
  }
  const queueBinding = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_SYNC_QUEUE'
      && normalizeBindingType(binding?.type) === 'queue'
  ), 'MKT_SYNC_QUEUE');
  if (String(queueBinding.queue_name ?? queueBinding.queueName ?? queueBinding.queue ?? '')
    !== input.loaded.target.mainQueueName) {
    throw failure('Remote Queue binding differs from the reviewed Queue', 'YOUTUBE_LARK_UAT_REMOTE_QUEUE_MISMATCH');
  }
  const remoteTableIds = {};
  for (const [key, expected] of Object.entries(input.loaded.config.tableIds)) {
    const envName = tableEnvName(key);
    const binding = exactlyOne(bindings, (item) => (
      readBindingName(item) === envName
        && normalizeBindingType(item?.type) === 'plain_text'
    ), envName);
    const observed = String(binding.text ?? binding.value ?? '').trim();
    if (observed !== expected) {
      throw failure(
        `Remote Lark mapping differs for ${envName}`,
        'YOUTUBE_LARK_UAT_REMOTE_TABLE_MAPPING_MISMATCH',
        { name: envName },
      );
    }
    remoteTableIds[key] = observed;
  }
  assertQueueTopology(input.mainConsumers, input.loaded.target.mainQueueName, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 5,
    deadLetterQueue: input.loaded.target.dlqName,
  });
  assertQueueTopology(input.dlqConsumers, input.loaded.target.dlqName, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 10,
    deadLetterQueue: null,
  });
  assertTriggerState(input.triggerState, input.loaded.target.workerName);
  return Object.freeze({
    remoteFlagFingerprint: sha256(stableJson(remoteTrue)),
    remoteTableMappingFingerprint: sha256(stableJson(remoteTableIds)),
  });
}

function assertQueueTopology(response, queueName, expected) {
  const consumers = normalizeScopedWranglerQueueConsumers(response, { expectedQueueName: queueName });
  if (consumers.length !== 1) {
    throw failure(
      `Remote Queue ${queueName} must have exactly one consumer`,
      'YOUTUBE_LARK_UAT_QUEUE_TOPOLOGY_INVALID',
      { queueName, consumerCount: consumers.length },
    );
  }
  const consumer = consumers[0];
  const settings = consumer.settings ?? {};
  const observed = {
    maxConcurrency: Number(settings.max_concurrency ?? consumer.max_concurrency),
    maxBatchSize: Number(settings.max_batch_size ?? consumer.max_batch_size),
    maxBatchTimeout: Number(settings.max_batch_timeout ?? consumer.max_batch_timeout),
    maxRetries: Number(settings.max_retries ?? consumer.max_retries),
    deadLetterQueue: optionalText(
      consumer.dead_letter_queue
        ?? settings.dead_letter_queue
        ?? consumer.deadLetterQueue,
    ),
  };
  if (stableJson(observed) !== stableJson(expected)) {
    throw failure(
      `Remote Queue topology differs for ${queueName}`,
      'YOUTUBE_LARK_UAT_QUEUE_TOPOLOGY_INVALID',
      { queueName },
    );
  }
}

function assertTriggerState(state, workerName) {
  const scripts = Array.isArray(state.scriptList?.result) ? state.scriptList.result : [];
  const worker = scripts.find((item) => (item.id ?? item.name) === workerName);
  if (!worker) {
    throw failure('Remote Worker script is missing', 'YOUTUBE_LARK_UAT_TRIGGER_STATE_INVALID');
  }
  const routes = Array.isArray(worker.routes) ? worker.routes : [];
  if (routes.length !== 0) {
    throw failure('Remote Worker has an unapproved route', 'YOUTUBE_LARK_UAT_TRIGGER_STATE_INVALID');
  }
  const schedules = Array.isArray(state.schedules?.result)
    ? state.schedules.result
    : state.schedules?.result?.schedules ?? [];
  const crons = schedules.map((item) => String(item.cron)).sort();
  if (stableJson(crons) !== stableJson([...EXPECTED_CRONS].sort())) {
    throw failure('Remote Worker Cron set differs from reviewed state', 'YOUTUBE_LARK_UAT_TRIGGER_STATE_INVALID');
  }
  if (state.subdomain?.result?.enabled !== false) {
    throw failure('Remote workers.dev must remain disabled', 'YOUTUBE_LARK_UAT_TRIGGER_STATE_INVALID');
  }
}

async function readSnapshot(loaded) {
  const output = await wranglerText([
    'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', loaded.target.configPath,
    '--command', buildYouTubeLarkUatSnapshotSql(loaded.target),
  ]);
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) throw failure('YouTube Lark UAT D1 snapshot returned no row', 'YOUTUBE_LARK_UAT_SNAPSHOT_EMPTY');
  return normalizeYouTubeLarkUatSnapshot(row);
}

async function buildBundle(loaded, configText, label) {
  const outdir = await mkdtemp(join(tmpdir(), `youtube-lark-uat-${label}-`));
  try {
    const result = await withGeneratedConfig(loaded, configText, async (configPath) => wrangler([
      'deploy', '--dry-run', '--outdir', outdir, '--config', configPath,
    ]));
    const files = await collectFiles(outdir);
    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(relative(outdir, file));
      hash.update(await readFile(file));
    }
    hash.update(result.stdout);
    return Object.freeze({ sha256: hash.digest('hex'), fileCount: files.length });
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

async function withGeneratedConfig(loaded, configText, operation) {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-lark-uat-config-'));
  try {
    const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
      sourceDirectory: dirname(loaded.target.configPath),
      outputDirectory: directory,
    });
    const path = join(directory, 'wrangler.generated.json');
    await writeFile(path, rebased.text, { mode: 0o600 });
    await chmod(path, 0o600);
    return await operation(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function collectFiles(root) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(root);
  return files.sort();
}

async function readPriorEvidence(loaded, phase) {
  if (phase === 'lark-preflight') return null;
  if (phase === 'restore-all-false') {
    for (const candidate of [
      'verify-idempotent-rerun',
      'resend-same-operation',
      'verify-full-sync',
      'send-full-sync',
      'snapshot-before',
      'verify-active',
      'deploy-active',
    ]) {
      try {
        return await readEvidence(loaded, candidate);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    throw failure(
      'Restore requires activation-chain evidence',
      'YOUTUBE_LARK_UAT_RESTORE_EVIDENCE_MISSING',
    );
  }
  const index = YOUTUBE_LARK_UAT_PHASES.indexOf(phase);
  return readEvidence(loaded, YOUTUBE_LARK_UAT_PHASES[index - 1]);
}

async function readEvidence(loaded, phase) {
  const path = join(loaded.evidenceRoot, evidenceFileForYouTubeLarkUatPhase(phase));
  const value = JSON.parse(await readFile(path, 'utf8'));
  return validateYouTubeLarkUatEvidence(value, {
    repositoryHead: loaded.target.repositoryHead,
    targetFingerprint: loaded.target.targetFingerprint,
    operationId: loaded.target.operationId,
  });
}

async function writeEvidence(loaded, phase, evidence) {
  await writePrivateJson(
    join(loaded.evidenceRoot, evidenceFileForYouTubeLarkUatPhase(phase)),
    evidence,
  );
}

async function resolveRestoreExpectedVersion(loaded) {
  for (const phase of ['verify-active', 'deploy-active']) {
    try {
      const evidence = await readEvidence(loaded, phase);
      return evidence.data.activeVersion ?? evidence.data.deploymentVersionId;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw failure('Restore cannot resolve the activated Worker version', 'YOUTUBE_LARK_UAT_RESTORE_VERSION_MISSING');
}

async function assertAttemptAbsent(path, phase) {
  try {
    await stat(path);
    throw failure(
      `A prior ${phase} attempt exists; automatic repetition is disabled`,
      'YOUTUBE_LARK_UAT_ATTEMPT_ALREADY_EXISTS',
      { phase },
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function readDeploymentStatus(target) {
  const parsed = JSON.parse(await wranglerText([
    'deployments', 'status', '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function readVersionView(target, versionId) {
  return JSON.parse(await wranglerText([
    'versions', 'view', versionId, '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]));
}

async function readQueueConsumers(queueName) {
  return JSON.parse(await wranglerText(['queues', 'consumer', 'list', queueName, '--json']));
}

async function readSecretNames(target) {
  const parsed = JSON.parse(await wranglerText([
    'secret', 'list', '--name', target.workerName,
    '--config', target.configPath, '--format', 'json',
  ]));
  return Object.freeze(parsed.map((item) => String(item.name)).sort());
}

async function assertActiveVersionUnchanged(target, expected) {
  const status = await readDeploymentStatus(target);
  return requireSingleActiveVersion(status, expected);
}

function requireSingleActiveVersion(status, expected = undefined) {
  const active = Array.isArray(status?.versions)
    ? status.versions.filter((item) => Number(item.percentage) === 100)
    : [];
  if (active.length !== 1) {
    throw failure('Remote Worker must have exactly one 100% active version', 'YOUTUBE_LARK_UAT_ACTIVE_VERSION_INVALID');
  }
  const versionId = String(active[0].version_id ?? active[0].id ?? '');
  if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
    throw failure('Remote active Worker version ID is invalid', 'YOUTUBE_LARK_UAT_ACTIVE_VERSION_INVALID');
  }
  if (expected !== undefined && versionId !== expected) {
    throw failure(
      'Remote active Worker version changed from chained evidence',
      'YOUTUBE_LARK_UAT_ACTIVE_VERSION_CHANGED',
      { expectedVersion: expected, observedVersion: versionId },
    );
  }
  return versionId;
}

async function readRemoteTriggerState(target, env) {
  const accountId = requireText(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const token = requireText(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
  const accountPath = `/accounts/${encodeURIComponent(accountId)}/workers`;
  const scriptPath = `${accountPath}/scripts/${encodeURIComponent(target.workerName)}`;
  const [scriptList, schedules, subdomain] = await Promise.all([
    readAllWorkerScripts(accountPath, token),
    cloudflareJson(`${scriptPath}/schedules`, token),
    cloudflareJson(`${scriptPath}/subdomain`, token),
  ]);
  return Object.freeze({ scriptList, schedules, subdomain });
}

async function readAllWorkerScripts(accountPath, token) {
  const scripts = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await cloudflareJson(`${accountPath}/scripts?page=${page}&per_page=100`, token);
    if (!Array.isArray(response.result)) {
      throw failure('Cloudflare Worker list returned invalid result', 'YOUTUBE_LARK_UAT_REMOTE_RESPONSE_INVALID');
    }
    scripts.push(...response.result);
    totalPages = Number(response.result_info?.total_pages ?? 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000) {
      throw failure('Cloudflare Worker list returned invalid pagination', 'YOUTUBE_LARK_UAT_REMOTE_RESPONSE_INVALID');
    }
    page += 1;
  } while (page <= totalPages);
  return Object.freeze({ success: true, result: scripts });
}

async function cloudflareJson(path, token) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw failure(
      'Cloudflare read-only metadata request failed',
      'YOUTUBE_LARK_UAT_REMOTE_RESPONSE_INVALID',
      { status: response.status },
    );
  }
  return body;
}

function readVersionBindings(value) {
  const item = Array.isArray(value) ? value[0] : value;
  if (!item || typeof item !== 'object') {
    throw failure('Remote version view is invalid', 'YOUTUBE_LARK_UAT_REMOTE_RESPONSE_INVALID');
  }
  const bindings = Array.isArray(item.bindings)
    ? item.bindings
    : item.resources?.bindings;
  if (!Array.isArray(bindings)) {
    throw failure('Remote version view lacks bindings', 'YOUTUBE_LARK_UAT_REMOTE_RESPONSE_INVALID');
  }
  return bindings;
}

function readBindingName(binding) {
  const value = binding?.name ?? binding?.binding;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBindingType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase().replaceAll('-', '_') : '';
  if (['d1', 'd1_database', 'd1_namespace'].includes(type)) return 'd1';
  if (['queue', 'queue_binding'].includes(type)) return 'queue';
  if (['plain_text', 'plain_text_binding', 'text'].includes(type)) return 'plain_text';
  return type;
}

function readRemoteBoolean(value, name) {
  if (value === true || value === false) return value;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw failure(
    'Remote execution flag is not an explicit Boolean',
    'YOUTUBE_LARK_UAT_REMOTE_FLAG_VALUE_INVALID',
    { name },
  );
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) {
    throw failure(
      `Remote contract requires exactly one ${label}`,
      'YOUTUBE_LARK_UAT_REMOTE_BINDING_INVALID',
      { label, matchCount: matches.length },
    );
  }
  return matches[0];
}

function tableEnvName(key) {
  return {
    mktAccounts: 'LARK_TABLE_MKT_ACCOUNTS',
    rawYouTubeChannels: 'LARK_TABLE_RAW_YOUTUBE_CHANNELS',
    rawYouTubeVideos: 'LARK_TABLE_RAW_YOUTUBE_VIDEOS',
    rawYouTubeAnalyticsDaily: 'LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY',
    mktContent: 'LARK_TABLE_MKT_CONTENT',
    mktContentDaily: 'LARK_TABLE_MKT_CONTENT_DAILY',
    mktSyncLog: 'LARK_TABLE_MKT_SYNC_LOG',
    mktSystemAlerts: 'LARK_TABLE_MKT_SYSTEM_ALERTS',
  }[key];
}

function readTableId(table) {
  const value = table?.tableId ?? table?.table_id ?? table?.id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readFieldName(field) {
  const value = field?.fieldName ?? field?.field_name ?? field?.name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function wranglerText(args) {
  return (await wrangler(args)).stdout;
}

async function wrangler(args) {
  return execFileAsync('npx', ['wrangler', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function gitText(args, options = {}) {
  const result = await execFileAsync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return options.trim === false ? result.stdout : result.stdout.trim();
}

function extractVersionId(value) {
  const matches = String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu) ?? [];
  if (matches.length === 0) {
    throw failure('Wrangler deploy output lacks a version ID', 'YOUTUBE_LARK_UAT_DEPLOYMENT_VERSION_MISSING');
  }
  return matches.at(-1).toLowerCase();
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw failure('YouTube Lark UAT path must stay inside the repository', 'YOUTUBE_LARK_UAT_PATH_INVALID');
  }
  return path;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw failure(`${fieldName} must be a positive integer`, 'YOUTUBE_LARK_UAT_NUMBER_INVALID');
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw failure(`${fieldName} is required`, 'YOUTUBE_LARK_UAT_ENV_REQUIRED', { fieldName });
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeDiagnostic(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const allowed = new Set([
    'phase', 'fieldName', 'missing', 'missingTables', 'missingKeyFields', 'missingSecrets',
    'missingPositive', 'existing', 'status', 'expectedHead', 'observedHead', 'clean',
    'repositoryHead', 'originMainHead', 'expectedVersion', 'observedVersion', 'expectedTrue',
    'remoteTrue', 'name', 'queueName', 'consumerCount', 'minimumMainQueueAttempts',
    'pendingMigrations', 'label', 'matchCount',
  ]);
  const sanitized = Object.fromEntries(
    Object.entries(details).filter(([key]) => allowed.has(key)),
  );
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
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

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function failure(message, code, details = undefined, remoteMutation = undefined) {
  const error = new Error(message);
  error.name = 'YouTubeLarkFullSyncUatOperatorError';
  error.code = code;
  if (details !== undefined) error.details = Object.freeze({ ...details });
  if (remoteMutation !== undefined) error.remoteMutation = remoteMutation;
  return error;
}
