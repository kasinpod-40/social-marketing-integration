#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
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
  extractWranglerD1Rows,
  parseWranglerDeploymentOutput,
} from './lib/tiktok-post-lark-rollout-operator.js';
import { readTikTokPostLarkBoundedJsonResponse } from './lib/tiktok-post-lark-exact-version.js';
import {
  buildTikTokAdmissionStatusSql,
  buildTikTokPostLarkReconciliationEnvelope,
  buildTikTokPostLarkReconciliationWranglerConfig,
  classifyTikTokPostLarkAuditForReconciliation,
  normalizeTikTokAdmissionStatusRow,
  readPreviousCompletedBangkokDate,
  requireWorkerVersionId,
  TIKTOK_GAP_RECONCILIATION_CONFIRMATION,
  validateTikTokAdmissionIdempotentReplay,
  validateTikTokPostLarkReconciledAudit,
} from './lib/tiktok-post-lark-gap-reconciliation.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';

const REPOSITORY_ROOT = resolve(process.cwd());
const WORKER_NAME = 'social-mkt-sync-worker';
const DATABASE_NAME = 'social-mkt-state-dev';
const QUEUE_NAME = 'social-mkt-sync-jobs';
const AUDIT_PATH = '/operator/tiktok/post-lark-audit';
const VERSION_HEADER = 'x-mkt-worker-version-id';
const EVIDENCE_ROOT = resolve(
  process.env.MKT_TIKTOK_RECONCILIATION_EVIDENCE_DIR
    ?? 'outputs/tiktok-post-lark-reconciliation',
);
const ACTIVE_READINESS_ATTEMPTS = 24;
const ACTIVE_READINESS_DELAY_MS = 5_000;
const ADMISSION_POLL_ATTEMPTS = 240;
const ADMISSION_POLL_DELAY_MS = 5_000;
const REPLAY_SETTLE_MS = 30_000;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'TIKTOK_GAP_RECONCILIATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.execute) {
    printPlan();
    return;
  }

  const env = await loadEnvironment();
  requireExact(
    env[TIKTOK_GAP_RECONCILIATION_CONFIRMATION.envName],
    TIKTOK_GAP_RECONCILIATION_CONFIRMATION.value,
    TIKTOK_GAP_RECONCILIATION_CONFIRMATION.envName,
  );
  assertRepositoryState();

  const sourceConfigPath = resolveRepositoryFile(
    env.MKT_TIKTOK_RECONCILIATION_WRANGLER_CONFIG
      ?? 'wrangler.sync.tiktok-rollout-safe.jsonc',
  );
  await requireReadableFile(sourceConfigPath);
  const sourceConfigText = await readFile(sourceConfigPath, 'utf8');
  const safeConfigText = buildTikTokPostLarkReconciliationWranglerConfig(
    sourceConfigText,
    { mode: 'safe' },
  );
  const activeConfigText = buildTikTokPostLarkReconciliationWranglerConfig(
    sourceConfigText,
    { mode: 'reconcile' },
  );
  const safeConfigPath = resolve(REPOSITORY_ROOT, `.mkt-tiktok-reconcile-safe-${process.pid}.jsonc`);
  const activeConfigPath = resolve(REPOSITORY_ROOT, `.mkt-tiktok-reconcile-active-${process.pid}.jsonc`);
  await Promise.all([
    writeFile(safeConfigPath, safeConfigText, { mode: 0o600 }),
    writeFile(activeConfigPath, activeConfigText, { mode: 0o600 }),
    mkdir(EVIDENCE_ROOT, { recursive: true }),
  ]);

  const activeConfig = JSON.parse(activeConfigText);
  const workerOrigin = requireHttpsOrigin(
    env.MKT_TIKTOK_RECONCILIATION_WORKER_ORIGIN
      ?? activeConfig.vars?.MKT_CONNECTION_PUBLIC_ORIGIN,
    'MKT_TIKTOK_RECONCILIATION_WORKER_ORIGIN',
  );
  const operatorToken = resolveOperatorToken(env);
  const context = Object.freeze({
    env,
    sourceConfigPath,
    safeConfigPath,
    activeConfigPath,
    workerOrigin,
    operatorToken,
  });

  let mustSafeClose = false;
  let finalSafe = null;
  let primaryError = null;
  let summary = null;

  try {
    const safeBaseline = await deployAndWaitActive({
      label: 'safe-baseline',
      configPath: safeConfigPath,
      expectedStatus: 404,
      workerOrigin,
      env,
    });

    mustSafeClose = true;
    const activeDeployment = await deployAndWaitActive({
      label: 'reconciliation-active',
      configPath: activeConfigPath,
      expectedStatus: 401,
      workerOrigin,
      env,
    });

    const beforeAudit = await fetchAuthenticatedAudit({
      workerOrigin,
      operatorToken,
      expectedVersionId: activeDeployment.deploymentVersionId,
    });
    const plan = classifyTikTokPostLarkAuditForReconciliation(beforeAudit, exactIdentity());
    if (plan.blocked) {
      throw operatorError(
        'TikTok audit contains non-additive conflicts; automatic reconciliation is blocked',
        'TIKTOK_GAP_RECONCILIATION_BLOCKED',
        { blockers: plan.blockers },
      );
    }

    if (plan.ready) {
      summary = Object.freeze({
        result: 'already_ready',
        repositoryHead: readCommand('git', ['rev-parse', 'HEAD'], env).trim(),
        safeBaseline,
        activeDeployment,
        initial: plan,
        final: plan,
        queueMessagesSent: 0,
        idempotentReplay: true,
      });
    } else {
      summary = await executeReconciliation({
        context,
        safeBaseline,
        activeDeployment,
        beforeAudit,
        plan,
      });
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (mustSafeClose) {
      try {
        finalSafe = await deployAndWaitActive({
          label: primaryError ? 'emergency-safe-close' : 'final-safe-close',
          configPath: safeConfigPath,
          expectedStatus: 404,
          workerOrigin,
          env,
        });
      } catch (safeError) {
        await saveEvidence('safe-close-failure.json', {
          status: 'failed',
          capturedAt: new Date().toISOString(),
          primaryErrorCode: primaryError?.code ?? null,
          safeCloseErrorCode: safeError?.code ?? 'TIKTOK_GAP_RECONCILIATION_SAFE_CLOSE_FAILED',
        });
        primaryError = operatorError(
          'TikTok reconciliation could not prove final safe-close',
          'TIKTOK_GAP_RECONCILIATION_SAFE_CLOSE_FAILED',
          {
            primaryErrorCode: primaryError?.code ?? null,
            safeCloseErrorCode: safeError?.code ?? null,
          },
        );
      }
    }
    await Promise.all([
      rm(safeConfigPath, { force: true }),
      rm(activeConfigPath, { force: true }),
    ]);
  }

  if (primaryError) throw primaryError;
  const completed = Object.freeze({
    ...summary,
    finalSafe,
    finalRouteStatus: 404,
    queueOrWriteOutsideGuardedReconciliation: false,
    schedulesActivated: false,
    retentionOrDelete: false,
    productionAction: false,
  });
  await saveEvidence('summary.json', completed);
  printResult(completed);
}

async function executeReconciliation(input) {
  const { context, activeDeployment, beforeAudit, plan } = input;
  const requestedAt = Date.now();
  const metricDate = readPreviousCompletedBangkokDate(new Date(requestedAt));
  const envelope = buildTikTokPostLarkReconciliationEnvelope({ requestedAt, metricDate });
  const admissionSql = buildTikTokAdmissionStatusSql({
    sourceWatermark: plan.sourceWatermark,
    metricDate,
  });
  const existing = await readAdmission(context, admissionSql, plan.sourceWatermark, metricDate);
  if (existing?.status === 'completed') {
    throw operatorError(
      'A completed admission already exists for this watermark/date while parity is incomplete',
      'TIKTOK_GAP_RECONCILIATION_COMPLETED_ADMISSION_CONFLICT',
      {
        admissionKey: existing.admissionKey,
        metricDate,
      },
    );
  }

  const cloudflare = await resolveCloudflareQueueTarget(context);
  let queueMessagesSent = 0;
  if (!existing || ['pending', 'failed_retryable'].includes(existing.status)) {
    await sendQueueEnvelope({ ...cloudflare, envelope });
    queueMessagesSent += 1;
  }
  const completedAdmission = await waitForAdmissionCompleted({
    context,
    admissionSql,
    sourceWatermark: plan.sourceWatermark,
    metricDate,
  });
  const afterAudit = await fetchAuthenticatedAudit({
    workerOrigin: context.workerOrigin,
    operatorToken: context.operatorToken,
    expectedVersionId: activeDeployment.deploymentVersionId,
  });
  const parity = validateTikTokPostLarkReconciledAudit(
    beforeAudit,
    afterAudit,
    exactIdentity(),
  );

  await sendQueueEnvelope({ ...cloudflare, envelope });
  queueMessagesSent += 1;
  await sleep(REPLAY_SETTLE_MS);
  const replayAdmission = await readAdmission(
    context,
    admissionSql,
    plan.sourceWatermark,
    metricDate,
  );
  const replay = validateTikTokAdmissionIdempotentReplay(
    admissionToRow(completedAdmission),
    admissionToRow(replayAdmission),
  );
  const replayAudit = await fetchAuthenticatedAudit({
    workerOrigin: context.workerOrigin,
    operatorToken: context.operatorToken,
    expectedVersionId: activeDeployment.deploymentVersionId,
  });
  const replayParity = validateTikTokPostLarkReconciledAudit(
    beforeAudit,
    replayAudit,
    exactIdentity(),
  );

  return Object.freeze({
    result: 'reconciled',
    repositoryHead: readCommand('git', ['rev-parse', 'HEAD'], context.env).trim(),
    safeBaseline: input.safeBaseline,
    activeDeployment,
    initial: parity.initial,
    final: replayParity.final,
    admission: completedAdmission,
    queueMessagesSent,
    idempotentReplay: replay.idempotent,
    metricDate,
  });
}

async function deployAndWaitActive(input) {
  const outputFile = join(tmpdir(), `mkt-tiktok-reconcile-${randomUUID()}.ndjson`);
  const startedAt = new Date().toISOString();
  try {
    runWrangler(['deploy', '--config', input.configPath], {
      env: {
        ...input.env,
        WRANGLER_OUTPUT_FILE_PATH: outputFile,
      },
    });
    const deploymentOutput = await readFile(outputFile, 'utf8');
    const deployment = parseWranglerDeploymentOutput(deploymentOutput, {
      workerName: WORKER_NAME,
    });
    const readiness = await waitForActiveDeployment({
      workerOrigin: input.workerOrigin,
      expectedVersionId: deployment.deploymentVersionId,
      expectedStatus: input.expectedStatus,
      label: input.label,
    });
    const result = Object.freeze({
      label: input.label,
      startedAt,
      completedAt: new Date().toISOString(),
      deploymentVersionId: deployment.deploymentVersionId,
      runtimeVersionId: readiness.runtimeVersionId,
      routeStatus: readiness.routeStatus,
      activeDeploymentAttested: true,
      configSha256: sha256(await readFile(input.configPath)),
    });
    process.stdout.write(`${input.label.toUpperCase().replaceAll('-', '_')}=PASS\n`);
    return result;
  } finally {
    await rm(outputFile, { force: true });
  }
}

async function waitForActiveDeployment(input) {
  const expectedVersionId = requireWorkerVersionId(input.expectedVersionId);
  for (let attempt = 1; attempt <= ACTIVE_READINESS_ATTEMPTS; attempt += 1) {
    try {
      const observations = [];
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        const url = new URL(AUDIT_PATH, `${input.workerOrigin}/`);
        url.searchParams.set('mkt_active_probe', `${randomUUID()}-${sequence}`);
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'Cache-Control': 'no-cache, no-store',
            Pragma: 'no-cache',
          },
          signal: AbortSignal.timeout(10_000),
        });
        const runtimeVersionId = response.headers.get(VERSION_HEADER);
        await discardBoundedBody(response, 4_096);
        observations.push({
          status: response.status,
          runtimeVersionId,
        });
        if (response.status !== input.expectedStatus || runtimeVersionId !== expectedVersionId) {
          throw operatorError(
            'Active Worker deployment has not converged yet',
            'TIKTOK_GAP_RECONCILIATION_ACTIVE_NOT_READY',
            {
              expectedVersionId,
              expectedStatus: input.expectedStatus,
              observedStatus: response.status,
              observedVersionId: runtimeVersionId,
              attempt,
              sequence,
            },
          );
        }
        if (sequence < 3) await sleep(500);
      }
      return Object.freeze({
        runtimeVersionId: expectedVersionId,
        routeStatus: input.expectedStatus,
        observations: Object.freeze(observations),
      });
    } catch (error) {
      if (attempt >= ACTIVE_READINESS_ATTEMPTS) throw error;
      await sleep(ACTIVE_READINESS_DELAY_MS);
    }
  }
  throw operatorError(
    'Active Worker deployment readiness exhausted its bound',
    'TIKTOK_GAP_RECONCILIATION_ACTIVE_NOT_READY',
  );
}

async function fetchAuthenticatedAudit(input) {
  const expectedVersionId = requireWorkerVersionId(input.expectedVersionId);
  const url = new URL(AUDIT_PATH, `${input.workerOrigin}/`);
  url.searchParams.set('mkt_reconciliation_audit', randomUUID());
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${input.operatorToken}`,
      Accept: 'application/json',
      'Cache-Control': 'no-cache, no-store',
      Pragma: 'no-cache',
    },
    signal: AbortSignal.timeout(120_000),
  });
  const runtimeVersionId = response.headers.get(VERSION_HEADER);
  const body = await readTikTokPostLarkBoundedJsonResponse(response);
  if (runtimeVersionId !== expectedVersionId) {
    throw operatorError(
      'Authenticated TikTok audit ran on the wrong active Worker version',
      'TIKTOK_GAP_RECONCILIATION_RUNTIME_VERSION_MISMATCH',
      { expectedVersionId, observedVersionId: runtimeVersionId },
    );
  }
  if (response.status !== 200 || body?.ok !== true || !body?.audit) {
    throw operatorError(
      'Authenticated TikTok audit failed',
      'TIKTOK_GAP_RECONCILIATION_AUDIT_FAILED',
      {
        httpStatus: response.status,
        remoteCode: typeof body?.code === 'string'
          ? body.code
          : 'TIKTOK_POST_LARK_AUDIT_FAILED',
      },
    );
  }
  return Object.freeze(body.audit);
}

async function resolveCloudflareQueueTarget(context) {
  const baseEnv = compactCloudflareEnv(context.env);
  const configText = await readFile(context.sourceConfigPath, 'utf8');
  const whoamiOutput = wranglerText(['whoami', '--json'], { env: baseEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: context.env.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput,
    preferredAccount: context.env.MKT_TIKTOK_RECONCILIATION_ACCOUNT,
  });
  const selectedEnv = { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  runWrangler(['whoami', '--account', accountId, '--json'], { env: selectedEnv });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: context.env.CLOUDFLARE_API_TOKEN,
    authOutput: optionalText(context.env.CLOUDFLARE_API_TOKEN)
      ? null
      : wranglerText(['auth', 'token', '--json'], { env: selectedEnv }),
  });
  const queues = await listCloudflareQueues({ accountId, apiToken: auth.token });
  const queueId = resolveWooCommerceQueueId(queues, QUEUE_NAME);
  return Object.freeze({ accountId, apiToken: auth.token, queueId });
}

async function listCloudflareQueues(input) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/queues`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.apiToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw operatorError(
      'Cloudflare Queue list returned invalid JSON',
      'TIKTOK_GAP_RECONCILIATION_QUEUE_LIST_INVALID',
      { status: response.status, responseSha256: sha256(text) },
    );
  }
  if (!response.ok || body?.success !== true) {
    throw operatorError(
      'Cloudflare Queue list request failed',
      'TIKTOK_GAP_RECONCILIATION_QUEUE_LIST_FAILED',
      {
        status: response.status,
        errorCodes: Array.isArray(body?.errors)
          ? body.errors.map((item) => item?.code).filter(Number.isFinite)
          : [],
      },
    );
  }
  return body;
}

async function sendQueueEnvelope(input) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/queues/${encodeURIComponent(input.queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.envelope),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw operatorError(
      'Cloudflare Queue submission returned invalid JSON',
      'TIKTOK_GAP_RECONCILIATION_QUEUE_SEND_INVALID',
      { status: response.status, responseSha256: sha256(text) },
    );
  }
  if (!response.ok || body?.success !== true) {
    throw operatorError(
      'Cloudflare Queue submission failed',
      'TIKTOK_GAP_RECONCILIATION_QUEUE_SEND_FAILED',
      {
        status: response.status,
        errorCodes: Array.isArray(body?.errors)
          ? body.errors.map((item) => item?.code).filter(Number.isFinite)
          : [],
      },
    );
  }
  process.stdout.write('QUEUE_SUBMISSION=ACCEPTED\n');
}

async function waitForAdmissionCompleted(input) {
  for (let attempt = 1; attempt <= ADMISSION_POLL_ATTEMPTS; attempt += 1) {
    const admission = await readAdmission(
      input.context,
      input.admissionSql,
      input.sourceWatermark,
      input.metricDate,
    );
    if (admission?.status === 'completed') return admission;
    if (attempt < ADMISSION_POLL_ATTEMPTS) await sleep(ADMISSION_POLL_DELAY_MS);
  }
  throw operatorError(
    'TikTok reconciliation admission did not complete within the bounded window',
    'TIKTOK_GAP_RECONCILIATION_TIMEOUT',
    { attempts: ADMISSION_POLL_ATTEMPTS },
  );
}

async function readAdmission(context, sql, sourceWatermark, metricDate) {
  const result = runWrangler([
    'd1',
    'execute',
    DATABASE_NAME,
    '--remote',
    '--config',
    context.activeConfigPath,
    '--command',
    sql,
    '--json',
  ], { env: context.env });
  const rows = extractWranglerD1Rows(result.stdout);
  if (rows.length > 1) {
    throw operatorError(
      'TikTok admission lookup returned more than one row',
      'TIKTOK_GAP_RECONCILIATION_ADMISSION_INVALID',
      { rowCount: rows.length },
    );
  }
  return normalizeTikTokAdmissionStatusRow(rows[0] ?? null, {
    sourceWatermark,
    metricDate,
  });
}

function admissionToRow(value) {
  if (!value) return null;
  return {
    admission_key: value.admissionKey,
    status: value.status,
    source_watermark: value.sourceWatermark,
    metric_date: value.metricDate,
    source_record_count: value.sourceRecordCount,
    sync_run_id: value.syncRunId,
    error_code: value.errorCode,
    requested_at: value.requestedAt,
    completed_at: value.completedAt,
    updated_at: value.updatedAt,
  };
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    command: `${TIKTOK_GAP_RECONCILIATION_CONFIRMATION.envName}=${TIKTOK_GAP_RECONCILIATION_CONFIRMATION.value} node scripts/tiktok-post-lark-gap-reconciliation.mjs --execute`,
    sequence: [
      'deploy-and-attest-safe-404',
      'deploy-reconciliation-audit-gates-with-schedules-false',
      'read-only-audit-and-classify-exact-gaps',
      'send-one-manual-watermark-probe-only-for-additive-gaps',
      'wait-for-completed-admission',
      'verify-zero-gap-parity',
      'resend-exact-probe-and-prove-admission-idempotency',
      'deploy-and-attest-final-safe-404',
    ],
    safety: {
      planOnlyByDefault: true,
      migrations: false,
      scheduleActivation: false,
      retentionDelete: false,
      production: false,
      destructiveRepair: false,
      emergencySafeClose: true,
    },
  }, null, 2)}\n`);
}

function printResult(result) {
  process.stdout.write([
    'FINAL_RECONCILIATION_RESULT=PASS_SAFE_CLOSED',
    `RECONCILIATION_MODE=${result.result}`,
    `INITIAL_GAP_CATEGORIES=${result.initial.additiveGapCount}`,
    `INITIAL_MISSING_ENTITY_TOTAL=${result.initial.additiveMissingEntityTotal}`,
    `FINAL_ISSUE_COUNT=${result.final.issueCount}`,
    `RAW_RECORD_COUNT=${result.final.rawRecordCount}`,
    `QUEUE_MESSAGES_SENT=${result.queueMessagesSent}`,
    `IDEMPOTENT_REPLAY=${String(result.idempotentReplay)}`,
    'SCHEDULES_ACTIVATED=false',
    'RETENTION_OR_DELETE=false',
    'FINAL_ROUTE_STATUS=404',
    `EVIDENCE_FILE=${join(EVIDENCE_ROOT, 'summary.json')}`,
  ].join('\n') + '\n');
}

function parseArgs(args) {
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    throw operatorError(
      `Unsupported TikTok reconciliation argument: ${arg}`,
      'TIKTOK_GAP_RECONCILIATION_ARGUMENT_INVALID',
    );
  }
  return Object.freeze({ execute });
}

async function loadEnvironment() {
  let fileEnv = {};
  try {
    fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return Object.freeze({ ...fileEnv, ...process.env });
}

function resolveOperatorToken(env) {
  const explicit = optionalText(env.MKT_CONNECTION_OPERATOR_TOKEN);
  if (explicit) return requireSecret(explicit, 'MKT_CONNECTION_OPERATOR_TOKEN');
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/security', [
      'find-generic-password',
      '-a',
      'MKT_CONNECTION_OPERATOR_TOKEN',
      '-s',
      'MKT Social Marketing Integration',
      '-w',
    ], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result.error && result.status === 0) {
      return requireSecret(result.stdout.trim(), 'MKT_CONNECTION_OPERATOR_TOKEN');
    }
  }
  throw operatorError(
    'TikTok reconciliation operator token is unavailable',
    'TIKTOK_GAP_RECONCILIATION_OPERATOR_TOKEN_MISSING',
  );
}

function assertRepositoryState() {
  const branch = readCommand('git', ['branch', '--show-current'], process.env).trim();
  if (branch !== 'main') {
    throw operatorError(
      'TikTok reconciliation must run from merged main',
      'TIKTOK_GAP_RECONCILIATION_REPOSITORY_INVALID',
      { branch },
    );
  }
  const dirty = readCommand('git', ['status', '--porcelain'], process.env).trim();
  if (dirty) {
    throw operatorError(
      'TikTok reconciliation requires a clean working tree',
      'TIKTOK_GAP_RECONCILIATION_REPOSITORY_INVALID',
      { dirtyPaths: dirty.split(/\r?\n/u) },
    );
  }
}

function runWrangler(args, options = {}) {
  return runCommand('npx', ['wrangler', ...args], options.env ?? process.env);
}

function wranglerText(args, options = {}) {
  return runWrangler(args, options).stdout;
}

function runCommand(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw operatorError(
      `${command} ${args.join(' ')} failed`,
      'TIKTOK_GAP_RECONCILIATION_COMMAND_FAILED',
      {
        command,
        args,
        status: result.status,
        stdoutSha256: sha256(result.stdout ?? ''),
        stderrSha256: sha256(result.stderr ?? ''),
      },
    );
  }
  return Object.freeze({
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  });
}

function readCommand(command, args, env) {
  return runCommand(command, args, env).stdout;
}

function compactCloudflareEnv(env) {
  const output = { ...env };
  for (const name of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!optionalText(output[name])) delete output[name];
  }
  return output;
}

async function discardBoundedBody(response, maximumBytes) {
  const reader = response.body?.getReader();
  if (!reader) return;
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw operatorError(
          'TikTok readiness response exceeded its size bound',
          'TIKTOK_GAP_RECONCILIATION_RESPONSE_TOO_LARGE',
          { maximumBytes },
        );
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function saveEvidence(name, value) {
  await writeFile(
    join(EVIDENCE_ROOT, name),
    `${JSON.stringify(sanitize(value), null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function requireReadableFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw operatorError(
      'TikTok reconciliation Wrangler config is not readable',
      'TIKTOK_GAP_RECONCILIATION_CONFIG_MISSING',
      { path },
    );
  }
}

function resolveRepositoryFile(value) {
  const path = resolve(REPOSITORY_ROOT, requireText(value, 'configPath'));
  if (path !== REPOSITORY_ROOT && !path.startsWith(`${REPOSITORY_ROOT}/`)) {
    throw operatorError(
      'TikTok reconciliation config must remain inside Repository',
      'TIKTOK_GAP_RECONCILIATION_PATH_INVALID',
    );
  }
  return path;
}

function exactIdentity() {
  return Object.freeze({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
  });
}

function requireHttpsOrigin(value, fieldName) {
  let url;
  try {
    url = new URL(requireText(value, fieldName));
  } catch {
    throw operatorError(
      `${fieldName} must be an HTTPS origin`,
      'TIKTOK_GAP_RECONCILIATION_TARGET_INVALID',
      { fieldName },
    );
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw operatorError(
      `${fieldName} must be an HTTPS origin`,
      'TIKTOK_GAP_RECONCILIATION_TARGET_INVALID',
      { fieldName },
    );
  }
  return url.origin;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'TIKTOK_GAP_RECONCILIATION_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireSecret(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.length < 16) {
    throw operatorError(
      `${fieldName} is invalid`,
      'TIKTOK_GAP_RECONCILIATION_SECRET_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:secret|token|password|authorization|apiToken|operatorToken)/iu.test(key)) continue;
    output[key] = sanitize(nested);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokPostLarkGapReconciliationOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
