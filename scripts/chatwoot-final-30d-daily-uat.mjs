#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';
import { assertWooCommerceQueueConsumerTopology } from './lib/woocommerce-queue-consumer-topology.js';
import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
  CHATWOOT_FINAL_UAT_CONFIRMATION,
  CHATWOOT_FINAL_UAT_CONTRACT_VERSION,
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  CHATWOOT_FINAL_UAT_TABLES,
  assertChatwootFinalUatBaselineCompatible,
  assertChatwootFinalUatBaselinePreserved,
  assertChatwootFinalUatControllerResume,
  assertChatwootFinalUatConfirmation,
  assertChatwootFinalUatPreflight,
  assertChatwootFinalUatResumeIdentity,
  buildChatwootFinalUatConfigWindow,
  buildChatwootFinalUatJob,
  buildChatwootFinalUatPreflightSql,
  buildChatwootFinalUatSnapshotSql,
  classifyChatwootFinalUatCompletion,
  compareChatwootD1LarkParity,
  compareChatwootFinalUatReplay,
  createChatwootFinalUatSession,
  mapChatwootFinalUatD1BaselineCounts,
  normalizeChatwootFinalUatPreflight,
  normalizeChatwootFinalUatSnapshot,
  sanitizeChatwootFinalProgress,
  sha256,
  stableJson,
} from './lib/chatwoot-final-30d-daily-uat.js';
import {
  CHATWOOT_INITIAL_RECOVERY_BOUNDARIES,
  buildChatwootInitialRecoveryContinuationJob,
  validateRetainedSession,
} from './lib/chatwoot-initial-terminal-failure-recovery.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';

const ROOT = resolve(process.cwd());
const REQUIRED_SECRETS = ['CHATWOOT_API_ACCESS_TOKEN', 'LARK_APP_ID', 'LARK_APP_SECRET'];
const EXPECTED_CRONS = ['*/5 * * * *', '30 18 * * *'];
let safeRestore = null;
let primaryError = null;

try {
  await main();
} catch (error) {
  primaryError = error;
  process.exitCode = 1;
} finally {
  if (safeRestore) {
    try { await restoreAllFalse(safeRestore); }
    catch (error) {
      if (primaryError) primaryError.restoreError = error;
      else primaryError = error;
      process.exitCode = 1;
    }
  }
  if (primaryError) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: primaryError?.code ?? 'CHATWOOT_FINAL_UAT_FAILED',
      message: primaryError?.message ?? String(primaryError),
      details: scrub(primaryError?.details ?? {}),
      safeRestore: primaryError?.restoreError ? 'FAILED_REVIEW_REQUIRED' : safeRestore ? 'ATTEMPTED' : 'NOT_REQUIRED',
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--execute')) fail('Unknown argument', 'CHATWOOT_FINAL_UAT_ARGUMENT_INVALID');
  if (!args.includes('--execute')) return printPlan();

  const env = Object.freeze({ ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'), ...process.env });
  assertChatwootFinalUatConfirmation(env);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const head = repositoryHead();
  const sourcePath = inside(env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const sourceText = await readFile(sourcePath, 'utf8');
  const config = buildChatwootFinalUatConfigWindow(sourceText);
  const evidenceDir = resolve(env.MKT_CHATWOOT_FINAL_UAT_EVIDENCE_DIR
    ?? join('outputs', 'chatwoot-final-30d-daily-uat', head));
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const recoverySessionPath = env.MKT_CHATWOOT_INITIAL_FAILURE_RECOVERY_SESSION_PATH ?? null;
  const session = await sessionFor(evidenceDir, head, recoverySessionPath);
  const resume = await loadControllerResume(env, session);
  const recoveryBoundary = resolveInitialRecoveryBoundary(env, recoverySessionPath !== null);
  const target = {
    head, sourcePath, config, evidenceDir, session, env,
    recovery: recoverySessionPath !== null,
    resume,
    recoveryBoundary,
    allowedIncidentCounts: recoveryBoundary?.allowedIncidentCounts
      ?? Object.freeze({ dlqRecords: 0, openAlerts: 0 }),
  };

  await localGates();
  await generatedDryRun(target, config.safeText, 'safe');
  await generatedDryRun(target, config.activeText, 'active');
  target.cf = cloudflareTarget(target, sourceText);

  if (resume) {
    // The interrupted controller already opened the active flag window. Own Safe restore before
    // any resumed remote preflight so every exit path closes that existing window.
    safeRestore = {
      target,
      baselineVersion: resume.baselineVersion,
      activeVersion: resume.activeVersion,
    };
  }

  const preflightResult = await preflight(target);
  target.baseline = preflightResult.baseline;
  await evidence(target, 'read-only-preflight', preflightResult);
  const backup = await d1Backup(target);
  await evidence(target, 'd1-backup', backup);

  const replaceActiveDeployment = Boolean(
    resume && preflightResult.resumeBoundary?.replaceActiveDeployment,
  );
  const activeVersion = resume && !replaceActiveDeployment
    ? preflightResult.activeVersion
    : deploy(target, config.activeText, 'active');
  if (!resume) {
    safeRestore = { target, baselineVersion: preflightResult.activeVersion, activeVersion };
  } else if (replaceActiveDeployment) {
    safeRestore.activeVersion = activeVersion;
  }
  verifyDeployment(target, activeVersion, 'active');
  await evidence(target, 'active-deployment', {
    activeVersion,
    resumedController: Boolean(resume),
    replacedInterruptedActiveVersion: replaceActiveDeployment,
    trueFlags: CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
  });

  const initial = await operationFlow(target, session.initial, 'initial');
  const daily = await operationFlow(target, session.daily, 'daily', initial.replaySnapshot);

  await restoreAllFalse(safeRestore);
  safeRestore = null;
  const summary = {
    ok: true,
    marker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
    repositoryHead: head,
    sessionFingerprint: session.sessionFingerprint,
    initial30DayVerified: true,
    initialReplayVerified: true,
    daily3DayVerified: true,
    dailyReplayVerified: true,
    d1LarkParityTables: CHATWOOT_FINAL_UAT_TABLES.length,
    baselineD1Rows: target.baseline.d1Rows,
    baselineLarkRows: target.baseline.larkRows,
    baselinePreserved: true,
    initialRows: initial.parity.totalRows,
    dailyRows: daily.parity.totalRows,
    restoredAllFlagsFalse: true,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  };
  await evidence(target, 'summary', summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: CHATWOOT_FINAL_UAT_CONTRACT_VERSION,
    finalCommand: `${CHATWOOT_FINAL_UAT_CONFIRMATION.envName}=${CHATWOOT_FINAL_UAT_CONFIRMATION.value} node scripts/chatwoot-final-30d-daily-uat.mjs --execute`,
    sequence: ['local gates', 'read-only preflight', 'D1 backup', 'temporary active deploy',
      '30-day Initial', 'Initial replay', '3-day Daily', 'Daily replay', 'all-false restore'],
    activeTrueFlags: CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
    schedule: false,
    webhook: false,
    production: false,
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

function repositoryHead() {
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  const head = text('git', ['rev-parse', 'HEAD']);
  const main = text('git', ['rev-parse', 'origin/main']);
  const dirty = text('git', ['status', '--porcelain', '--untracked-files=all'], { raw: true });
  if (head !== main || dirty.trim()) fail(
    'Clean exact current main is required; detached HEAD is allowed',
    'CHATWOOT_FINAL_UAT_REPOSITORY_INVALID',
    { head, originMain: main, dirtyPathCount: dirty.trim() ? dirty.trim().split(/\r?\n/u).length : 0 },
  );
  return head;
}

async function sessionFor(directory, head, recoverySessionPath = null) {
  const path = join(directory, 'session.json');
  if (recoverySessionPath) {
    const retained = validateRetainedSession(JSON.parse(await readFile(
      inside(recoverySessionPath),
      'utf8',
    )));
    try {
      const existing = JSON.parse(await readFile(path, 'utf8'));
      if (existing.sessionFingerprint !== retained.sessionFingerprint) {
        fail('Recovery evidence is bound to another retained session', 'CHATWOOT_FINAL_UAT_SESSION_INVALID');
      }
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (!await exists(path)) await privateJson(path, retained);
    return retained;
  }
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.repositoryHead !== head || value.contractVersion !== CHATWOOT_FINAL_UAT_CONTRACT_VERSION) {
      fail('Existing session belongs to another Head', 'CHATWOOT_FINAL_UAT_SESSION_INVALID');
    }
    return value;
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const now = Date.now();
  const value = createChatwootFinalUatSession({
    repositoryHead: head,
    createdAt: now,
    initialRequestedAt: now,
    dailyRequestedAt: now + 1_000,
  });
  await privateJson(path, value);
  return value;
}

async function loadControllerResume(env, session) {
  const configured = env.MKT_CHATWOOT_FINAL_UAT_RESUME_EVIDENCE_DIR;
  if (!configured) return null;
  const directory = inside(configured);
  for (const forbidden of ['summary.json', 'safe-restore.json']) {
    if (await exists(join(directory, forbidden))) {
      fail(
        'Completed or safely restored evidence cannot enter controller resume',
        'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
        { forbidden },
      );
    }
  }
  const retainedSession = validateRetainedSession(await readJson(join(directory, 'session.json')));
  assertChatwootFinalUatResumeIdentity(session.initial, retainedSession.initial);
  assertChatwootFinalUatResumeIdentity(session.daily, retainedSession.daily);
  const preflight = unwrapEvidence(await readJson(join(directory, 'read-only-preflight.json')));
  const activeDeployment = unwrapEvidence(await readJson(join(directory, 'active-deployment.json')));
  const initialAttempt = await readJson(join(directory, 'initial-send.attempt.json'));
  if (initialAttempt.operationId !== session.initial.operationId
      || initialAttempt.workKey !== session.initial.workKey
      || initialAttempt.generation !== session.initial.generation) {
    fail(
      'Prior Initial attempt marker identity drifted',
      'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
    );
  }
  const baselineVersion = requireVersionId(preflight.activeVersion, 'resume.preflight.activeVersion');
  const activeVersion = requireVersionId(
    activeDeployment.activeVersion,
    'resume.activeDeployment.activeVersion',
  );
  const baseline = preflight.baseline;
  if (!baseline?.d1Counts || !baseline?.larkCounts) {
    fail('Prior baseline evidence is missing', 'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED');
  }
  return Object.freeze({
    directory,
    baselineVersion,
    activeVersion,
    baseline,
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    fail('Controller resume evidence is missing or invalid', 'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED', {
      fileName: relative(ROOT, path),
      errorCode: cause?.code ?? 'JSON_PARSE_FAILED',
    });
  }
}

function unwrapEvidence(value) {
  return value?.data && typeof value.data === 'object' ? value.data : value;
}

async function localGates() {
  const commands = [
    ['npm', ['ci']],
    ['npm', ['run', 'check']],
    ['node', ['--test', 'tests/application/chatwoot-final-30d-daily-uat.test.js',
      'tests/application/chatwoot-runtime-wiring.test.js',
      'tests/application/chatwoot-runtime-30d-daily.test.js',
      'tests/application/chatwoot-runtime-contract-examples.test.js',
      'tests/application/chatwoot-durable-recovery.test.js']],
    ['npm', ['test']],
    ['npm', ['run', 'test:report-reliability']],
    ['npm', ['audit', '--audit-level=high']],
    ['npm', ['run', 'deploy:dry-run']],
  ];
  for (const [command, args] of commands) run(command, args, { stdio: 'inherit' });
}

function cloudflareTarget(target, sourceText) {
  const baseEnv = pickEnv(target.env);
  const wranglerEnv = buildWranglerOAuthEnvironment(baseEnv);
  const whoami = text('npx', ['wrangler', 'whoami', '--json'], { env: wranglerEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: target.env.CLOUDFLARE_ACCOUNT_ID,
    preferredAccount: target.env.MKT_CHATWOOT_FINAL_UAT_ACCOUNT,
    configText: sourceText,
    whoamiOutput: whoami,
  });
  const selected = { ...wranglerEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: selected }),
  });
  const queueEnv = { ...selected, CLOUDFLARE_API_TOKEN: auth.token };
  const queueId = target.env.MKT_CHATWOOT_FINAL_UAT_QUEUE_ID
    ?? resolveWooCommerceQueueId(text('npx', ['wrangler', 'queues', 'list', '--json'], {
      env: queueEnv,
    }), configName(target, 'mainQueueName'));
  return { accountId, queueId, wranglerEnv: selected, authType: auth.type };
}

function freshQueueBearer(target) {
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], {
      env: target.cf.wranglerEnv,
    }),
  });
  if (auth.type !== target.cf.authType) {
    fail('Cloudflare authentication type changed during UAT', 'CHATWOOT_FINAL_UAT_AUTH_DRIFT');
  }
  return auth.token;
}

async function preflight(target) {
  const env = target.cf.wranglerEnv;
  const activeVersion = activeVersionId(deploymentStatus(target));
  if (target.resume && activeVersion !== target.resume.activeVersion) {
    fail('Active Worker version drifted from interrupted controller evidence',
      'CHATWOOT_FINAL_UAT_CONCURRENT_DEPLOYMENT');
  }
  assertFlags(versionView(target, activeVersion), target.resume ? 'active' : 'safe');
  assertQueue(target, configName(target, 'mainQueueName'), {
    maxConcurrency: 1, maxBatchSize: 10, maxBatchTimeout: 30, maxRetries: 5,
    deadLetterQueue: configName(target, 'dlqName'),
  });
  assertQueue(target, configName(target, 'dlqName'), {
    maxConcurrency: 1, maxBatchSize: 10, maxBatchTimeout: 30, maxRetries: 10,
    deadLetterQueue: null,
  });
  await assertTriggers(target);
  const migrationOutput = text('npx', ['wrangler', 'd1', 'migrations', 'list', configName(target, 'databaseName'),
    '--remote', '--config', target.sourcePath], { env });
  const pending = [...new Set([...migrationOutput.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)].map((match) => match[0]))];
  if (pending.length) fail('Pending D1 migrations block UAT', 'CHATWOOT_FINAL_UAT_PENDING_MIGRATIONS', { pending });
  const secrets = JSON.parse(text('npx', ['wrangler', 'secret', 'list', '--name', configName(target, 'workerName'),
    '--config', target.sourcePath, '--format', 'json'], { env })).map((item) => String(item.name));
  const missing = REQUIRED_SECRETS.filter((name) => !secrets.includes(name));
  if (missing.length) fail('Required Worker Secret names are missing', 'CHATWOOT_FINAL_UAT_SECRET_MISSING', { missing });
  const resumeSnapshot = target.resume ? snapshot(target, target.session.initial) : null;
  const resumeBoundary = resumeSnapshot
    ? assertChatwootFinalUatControllerResume(resumeSnapshot, target.session.initial)
    : null;
  const d1 = assertChatwootFinalUatPreflight(
    normalizeChatwootFinalUatPreflight(d1Row(target, buildChatwootFinalUatPreflightSql())),
    { expectedActiveWork: resumeSnapshot
      ? Number(resumeSnapshot.workLifecycleStatus === 'active')
      : target.recovery ? 1 : 0 },
  );
  const lark = await larkCounts(target, true);
  const currentD1 = mapChatwootFinalUatD1BaselineCounts(d1.businessCounts);
  const baseline = target.resume?.baseline ?? assertChatwootFinalUatBaselineCompatible(currentD1, lark);
  if (target.resume) {
    assertChatwootFinalUatBaselinePreserved(baseline.d1Counts, currentD1, 'resume:d1');
    assertChatwootFinalUatBaselinePreserved(baseline.larkCounts, lark, 'resume:lark');
    assertChatwootFinalUatBaselineCompatible(currentD1, lark);
  }
  return {
    activeVersion,
    pendingMigrations: 0,
    requiredSecretNames: REQUIRED_SECRETS.length,
    d1,
    baseline,
    larkTableCount: CHATWOOT_FINAL_UAT_TABLES.length,
    larkRows: baseline.larkRows,
    resumeBoundary,
    remoteMutationCount: 0,
  };
}

async function d1Backup(target) {
  const path = join(target.evidenceDir, `chatwoot-before-uat-${Date.now()}.sql`);
  run('npx', ['wrangler', 'd1', 'export', configName(target, 'databaseName'), '--remote',
    '--config', target.sourcePath, '--output', path, '--skip-confirmation'], {
    env: target.cf.wranglerEnv,
  });
  let metadata;
  try {
    metadata = await stat(path);
  } catch (cause) {
    fail('D1 backup could not be inspected', 'CHATWOOT_FINAL_UAT_BACKUP_INSPECTION_FAILED', {
      errorCode: cause?.code ?? null,
    });
  }
  if (!metadata.isFile() || metadata.size <= 0) {
    fail('D1 backup is empty', 'CHATWOOT_FINAL_UAT_BACKUP_EMPTY');
  }
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk);
  } catch (cause) {
    fail('D1 backup could not be hashed', 'CHATWOOT_FINAL_UAT_BACKUP_HASH_FAILED', {
      errorCode: cause?.code ?? null,
    });
  }
  return {
    backupFile: relative(ROOT, path),
    backupBytes: metadata.size,
    backupSha256: hash.digest('hex'),
  };
}

async function operationFlow(target, operation, label, previous = null) {
  const firstSend = join(target.evidenceDir, `${label}-send.attempt.json`);
  const before = snapshot(target, operation);
  const recoveringInitial = target.recovery && label === 'initial';
  const resumingInitial = Boolean(target.resume) && label === 'initial';
  if (!recoveringInitial && !resumingInitial && !await exists(firstSend)
      && (before.workLifecycleStatus || before.mainQueueAttempts)) {
    fail('Stable operation identity already exists', 'CHATWOOT_FINAL_UAT_OPERATION_COLLISION', { label });
  }
  if (resumingInitial) {
    const resume = assertChatwootFinalUatControllerResume(before, operation);
    if (resume.queueSend) {
      await sendRecoveryContinuationOnce(target, operation, firstSend, before);
    } else {
      await privateJson(firstSend, {
        operationId: operation.operationId,
        workKey: operation.workKey,
        generation: operation.generation,
        resumedFrom: relative(ROOT, target.resume.directory),
        priorAttemptVerified: true,
        queueSend: false,
        minimumAttempts: resume.minimumAttempts,
        resumedAt: new Date().toISOString(),
      });
    }
  } else if (recoveringInitial) await sendRecoveryContinuationOnce(target, operation, firstSend, before);
  else await sendOnce(target, operation, firstSend, 0);
  const completed = await poll(target, operation, resumingInitial
    ? before.mainQueueAttempts + Number(before.workLifecycleStatus === 'active'
      && target.recoveryBoundary?.mainQueueAttempts === before.mainQueueAttempts)
    : recoveringInitial ? before.mainQueueAttempts + 1 : 2);
  const classified = classifyChatwootFinalUatCompletion(completed, operation, {
    allowedDlqRecords: recoveringInitial ? target.allowedIncidentCounts.dlqRecords : 0,
    allowedOpenAlerts: recoveringInitial ? target.allowedIncidentCounts.openAlerts : 0,
  });
  if (!classified.complete) fail(`${label} completion contract failed`, 'CHATWOOT_FINAL_UAT_OPERATION_INCOMPLETE', { label, missing: classified.missing });
  if (label === 'daily' && previous
      && completed.cursorIncrementalRunCount !== previous.cursorIncrementalRunCount + 1) {
    fail('Daily cursor did not advance exactly once', 'CHATWOOT_FINAL_UAT_DAILY_CURSOR_INVALID');
  }
  const lark = await larkCounts(target);
  const d1Baseline = assertChatwootFinalUatBaselinePreserved(
    target.baseline.d1Counts,
    completed.d1Counts,
    `${label}:d1`,
  );
  const larkBaseline = assertChatwootFinalUatBaselinePreserved(
    target.baseline.larkCounts,
    lark,
    `${label}:lark`,
  );
  const parity = compareChatwootD1LarkParity(completed.d1Counts, lark);
  await evidence(target, `${label}-completed`, {
    snapshot: completed,
    parity,
    baseline: { d1: d1Baseline, lark: larkBaseline },
  });

  const replayAttempt = join(target.evidenceDir, `${label}-replay.attempt.json`);
  await sendOnce(target, operation, replayAttempt, completed.mainQueueAttempts);
  const replay = await poll(target, operation, completed.mainQueueAttempts + 1);
  const comparison = compareChatwootFinalUatReplay(completed, replay);
  const replayLark = await larkCounts(target);
  assertChatwootFinalUatBaselinePreserved(
    target.baseline.d1Counts,
    replay.d1Counts,
    `${label}:replay:d1`,
  );
  assertChatwootFinalUatBaselinePreserved(
    target.baseline.larkCounts,
    replayLark,
    `${label}:replay:lark`,
  );
  compareChatwootD1LarkParity(replay.d1Counts, replayLark);
  if (stableJson(lark) !== stableJson(replayLark)) fail('Replay changed Lark counts', 'CHATWOOT_FINAL_UAT_REPLAY_INVALID', { label });
  await evidence(target, `${label}-replay`, { comparison, snapshot: replay });
  return { completedSnapshot: completed, replaySnapshot: replay, parity };
}

async function sendRecoveryContinuationOnce(target, operation, attemptPath, before) {
  if (before.workLifecycleStatus !== 'active'
      || before.activeNextSequence !== target.recoveryBoundary.nextSequence
      || before.mainQueueAttempts !== target.recoveryBoundary.mainQueueAttempts
      || before.activeLockCount !== 0) {
    fail('Exact Initial recovery boundary changed before continuation', 'CHATWOOT_INITIAL_FAILURE_BOUNDARY_DRIFT');
  }
  if (await exists(attemptPath)) {
    const current = snapshot(target, operation);
    if (current.mainQueueAttempts > before.mainQueueAttempts) return;
    fail('Recovery continuation attempt is uncertain', 'CHATWOOT_FINAL_UAT_QUEUE_ATTEMPT_UNCERTAIN');
  }
  const job = buildChatwootInitialRecoveryContinuationJob(operation);
  await privateJson(attemptPath, {
    operationId: operation.operationId,
    workKey: operation.workKey,
    generation: operation.generation,
    continuationSequence: 0,
    recoveryOwned: true,
    jobSha256: sha256(stableJson(job)),
    attemptedAt: new Date().toISOString(),
  });
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.cf.accountId)}`
    + `/queues/${encodeURIComponent(target.cf.queueId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${freshQueueBearer(target)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body: job, content_type: 'json' }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail('Recovery Queue continuation was not accepted', 'CHATWOOT_FINAL_UAT_QUEUE_SEND_FAILED', { status: response.status });
}

function resolveInitialRecoveryBoundary(env, recovering) {
  if (!recovering) return null;
  const value = env.MKT_CHATWOOT_INITIAL_FAILURE_RECOVERY_BOUNDARY;
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.original) {
    return Object.freeze({
      value,
      nextSequence: 0,
      mainQueueAttempts: 2,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 1, openAlerts: 1 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.fractionalTimestamp) {
    return Object.freeze({
      value,
      nextSequence: 1,
      mainQueueAttempts: 4,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 2, openAlerts: 3 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.safeRestoreRace) {
    return Object.freeze({
      value,
      nextSequence: 1,
      mainQueueAttempts: 5,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 3, openAlerts: 4 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.waitingSince) {
    return Object.freeze({
      value,
      nextSequence: 1,
      mainQueueAttempts: 7,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 4, openAlerts: 6 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.unknownLabel) {
    return Object.freeze({
      value,
      nextSequence: 1,
      mainQueueAttempts: 9,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 5, openAlerts: 8 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.messageOrder) {
    return Object.freeze({
      value,
      nextSequence: 1,
      mainQueueAttempts: 11,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 6, openAlerts: 10 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.reportingEvent) {
    return Object.freeze({
      value,
      nextSequence: 2,
      mainQueueAttempts: 14,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 7, openAlerts: 12 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.reportingEventNames) {
    return Object.freeze({
      value,
      nextSequence: 2,
      mainQueueAttempts: 16,
      allowedPreexistingFailedUnits: 1,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 8, openAlerts: 14 }),
    });
  }
  if (value === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.queueRetryExhausted) {
    return Object.freeze({
      value,
      nextSequence: 3,
      mainQueueAttempts: 25,
      allowedIncidentCounts: Object.freeze({ dlqRecords: 9, openAlerts: 15 }),
    });
  }
  fail('Initial recovery boundary contract is missing or unsupported', 'CHATWOOT_INITIAL_FAILURE_BOUNDARY_DRIFT');
}

async function sendOnce(target, operation, attemptPath, priorAttempts) {
  if (await exists(attemptPath)) {
    const current = snapshot(target, operation);
    if (current.mainQueueAttempts > priorAttempts || current.workLifecycleStatus) return;
    fail('Queue attempt is uncertain; blind resend is blocked', 'CHATWOOT_FINAL_UAT_QUEUE_ATTEMPT_UNCERTAIN');
  }
  const job = buildChatwootFinalUatJob(operation);
  await privateJson(attemptPath, { operationId: operation.operationId, workKey: operation.workKey,
    generation: operation.generation, jobSha256: sha256(stableJson(job)), attemptedAt: new Date().toISOString() });
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.cf.accountId)}`
    + `/queues/${encodeURIComponent(target.cf.queueId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${freshQueueBearer(target)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body: job, content_type: 'json' }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail('Queue did not confirm acceptance', 'CHATWOOT_FINAL_UAT_QUEUE_SEND_FAILED', { status: response.status });
}

async function poll(target, operation, minimumAttempts) {
  const max = positive(target.env.MKT_CHATWOOT_FINAL_UAT_MAX_POLLS ?? 2_400, 'maxPolls');
  const interval = positive(target.env.MKT_CHATWOOT_FINAL_UAT_POLL_INTERVAL_MS ?? 10_000, 'pollInterval');
  const deploymentCheckEvery = positive(
    target.env.MKT_CHATWOOT_FINAL_UAT_DEPLOYMENT_CHECK_EVERY_POLLS ?? 30,
    'deploymentCheckEveryPolls',
  );
  let last;
  for (let index = 1; index <= max; index += 1) {
    if (index === 1 || index % deploymentCheckEvery === 0) {
      activeVersionId(deploymentStatus(target), safeRestore?.activeVersion);
    }
    last = snapshot(target, operation);
    process.stdout.write(`${JSON.stringify({ event: 'chatwoot_uat_progress', operation: operation.mode,
      poll: index, ...sanitizeChatwootFinalProgress(last) })}\n`);
    if (last.workLifecycleStatus === 'completed' && last.mainQueueAttempts >= minimumAttempts) {
      activeVersionId(deploymentStatus(target), safeRestore?.activeVersion);
      return last;
    }
    const allowedFailedUnits = target.recovery && operation.mode === 'initial'
      && last.workLifecycleStatus === 'active'
      ? Number(target.recoveryBoundary.allowedPreexistingFailedUnits ?? 0)
      : 0;
    if (last.dlqRecords > target.allowedIncidentCounts.dlqRecords
        || last.openChatwootAlerts > target.allowedIncidentCounts.openAlerts
        || last.workLifecycleStatus === 'terminal'
        || last.failedUnitSyncRuns > allowedFailedUnits
        || last.failedCoverageRows) {
      fail('Terminal reliability failure observed', 'CHATWOOT_FINAL_UAT_TERMINAL_FAILURE', scrub(last));
    }
    if (index < max) await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
  }
  fail('Bounded completion polling timed out', 'CHATWOOT_FINAL_UAT_VERIFY_TIMEOUT', sanitizeChatwootFinalProgress(last));
}

function snapshot(target, operation) {
  return normalizeChatwootFinalUatSnapshot(d1Row(target, buildChatwootFinalUatSnapshotSql(operation)));
}

async function larkCounts(target, preflightMode = false) {
  const client = createLarkBitableClientFromEnv(target.env);
  const tables = preflightMode ? await client.listTables() : null;
  const remoteIds = tables ? new Set(tables.map((item) => item.tableId ?? item.table_id ?? item.id)) : null;
  const counts = {};
  for (const spec of CHATWOOT_FINAL_UAT_TABLES) {
    const tableId = target.config.tableIds[spec.key];
    if (remoteIds && !remoteIds.has(tableId)) fail('Configured Lark table is missing', 'CHATWOOT_FINAL_UAT_LARK_TABLE_MISSING', { tableKey: spec.key });
    if (preflightMode) {
      const fields = await client.listFields({ tableId });
      const names = fields.map((field) => field.fieldName ?? field.field_name ?? field.name);
      if (!names.includes(spec.stableKeyField)) fail('Lark Stable key is missing', 'CHATWOOT_FINAL_UAT_LARK_STABLE_KEY_MISSING', { tableKey: spec.key });
    }
    counts[spec.key] = (await client.searchRecords({
      tableId, filter: { conjunction: 'and', conditions: [
        { field_name: 'account_key', operator: 'is', value: ['chemistry_k'] },
      ] }, pageSize: 500, maxPages: 1_000, maxItems: 100_000,
    })).length;
  }
  return Object.freeze(counts);
}

async function restoreAllFalse(context) {
  const { target, activeVersion, baselineVersion } = context;
  const current = activeVersionId(deploymentStatus(target));
  if (![activeVersion, baselineVersion].includes(current)) fail(
    'Concurrent deployment blocks automatic Safe restore',
    'CHATWOOT_FINAL_UAT_CONCURRENT_DEPLOYMENT', { current },
  );
  if (current === baselineVersion) {
    verifyDeployment(target, baselineVersion, 'safe');
  } else {
    const restored = deploy(target, target.config.safeText, 'safe');
    verifyDeployment(target, restored, 'safe');
  }
  await evidence(target, 'safe-restore', { allFlagsFalse: true, scheduleEnabled: false,
    webhookEnabled: false, production: false });
}

function deploy(target, content, mode) {
  const attempt = join(target.evidenceDir, `${mode}-deployment.attempt.json`);
  if (!execExists(attempt)) execPrivateJson(attempt, { mode, head: target.head, attemptedAt: new Date().toISOString() });
  const generated = generatedConfig(target, content);
  try {
    const output = text('npx', ['wrangler', 'deploy', '--config', generated,
      '--message', `${CHATWOOT_FINAL_UAT_CONTRACT_VERSION} mode=${mode} git=${target.head}`],
    { env: target.cf.wranglerEnv, raw: true });
    const ids = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu) ?? [];
    if (!ids.length) fail('Deploy output lacks version ID', 'CHATWOOT_FINAL_UAT_DEPLOY_VERSION_MISSING');
    return ids.at(-1).toLowerCase();
  } finally { try { execFileSync('rm', ['-f', generated]); } catch {} }
}

async function generatedDryRun(target, content, mode) {
  const path = generatedConfig(target, content);
  try { run('npx', ['wrangler', 'deploy', '--dry-run', '--config', path]); }
  finally { try { execFileSync('rm', ['-f', path]); } catch {} }
  await evidence(target, `${mode}-bundle-dry-run`, { passed: true,
    configSha256: mode === 'safe' ? target.config.safeSha256 : target.config.activeSha256 });
}

function generatedConfig(target, content) {
  const directory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', '.generated'));
  execFileSync('mkdir', ['-p', directory]);
  const rebased = rebaseGeneratedWranglerConfigPaths(content, {
    sourceDirectory: dirname(target.sourcePath), outputDirectory: directory,
  });
  const path = join(directory, `wrangler-${Date.now()}-${process.pid}.json`);
  execFileSync('sh', ['-c', 'umask 077; cat > "$1"', 'sh', path], { input: rebased.text });
  return path;
}

function verifyDeployment(target, expectedVersion, mode) {
  activeVersionId(deploymentStatus(target), expectedVersion);
  assertFlags(versionView(target, expectedVersion), mode);
  assertQueue(target, configName(target, 'mainQueueName'), { maxConcurrency: 1, maxBatchSize: 10,
    maxBatchTimeout: 30, maxRetries: 5, deadLetterQueue: configName(target, 'dlqName') });
  assertQueue(target, configName(target, 'dlqName'), { maxConcurrency: 1, maxBatchSize: 10,
    maxBatchTimeout: 30, maxRetries: 10, deadLetterQueue: null });
}

function deploymentStatus(target) {
  return JSON.parse(text('npx', ['wrangler', 'deployments', 'status', '--name', configName(target, 'workerName'),
    '--config', target.sourcePath, '--json'], { env: target.cf.wranglerEnv }));
}
function versionView(target, version) {
  return JSON.parse(text('npx', ['wrangler', 'versions', 'view', version, '--name', configName(target, 'workerName'),
    '--config', target.sourcePath, '--json'], { env: target.cf.wranglerEnv }));
}
function activeVersionId(status, expected = null) {
  const item = Array.isArray(status) ? status[0] : status;
  const active = (item?.versions ?? []).filter((version) => Number(version.percentage) === 100);
  if (active.length !== 1) fail('Worker must have one 100% active version', 'CHATWOOT_FINAL_UAT_ACTIVE_VERSION_INVALID');
  const id = String(active[0].version_id ?? active[0].id ?? '');
  if (!/^[0-9a-f-]{36}$/u.test(id) || (expected && id !== expected)) fail(
    'Active Worker version changed', 'CHATWOOT_FINAL_UAT_ACTIVE_VERSION_CHANGED', { expected, observed: id },
  );
  return id;
}
function assertFlags(view, mode) {
  const item = Array.isArray(view) ? view[0] : view;
  const bindings = item?.bindings ?? item?.resources?.bindings ?? [];
  const trueFlags = bindings.filter((binding) => {
    const name = String(binding.name ?? binding.binding ?? '');
    const value = binding.text ?? binding.value;
    return /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && (value === true || String(value).toLowerCase() === 'true');
  }).map((binding) => String(binding.name ?? binding.binding)).sort();
  const expected = mode === 'active' ? [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort() : [];
  if (stableJson(trueFlags) !== stableJson(expected)) fail('Remote execution flag window is invalid', 'CHATWOOT_FINAL_UAT_REMOTE_FLAG_INVALID', { mode, trueFlags });
}
function assertQueue(target, queueName, expected) {
  const value = JSON.parse(text('npx', ['wrangler', 'queues', 'consumer', 'list', queueName, '--json'], {
    env: target.cf.wranglerEnv,
  }));
  const items = Array.isArray(value) ? value : value.result ?? value.consumers ?? [];
  try {
    return assertWooCommerceQueueConsumerTopology(items, queueName, expected);
  } catch (error) {
    fail('Queue topology differs', 'CHATWOOT_FINAL_UAT_QUEUE_TOPOLOGY_INVALID', {
      queueName,
      field: error?.details?.field ?? null,
      observed: error?.details?.observed ?? null,
      expected: error?.details?.expected ?? null,
      causeCode: error?.code ?? null,
    });
  }
}

async function assertTriggers(target) {
  const base = `/accounts/${encodeURIComponent(target.cf.accountId)}/workers`;
  const script = `${base}/scripts/${encodeURIComponent(configName(target, 'workerName'))}`;
  const [scripts, schedules, subdomain] = await Promise.all([
    cfJson(target, `${base}/scripts?page=1&per_page=100`), cfJson(target, `${script}/schedules`), cfJson(target, `${script}/subdomain`),
  ]);
  const worker = (scripts.result ?? []).find((item) => (item.id ?? item.name) === configName(target, 'workerName'));
  if (!worker || (worker.routes ?? []).length) fail('Worker route state is invalid', 'CHATWOOT_FINAL_UAT_TRIGGER_INVALID');
  const crons = (Array.isArray(schedules.result) ? schedules.result : schedules.result?.schedules ?? []).map((item) => String(item.cron)).sort();
  if (stableJson(crons) !== stableJson([...EXPECTED_CRONS].sort()) || subdomain.result?.enabled !== false) {
    fail('Cron/workers.dev state differs', 'CHATWOOT_FINAL_UAT_TRIGGER_INVALID', { crons });
  }
}
async function cfJson(target, path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${freshQueueBearer(target)}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail('Cloudflare read failed', 'CHATWOOT_FINAL_UAT_CLOUDFLARE_READ_FAILED', { status: response.status });
  return body;
}

function d1Row(target, sql) {
  const parsed = JSON.parse(text('npx', ['wrangler', 'd1', 'execute', configName(target, 'databaseName'), '--remote', '--json',
    '--config', target.sourcePath, '--command', sql], { env: target.cf.wranglerEnv }));
  const row = Array.isArray(parsed) ? parsed.flatMap((item) => item.results ?? [])[0] : parsed.results?.[0];
  if (!row) fail('D1 query returned no row', 'CHATWOOT_FINAL_UAT_D1_EMPTY');
  return row;
}

async function evidence(target, stage, data) {
  const path = join(target.evidenceDir, `${stage}.json`);
  const base = { contractVersion: CHATWOOT_FINAL_UAT_CONTRACT_VERSION, stage, repositoryHead: target.head,
    sessionFingerprint: target.session.sessionFingerprint, data: scrub(data) };
  await privateJson(path, { ...base, evidenceSha256: sha256(stableJson(base)) });
}
async function privateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
function execPrivateJson(path, value) {
  execFileSync('sh', ['-c', 'umask 077; cat > "$1"', 'sh', path], { input: `${JSON.stringify(value, null, 2)}\n` });
}
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
function execExists(path) { try { execFileSync('test', ['-e', path]); return true; } catch { return false; } }

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { cwd: ROOT, env: { ...process.env, ...(options.env ?? {}) }, encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024, stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], input: options.input });
  } catch (error) {
    fail(`Command failed: ${command} ${args.join(' ')}`, 'CHATWOOT_FINAL_UAT_COMMAND_FAILED', {
      command, exitCode: error?.status ?? null, stderrFingerprint: error?.stderr ? sha256(String(error.stderr)) : null,
    });
  }
}
function text(command, args, options = {}) { const value = run(command, args, options); return options.raw ? String(value) : String(value).trim(); }
function pickEnv(env) { return Object.fromEntries(Object.entries({ CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, HOME: process.env.HOME, PATH: process.env.PATH })
  .filter(([, value]) => typeof value === 'string' && value)); }
function configName(target, name) { return target.config[name]; }
function inside(value) { const path = resolve(ROOT, value); if (relative(ROOT, path).startsWith('..')) fail('Path leaves Repository', 'CHATWOOT_FINAL_UAT_PATH_INVALID'); return path; }
function exact(value, expected, name) { if (value !== expected) fail(`${name} must equal ${expected}`, 'CHATWOOT_FINAL_UAT_TARGET_INVALID', { name }); }
function positive(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) fail(`${name} must be positive`, 'CHATWOOT_FINAL_UAT_VALUE_INVALID'); return number; }
function requireVersionId(value, name) {
  const id = String(value ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
    fail(`${name} is invalid`, 'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED');
  }
  return id.toLowerCase();
}
function scrub(value) { if (value === null || value === undefined) return value; if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|tableId|accountId$|queueId$/iu.test(key)).map(([key, nested]) => [key, scrub(nested)])); }
function fail(message, code, details = {}) { const error = new Error(message); error.code = code; error.details = details; throw error; }
