#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  YOUTUBE_DRY_RUN_CONFIRMATIONS,
  YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES,
  YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST,
  YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
  YOUTUBE_DRY_RUN_OPERATOR_PHASES,
  YOUTUBE_DRY_RUN_REQUIRED_SECRET_NAMES,
  buildYouTubeDryRunPhasePlan,
  buildYouTubeDryRunSnapshotSql,
  classifyYouTubeDryRunCompletionSnapshot,
  compareYouTubeDryRunConfigs,
  compareYouTubeDryRunSnapshots,
  createYouTubeDryRunEvidence,
  decideYouTubeDryRunRestore,
  evidenceFileForPhase,
  executeYouTubeDryRunOperatorPhase,
  loadYouTubeDryRunTarget,
  parseYouTubeDryRunOperatorArgs,
  validateActiveYouTubeDeployment,
  validateYouTubeDryRunEvidenceSequence,
} from './lib/youtube-dry-run-rollout-operator.js';
import {
  validateLiveRemoteYouTubeDeploymentContract,
} from './lib/youtube-live-remote-contract-parser.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const evidenceRoot = join(repositoryRoot, 'outputs', 'youtube-dry-run-rollout');

try {
  const options = parseYouTubeDryRunOperatorArgs(process.argv.slice(2));
  if (options.phase === 'plan') {
    const repositoryHead = await gitText(['rev-parse', 'HEAD']);
    const plan = {
      contractVersion: YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
      planOnly: true,
      repositoryHead,
      phases: YOUTUBE_DRY_RUN_OPERATOR_PHASES,
      confirmations: YOUTUBE_DRY_RUN_CONFIRMATIONS,
      evidenceRoot: relative(repositoryRoot, evidenceRoot),
      operationalMutationAllowlist: YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST,
      forbiddenBusinessMutations: YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES,
      remoteActionsPerformed: false,
    };
    if (process.env.MKT_YOUTUBE_DRY_RUN_REPOSITORY_HEAD) {
      const { target } = await loadReviewedTarget(process.env);
      const workingTree = await gitText([
        'status',
        '--porcelain',
        '--untracked-files=all',
      ], { trim: false });
      if (target.repositoryHead !== repositoryHead || workingTree.trim() !== '') {
        throw operatorFailure(
          'Target-bound plan requires exact reviewed HEAD and a clean Working Tree',
          'YOUTUBE_DRY_RUN_PLAN_REPOSITORY_STATE_INVALID',
        );
      }
      await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
      await writeEvidence('plan', createYouTubeDryRunEvidence({
        phase: 'plan',
        repositoryHead,
        targetFingerprint: target.targetFingerprint,
        operationId: target.operationId,
        data: plan,
      }));
      plan.targetFingerprint = target.targetFingerprint;
      plan.operationId = target.operationId;
      plan.planEvidenceWritten = true;
    }
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 0;
  } else if (!options.execute) {
    throw operatorFailure(
      'Executable phases require --execute and their own exact confirmation token',
      'YOUTUBE_DRY_RUN_OPERATOR_EXECUTE_REQUIRED',
    );
  } else {
    await executePhase(options.phase);
  }
} catch (error) {
  const report = {
    ok: false,
    code: error?.code ?? 'YOUTUBE_DRY_RUN_OPERATOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    emergencyRestore: error?.emergencyRestore ?? null,
  };
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}

async function executePhase(phase) {
  const { target, configComparison } = await loadReviewedTarget(process.env);
  const repositoryHead = await gitText(['rev-parse', 'HEAD']);
  const workingTreeClean = (await gitText([
    'status',
    '--porcelain',
    '--untracked-files=all',
  ], { trim: false })).trim() === '';
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const dependencies = {
    readPriorEvidence: readPriorEvidenceForPhase,
    readRecoveryEvidence,
    writeEvidence,
    writeEmergencyRestore,
    writeDeploymentAttempt,
    writeQueueSendAttempt,
    sendQueueMessage: (job) => sendExactlyOneQueueMessage(job, target),
    verifyDryRun: () => verifyDryRun(target),
    runPhase: (plan) => runOperatorPhase(plan, target, configComparison),
  };
  const evidence = await executeYouTubeDryRunOperatorPhase({
    phase,
    env: process.env,
    target,
    repositoryHead,
    workingTreeClean,
  }, dependencies);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function readPriorEvidenceForPhase(phase) {
  if (phase === 'restore-all-false') return readRecoveryEvidence();
  const index = YOUTUBE_DRY_RUN_OPERATOR_PHASES.indexOf(phase);
  if (index <= 0) {
    throw operatorFailure(
      'Executable phase has no canonical prior evidence',
      'YOUTUBE_DRY_RUN_PRIOR_EVIDENCE_REQUIRED',
    );
  }
  return readEvidence(YOUTUBE_DRY_RUN_OPERATOR_PHASES[index - 1]);
}

async function readRecoveryEvidence() {
  for (const [phase, reader] of [
    ['verify-deployment', () => readEvidence('verify-deployment')],
    ['deploy-dry-run-gates', () => readEvidence('deploy-dry-run-gates')],
    ['deploy-dry-run-gates', readDeploymentAttempt],
  ]) {
    try {
      const evidence = await reader();
      if (evidence?.phase === phase) return evidence;
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
    }
  }
  throw operatorFailure(
    'No chain-bound dry-run activation evidence is available for guarded restore',
    'YOUTUBE_DRY_RUN_RECOVERY_EVIDENCE_MISSING',
  );
}

async function loadReviewedTarget(env) {
  const rawTarget = loadYouTubeDryRunTarget(env);
  const safeConfigPath = resolveRepositoryFile(rawTarget.safeConfigPath);
  const activeConfigPath = resolveRepositoryFile(rawTarget.activeConfigPath);
  const [safeConfig, activeConfig] = await Promise.all([
    readFile(safeConfigPath, 'utf8'),
    readFile(activeConfigPath, 'utf8'),
  ]);
  const configComparison = compareYouTubeDryRunConfigs(safeConfig, activeConfig, {
    channelId: rawTarget.channelId,
  });
  const targetFingerprint = sha256(JSON.stringify({
    baseTargetFingerprint: rawTarget.targetFingerprint,
    safeConfigPath: relative(repositoryRoot, safeConfigPath),
    activeConfigPath: relative(repositoryRoot, activeConfigPath),
    safeConfigSha256: sha256(safeConfig),
    activeConfigSha256: sha256(activeConfig),
    bindingFingerprint: configComparison.safe.bindingFingerprint,
    safeFlagFingerprint: configComparison.safe.flagFingerprint,
    activeFlagFingerprint: configComparison.active.flagFingerprint,
  }));
  return {
    target: Object.freeze({ ...rawTarget, targetFingerprint }),
    configComparison,
  };
}

async function runOperatorPhase(plan, target, configs) {
  switch (plan.phase) {
    case 'preflight':
      return runPreflight(target, configs);
    case 'deploy-safe-baseline':
    case 'deploy-dry-run-gates':
      return runDeployment(plan, target, configs);
    case 'restore-all-false':
      return runGuardedRestore(plan, target, configs);
    case 'verify-safe-baseline':
    case 'verify-deployment':
    case 'verify-restore':
      return verifyDeployment(plan.phase, target, configs);
    case 'snapshot-operational-state':
      return {
        snapshot: await readOperationalSnapshot(target),
        scope: scopedIdentity(target),
      };
    case 'summary':
      return summarizeEvidence(target);
    default:
      return buildYouTubeDryRunPhasePlan({
        phase: plan.phase,
        target,
        repositoryHead: target.repositoryHead,
      });
  }
}

async function runPreflight(target, configs) {
  const [safeBundle, activeBundle, deployment, migrations, secretNames] = await Promise.all([
    buildLocalBundle(target.safeConfigPath, 'safe'),
    buildLocalBundle(target.activeConfigPath, 'dry-run'),
    readDeploymentStatus(target.activeConfigPath, target.workerName),
    wranglerText([
      'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote',
      '--config', target.activeConfigPath,
    ]),
    readSecretNames(target),
  ]);
  validateActiveYouTubeDeployment(deployment, target.expectedActiveVersion);
  const missingSecrets = YOUTUBE_DRY_RUN_REQUIRED_SECRET_NAMES
    .filter((name) => !secretNames.includes(name));
  if (missingSecrets.length > 0) {
    throw operatorFailure(
      `Required Worker Secret names are missing: ${missingSecrets.join(', ')}`,
      'YOUTUBE_DRY_RUN_REQUIRED_SECRET_MISSING',
    );
  }
  const pendingMigrations = [...migrations.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0]);
  if (pendingMigrations.length > 0) {
    throw operatorFailure(
      `Unapplied migrations block the rollout: ${pendingMigrations.join(', ')}`,
      'YOUTUBE_DRY_RUN_PENDING_MIGRATIONS',
    );
  }
  return {
    safeBundleSha256: safeBundle.sha256,
    activeBundleSha256: activeBundle.sha256,
    bindingFingerprint: configs.safe.bindingFingerprint,
    safeFlagFingerprint: configs.safe.flagFingerprint,
    activeFlagFingerprint: configs.active.flagFingerprint,
    activeVersion: target.expectedActiveVersion,
    pendingMigrations,
    requiredSecretNameCount: YOUTUBE_DRY_RUN_REQUIRED_SECRET_NAMES.length,
    secretNameFingerprint: sha256(JSON.stringify(secretNames)),
    remoteMutationCount: 0,
  };
}

async function runDeployment(plan, target, configs) {
  const configPath = plan.phase === 'deploy-dry-run-gates'
    ? target.activeConfigPath
    : target.safeConfigPath;
  const expectedActiveVersion = plan.phase === 'deploy-dry-run-gates'
    ? (await readEvidence('verify-safe-baseline')).data.versionId
    : target.expectedActiveVersion;
  const beforeStatus = await readDeploymentStatus(target.activeConfigPath, target.workerName);
  validateActiveYouTubeDeployment(beforeStatus, expectedActiveVersion);
  const bundle = await buildLocalBundle(configPath, plan.phase);
  const result = await runCommand(plan.command);
  const versionId = extractVersionId(result.stdout);
  return {
    repositoryHead: target.repositoryHead,
    localBundleSha256: bundle.sha256,
    deploymentMessage: plan.command.at(-1),
    deploymentVersionId: versionId,
    activeVersionBefore: expectedActiveVersion,
    commandExitCode: 0,
    stdoutSha256: sha256(result.stdout),
    bindingFingerprint: configs.safe.bindingFingerprint,
    flagFingerprint: plan.phase === 'deploy-dry-run-gates'
      ? configs.active.flagFingerprint
      : configs.safe.flagFingerprint,
  };
}

async function runGuardedRestore(plan, target, configs) {
  const [safeBaseline, activationEvidence, deploymentStatus] = await Promise.all([
    readEvidence('verify-safe-baseline'),
    readRecoveryEvidence(),
    readDeploymentStatus(target.activeConfigPath, target.workerName),
  ]);
  const activeVersion = deploymentStatus?.versions?.find(
    (version) => Number(version?.percentage) === 100,
  )?.version_id;
  const versionsView = activeVersion
    ? await readVersionView(
      target.activeConfigPath,
      target.workerName,
      activeVersion,
    )
    : {};
  const guard = decideYouTubeDryRunRestore({
    repositoryHead: target.repositoryHead,
    targetFingerprint: target.targetFingerprint,
    operationId: target.operationId,
    safeBaselineVersion: safeBaseline?.data?.versionId,
    activationEvidence,
    deploymentStatus,
    versionsView,
  });
  if (guard.decision === 'RESTORE_NOT_REQUIRED') {
    return {
      ...guard,
      deploymentCommandCount: 0,
      bindingFingerprint: configs.safe.bindingFingerprint,
      flagFingerprint: configs.safe.flagFingerprint,
    };
  }
  const bundle = await buildLocalBundle(target.safeConfigPath, plan.phase);
  const result = await runCommand(plan.command);
  const deploymentVersionId = extractVersionId(result.stdout);
  return {
    ...guard,
    repositoryHead: target.repositoryHead,
    localBundleSha256: bundle.sha256,
    deploymentMessage: plan.command.at(-1),
    deploymentVersionId,
    deploymentCommandCount: 1,
    commandExitCode: 0,
    stdoutSha256: sha256(result.stdout),
    bindingFingerprint: configs.safe.bindingFingerprint,
    flagFingerprint: configs.safe.flagFingerprint,
  };
}

async function verifyDeployment(phase, target, configs) {
  const priorPhase = phase === 'verify-safe-baseline'
    ? 'deploy-safe-baseline'
    : phase === 'verify-deployment'
      ? 'deploy-dry-run-gates'
      : 'restore-all-false';
  const prior = await readEvidence(priorPhase);
  const expectedVersion = phase === 'verify-restore'
    ? (prior?.data?.deploymentVersionId ?? prior?.data?.safeBaselineVersion)
    : prior?.data?.deploymentVersionId;
  const status = await readDeploymentStatus(target.activeConfigPath, target.workerName);
  const active = validateActiveYouTubeDeployment(status, expectedVersion);
  const [versionsView, mainConsumers, dlqConsumers, triggerState] = await Promise.all([
    readVersionView(
      target.activeConfigPath,
      target.workerName,
      expectedVersion,
    ),
    readQueueConsumers(target.mainQueueName),
    readQueueConsumers(target.dlqName),
    readRemoteTriggerState(target),
  ]);
  const localContract = phase === 'verify-deployment'
    ? configs.active
    : configs.safe;
  const expectedDeploymentMessage = prior?.data?.deploymentMessage
    ?? (phase === 'verify-restore' && prior?.data?.decision === 'RESTORE_NOT_REQUIRED'
      ? (await readEvidence('deploy-safe-baseline'))?.data?.deploymentMessage
      : null);
  if (!expectedDeploymentMessage) {
    throw operatorFailure(
      'Remote verification requires exact deployment SHA/phase evidence',
      'YOUTUBE_DRY_RUN_DEPLOYMENT_PROVENANCE_MISSING',
    );
  }
  const remote = validateLiveRemoteYouTubeDeploymentContract({
    versionsView,
    deploymentStatus: status,
    queueConsumerContexts: [
      {
        expectedQueueName: target.mainQueueName,
        response: mainConsumers,
      },
      {
        expectedQueueName: target.dlqName,
        response: dlqConsumers,
      },
    ],
    expectedD1BindingName: 'MKT_STATE_DB',
    expectedDatabaseId: localContract.databaseId,
    expectedDatabaseName: target.databaseName,
    workerName: target.workerName,
    ...triggerState,
    active: phase === 'verify-deployment',
    expectedDeploymentMessage,
    expectedRemoteFingerprint: localContract.remoteContractFingerprint,
  });
  return {
    ...active,
    remoteFingerprint: remote.remoteFingerprint,
    bindingFingerprint: localContract.bindingFingerprint,
    flagFingerprint: phase === 'verify-deployment'
      ? configs.active.flagFingerprint
      : configs.safe.flagFingerprint,
  };
}

async function verifyDryRun(target) {
  const beforeEvidence = await readEvidence('snapshot-operational-state');
  const before = beforeEvidence?.data?.snapshot;
  const after = await pollForCompletion(target);
  const comparison = compareYouTubeDryRunSnapshots(before, after, {
    executionMode: target.executionMode,
    after: {
      youtubeLarkWrites: after.youtube_lark_records,
      analyticsRequests: after.analytics_requests,
      oauthRefreshes: after.oauth_refreshes,
      providerRequests: after.provider_requests,
    },
  });
  return {
    scope: scopedIdentity(target),
    snapshotBefore: before,
    snapshotAfter: after,
    ...comparison,
    dlqCount: after.dlq_records,
    completionObserved: true,
  };
}

async function pollForCompletion(target) {
  const maxPolls = positiveInteger(process.env.MKT_YOUTUBE_DRY_RUN_VERIFY_MAX_POLLS, 6);
  const pollIntervalMs = positiveInteger(
    process.env.MKT_YOUTUBE_DRY_RUN_VERIFY_POLL_INTERVAL_MS,
    5_000,
  );
  let snapshot = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    snapshot = await readOperationalSnapshot(target);
    if (classifyYouTubeDryRunCompletionSnapshot(snapshot).complete) {
      return snapshot;
    }
    if (attempt < maxPolls) await new Promise((resolveWait) => setTimeout(resolveWait, pollIntervalMs));
  }
  throw operatorFailure(
    'Bounded read-only verification did not observe completed operational state',
    'YOUTUBE_DRY_RUN_VERIFY_TIMEOUT',
  );
}

async function readOperationalSnapshot(target) {
  const output = await wranglerText([
    'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', target.activeConfigPath,
    '--command', buildYouTubeDryRunSnapshotSql(target),
  ]);
  const parsed = JSON.parse(output);
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) {
    throw operatorFailure(
      'Scoped operational snapshot returned no row',
      'YOUTUBE_DRY_RUN_SNAPSHOT_EMPTY',
    );
  }
  return row;
}

async function sendExactlyOneQueueMessage(job, target) {
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const queueId = requiredEnv('MKT_YOUTUBE_DRY_RUN_QUEUE_ID');
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
    throw operatorFailure(
      `Cloudflare Queue accepted no message (HTTP ${response.status}); automatic resend is disabled`,
      'YOUTUBE_DRY_RUN_QUEUE_SEND_FAILED',
    );
  }
  return { accepted: true };
}

async function summarizeEvidence(target) {
  const evidence = [];
  for (const phase of YOUTUBE_DRY_RUN_OPERATOR_PHASES.slice(0, -1)) {
    try {
      evidence.push(await readEvidence(phase));
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
      if (phase === 'deploy-dry-run-gates') {
        try {
          evidence.push(await readDeploymentAttempt());
        } catch (attemptCause) {
          if (attemptCause?.code !== 'ENOENT') throw attemptCause;
        }
      }
    }
  }
  const validated = validateYouTubeDryRunEvidenceSequence(evidence, {
    repositoryHead: target.repositoryHead,
    targetFingerprint: target.targetFingerprint,
    operationId: target.operationId,
  });
  if (validated.at(-1)?.phase !== 'verify-restore') {
    throw operatorFailure(
      'Summary requires a verified recovery-chain restore endpoint',
      'YOUTUBE_DRY_RUN_SUMMARY_RESTORE_INCOMPLETE',
    );
  }
  return {
    phaseCount: validated.length,
    operation: scopedIdentity(target),
    evidenceChainHeadSha256: validated.at(-1).evidenceSha256,
    restoredSafeClosed: true,
    operatorOriginatedQueueSends: validated
      .filter((item) => item.phase === 'send-one-dry-run')
      .reduce((sum, item) => sum + Number(item.data?.queueSendCommandCount ?? 0), 0),
  };
}

async function readSecretNames(target) {
  const output = await wranglerText([
    'secret', 'list', '--name', target.workerName,
    '--config', target.activeConfigPath, '--format', 'json',
  ]);
  const parsed = JSON.parse(output);
  return Object.freeze(parsed.map((item) => String(item.name)).sort());
}

async function readDeploymentStatus(configPath, workerName) {
  const output = await wranglerText([
    'deployments', 'status', '--name', workerName,
    '--config', configPath, '--json',
  ]);
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function readVersionView(configPath, workerName, versionId) {
  const output = await wranglerText([
    'versions', 'view', versionId, '--name', workerName,
    '--config', configPath, '--json',
  ]);
  return JSON.parse(output);
}

async function readQueueConsumers(queueName) {
  const output = await wranglerText([
    'queues', 'consumer', 'list', queueName, '--json',
  ]);
  return JSON.parse(output);
}

async function readRemoteTriggerState(target) {
  if (!target.accountId) {
    throw operatorFailure(
      'Remote trigger verification requires CLOUDFLARE_ACCOUNT_ID',
      'YOUTUBE_DRY_RUN_CLOUDFLARE_ACCOUNT_ID_REQUIRED',
    );
  }
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    throw operatorFailure(
      'Remote trigger verification requires CLOUDFLARE_API_TOKEN with Workers Scripts Read',
      'YOUTUBE_DRY_RUN_CLOUDFLARE_API_TOKEN_REQUIRED',
    );
  }
  const accountPath = `/accounts/${encodeURIComponent(target.accountId)}/workers`;
  const scriptPath = `${accountPath}/scripts/${encodeURIComponent(target.workerName)}`;
  const [scriptList, schedules, subdomain] = await Promise.all([
    readAllCloudflareWorkerScripts(accountPath, apiToken),
    cloudflareApiJson(`${scriptPath}/schedules`, apiToken),
    cloudflareApiJson(`${scriptPath}/subdomain`, apiToken),
  ]);
  return { scriptList, schedules, subdomain };
}

async function readAllCloudflareWorkerScripts(accountPath, apiToken) {
  const scripts = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await cloudflareApiJson(
      `${accountPath}/scripts?page=${page}&per_page=100`,
      apiToken,
    );
    if (!Array.isArray(response.result)) {
      throw operatorFailure(
        'Cloudflare Worker list returned an invalid result',
        'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
      );
    }
    scripts.push(...response.result);
    totalPages = Number(response.result_info?.total_pages ?? 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000) {
      throw operatorFailure(
        'Cloudflare Worker list returned invalid pagination',
        'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
      );
    }
    page += 1;
  } while (page <= totalPages);
  return { success: true, result: scripts };
}

async function cloudflareApiJson(path, apiToken) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw operatorFailure(
      'Cloudflare read-only verification returned non-JSON output',
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
    );
  }
  if (!response.ok || parsed?.success !== true) {
    throw operatorFailure(
      'Cloudflare read-only verification request failed',
      'YOUTUBE_DRY_RUN_REMOTE_CONTRACT_INVALID',
    );
  }
  return parsed;
}

async function buildLocalBundle(configPath, label) {
  const parent = join(evidenceRoot, 'bundles');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, `${safeFilePart(label)}-`));
  await wranglerText([
    'deploy', '--dry-run', '--strict', '--config', configPath, '--outdir', directory,
  ]);
  const files = await listFiles(directory);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(directory, file));
    hash.update(await readFile(file));
  }
  return { sha256: hash.digest('hex'), fileCount: files.length };
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function readEvidence(phase) {
  const path = join(evidenceRoot, evidenceFileForPhase(phase));
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeEvidence(phase, evidence) {
  await writePrivateJson(join(evidenceRoot, evidenceFileForPhase(phase)), evidence);
}

async function writeEmergencyRestore(instruction) {
  await writePrivateJson(join(evidenceRoot, 'emergency-restore.json'), instruction);
}

async function writeDeploymentAttempt(evidence) {
  await writeExclusivePrivateJson(
    join(evidenceRoot, 'deploy-dry-run-gates-attempt.json'),
    evidence,
    'A dry-run deployment attempt is already recorded; a second activation is blocked',
    'YOUTUBE_DRY_RUN_DEPLOYMENT_REATTEMPT_BLOCKED',
  );
}

async function readDeploymentAttempt() {
  return JSON.parse(await readFile(
    join(evidenceRoot, 'deploy-dry-run-gates-attempt.json'),
    'utf8',
  ));
}

async function writeQueueSendAttempt(evidence) {
  await writeExclusivePrivateJson(
    join(evidenceRoot, 'send-one-dry-run-attempt.json'),
    evidence,
    'A Queue send attempt is already recorded; automatic or manual resend is blocked',
    'YOUTUBE_DRY_RUN_QUEUE_RESEND_BLOCKED',
  );
}

async function writeExclusivePrivateJson(path, evidence, message, code) {
  try {
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(path, 0o600);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw operatorFailure(message, code);
    }
    throw cause;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function wranglerText(args) {
  return (await runCommand(['npx', 'wrangler', ...args])).stdout;
}

async function gitText(args, options = {}) {
  const result = await execFileAsync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return options.trim === false ? result.stdout : result.stdout.trim();
}

async function runCommand(command) {
  if (!Array.isArray(command) || command.length < 2 || command.some((part) => typeof part !== 'string')) {
    throw operatorFailure('Operator command is invalid', 'YOUTUBE_DRY_RUN_COMMAND_INVALID');
  }
  const [file, ...args] = command;
  const result = await execFileAsync(file, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw operatorFailure(
      'Wrangler config must be inside the reviewed repository',
      'YOUTUBE_DRY_RUN_CONFIG_PATH_INVALID',
    );
  }
  return path;
}

function extractVersionId(value) {
  const match = String(value).match(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/iu);
  if (!match) {
    throw operatorFailure(
      'Wrangler deployment output did not contain a Version ID',
      'YOUTUBE_DRY_RUN_DEPLOYMENT_VERSION_MISSING',
    );
  }
  return match[0].toLowerCase();
}

function scopedIdentity(target) {
  return {
    operationId: target.operationId,
    workKey: target.workKey,
    syncRunId: target.syncRunId,
    generation: target.generation,
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorFailure(`${name} is required`, 'YOUTUBE_DRY_RUN_ENV_REQUIRED');
  }
  return value.trim();
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 100) {
    throw operatorFailure(
      'Verification polling configuration is out of bounds',
      'YOUTUBE_DRY_RUN_POLL_CONFIG_INVALID',
    );
  }
  return number;
}

function safeFilePart(value) {
  return basename(String(value)).replace(/[^a-z0-9_-]+/giu, '-').toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function operatorFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
