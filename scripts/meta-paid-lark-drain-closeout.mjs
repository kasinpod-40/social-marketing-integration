#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION,
  META_PAID_LARK_DRAIN_MAX_POLLS,
  META_PAID_LARK_DRAIN_POLL_MS,
  classifyMetaPaidLarkDrainStep,
} from './lib/meta-paid-lark-drain-closeout.js';
import {
  buildMetaPaidLarkRuntimeDiagnosisQueries,
  classifyMetaPaidLarkRuntimeDiagnosis,
} from './lib/meta-paid-lark-runtime-blocker-diagnosis.js';

const confirmation = Object.freeze({
  envName: 'CONFIRM_META_PAID_LARK_DRAIN_CLOSEOUT',
  value: 'RUN_META_PAID_LARK_DRAIN_CLOSEOUT',
});
const repositoryRoot = resolve(process.cwd());
let currentStage = 'init';
let closeoutLaunched = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      contractVersion: META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION,
      confirmation: `${confirmation.envName}=${confirmation.value}`,
      action: 'read_only_drain_then_existing_guarded_closeout',
      pollMs: META_PAID_LARK_DRAIN_POLL_MS,
      maxPolls: META_PAID_LARK_DRAIN_MAX_POLLS,
      drainWorkerDeployCount: 0,
      drainQueueSendCount: 0,
      drainD1MutationCount: 0,
      drainLarkMutationCount: 0,
      staleStateMutationAllowed: false,
      newWorkMutationAllowed: false,
      production: false,
    }, null, 2)}\n`);
  } else {
    await executeDrainCloseout();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_PAID_LARK_DRAIN_CLOSEOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    closeoutLaunched,
    drainWorkerDeployCount: 0,
    drainQueueSendCount: 0,
    drainD1MutationCount: 0,
    drainLarkMutationCount: 0,
    production: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeDrainCloseout() {
  if (process.env[confirmation.envName] !== confirmation.value) {
    throw drainError(
      `Paid Meta drain closeout requires ${confirmation.envName}=${confirmation.value}`,
      'META_PAID_LARK_DRAIN_CLOSEOUT_CONFIRMATION_REQUIRED',
    );
  }

  currentStage = 'exact-clean-main';
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false).trim();
  if (branch !== 'main' || head !== originMain || dirty !== '') {
    throw drainError(
      'Paid Meta drain closeout requires exact clean main equal to origin/main',
      'META_PAID_LARK_DRAIN_CLOSEOUT_REPOSITORY_INVALID',
      { branch, head, originMain, clean: dirty === '' },
    );
  }

  currentStage = 'load-dev-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const fileEnv = await readDevVars(devVarsPath);
  const env = Object.freeze({ ...fileEnv, ...process.env, DEV_VARS_FILE: devVarsPath });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const configPath = resolve(
    env.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const configInfo = await stat(configPath).catch(() => null);
  if (!configInfo?.isFile()) {
    throw drainError(
      'Paid Meta drain closeout Wrangler config must be a regular file',
      'META_PAID_LARK_DRAIN_CLOSEOUT_CONFIG_INVALID',
      { configPath },
    );
  }

  const queries = buildMetaPaidLarkRuntimeDiagnosisQueries();
  currentStage = 'initial-read-only-snapshot';
  let previous = await readSnapshot(env, configPath, queries);
  const initialWorkKeys = previous.work.map((row) => row.work_key);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'drain-started',
    repositoryHead: head,
    contractVersion: META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION,
    activeWork: previous.work.length,
    activeQueueOperations: previous.queue.length,
    activeLocks: previous.locks.length,
    initialWorkKeys,
    remoteMutationPerformed: false,
  }, null, 2)}\n`);

  for (let poll = 1; poll <= META_PAID_LARK_DRAIN_MAX_POLLS; poll += 1) {
    currentStage = 'read-only-drain';
    await sleep(META_PAID_LARK_DRAIN_POLL_MS);
    const current = await readSnapshot(env, configPath, queries);
    const diagnosis = classifyMetaPaidLarkRuntimeDiagnosis(previous, current);
    const decision = classifyMetaPaidLarkDrainStep({
      initialWorkKeys,
      previous: counts(previous),
      current: counts(current),
      currentWorkKeys: current.work.map((row) => row.work_key),
      staleReviewRequired: diagnosis.nextGate === 'exact_recovery_review_required',
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'drain-poll',
      poll,
      observedAt: current.observedAt,
      activeWork: current.work.length,
      activeQueueOperations: current.queue.length,
      activeLocks: current.locks.length,
      work: diagnosis.work.map((item) => ({
        workKey: item.work_key,
        latestActivityAt: item.latestActivityAt,
        ageMs: item.ageMs,
        stableAcrossWindow: item.stableAcrossWindow,
        staleByExistingMetaRule: item.staleByExistingMetaRule,
        phases: item.phases.map((phase) => ({
          phase: phase.phase,
          complete: phase.complete,
          expectedItems: phase.expected_items,
          processedItems: phase.processed_items,
          pagesProcessed: phase.pages_processed,
          chunksProcessed: phase.chunks_processed,
          updatedAt: phase.updated_at,
        })),
      })),
      action: decision.action,
      remoteMutationPerformed: false,
    }, null, 2)}\n`);

    if (decision.action === 'stop_new_work_appeared') {
      throw drainError(
        'New remote work appeared during the drain window; closeout remains blocked',
        'META_PAID_LARK_DRAIN_NEW_WORK_APPEARED',
        { appearedWorkKeys: decision.appearedWorkKeys },
      );
    }
    if (decision.action === 'stop_exact_recovery_review_required') {
      throw drainError(
        'Remote work became stable and stale under the existing Meta recovery rule; automatic mutation is blocked',
        'META_PAID_LARK_DRAIN_EXACT_RECOVERY_REVIEW_REQUIRED',
        {
          workKeys: diagnosis.work.map((item) => item.work_key),
          locks: diagnosis.locks.map((item) => ({
            lockKey: item.lock_key,
            ownerId: item.owner_id,
            expiresAt: item.expires_at,
          })),
        },
      );
    }
    if (decision.action === 'launch_existing_closeout') {
      currentStage = 'launch-existing-closeout';
      closeoutLaunched = true;
      const child = spawnSync(process.execPath, [
        'scripts/meta-paid-lark-closeout-safe-entry.mjs',
        '--execute',
      ], {
        cwd: repositoryRoot,
        env: {
          ...env,
          CONFIRM_META_PAID_LARK_CLOSEOUT: 'RUN_META_PAID_LARK_CLOSEOUT',
        },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: 'inherit',
      });
      if (child.error || child.status !== 0) {
        throw drainError(
          'Existing guarded paid Meta closeout failed after verified drain',
          'META_PAID_LARK_DRAIN_EXISTING_CLOSEOUT_FAILED',
          { exitCode: child.status ?? 1 },
        );
      }
      process.stdout.write(`${JSON.stringify({
        ok: true,
        stage: 'complete',
        repositoryHead: head,
        contractVersion: META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION,
        verifiedIdleAcrossTwoSnapshots: true,
        existingCloseoutExitCode: 0,
        drainWorkerDeployCount: 0,
        drainQueueSendCount: 0,
        drainD1MutationCount: 0,
        drainLarkMutationCount: 0,
        production: false,
      }, null, 2)}\n`);
      return;
    }
    previous = current;
  }

  throw drainError(
    'Read-only drain reached its bounded poll limit before verified idle',
    'META_PAID_LARK_DRAIN_POLL_LIMIT_REACHED',
    { maxPolls: META_PAID_LARK_DRAIN_MAX_POLLS },
  );
}

async function readSnapshot(env, configPath, queries) {
  const observedAt = Date.now();
  const [work, queue, locks, phases] = await Promise.all([
    readD1Rows(env, configPath, queries.work),
    readD1Rows(env, configPath, queries.queue),
    readD1Rows(env, configPath, queries.locks),
    readD1Rows(env, configPath, queries.phases),
  ]);
  return Object.freeze({ observedAt, work, queue, locks, phases });
}

function readD1Rows(env, configPath, sql) {
  const stdout = runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB',
    '--remote', '--json', '--config', configPath,
    '--command', sql,
  ], env);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw drainError(
      'Paid Meta drain closeout could not parse Wrangler D1 JSON',
      'META_PAID_LARK_DRAIN_D1_JSON_INVALID',
    );
  }
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])
    : parsed?.results ?? [];
  if (!Array.isArray(rows)) {
    throw drainError(
      'Paid Meta drain closeout D1 response has no results array',
      'META_PAID_LARK_DRAIN_D1_RESULT_INVALID',
    );
  }
  return rows;
}

function counts(snapshot) {
  return Object.freeze({
    activeWork: snapshot.work.length,
    activeQueueOperations: snapshot.queue.length,
    activeLocks: snapshot.locks.length,
  });
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw drainError(
      `Required read-only command failed: ${command} ${args.slice(0, 3).join(' ')}`,
      'META_PAID_LARK_DRAIN_COMMAND_FAILED',
      { command, exitCode: result.status ?? 1 },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, requireOk = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (requireOk && (result.error || result.status !== 0)) {
    throw drainError(
      `Git command failed: git ${args.join(' ')}`,
      'META_PAID_LARK_DRAIN_GIT_FAILED',
    );
  }
  return String(result.stdout ?? '').trim();
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw drainError(
      'Unsupported paid Meta drain closeout arguments',
      'META_PAID_LARK_DRAIN_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw drainError(
      `Paid Meta drain closeout requires ${fieldName}=${expected}`,
      'META_PAID_LARK_DRAIN_TARGET_INVALID',
      { fieldName },
    );
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|state_json|completion_json/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function drainError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkDrainCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}
