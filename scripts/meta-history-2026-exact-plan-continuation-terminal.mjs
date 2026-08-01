#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  META_D1_ONLY_OPERATOR_PHASES,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  META_HISTORY_EXACT_CONTINUATION_CRITICAL_PATHS,
  META_HISTORY_EXACT_CONTINUATION_TARGET,
  assertMetaHistoryExactContinuationConfirmation,
  materializeRetainedMetaD1Summary,
  validateMetaHistoryExactContinuationDelta,
} from './lib/meta-history-exact-plan-continuation.js';
import {
  validateMetaD1OnlySummaryForLark,
} from './lib/meta-lark-parity-rollout-operator.js';

const repositoryRoot = resolve(process.cwd());
const target = META_HISTORY_EXACT_CONTINUATION_TARGET;
const childPath = join(
  repositoryRoot,
  'scripts',
  'meta-history-2026-exact-plan-continuation.mjs',
);
const retainedSafeConfig = join(
  repositoryRoot,
  'outputs',
  'meta-history-2026',
  target.repositoryHead,
  'wrangler.meta-history.safe.jsonc',
);
const retainedD1Root = join(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  target.target,
  target.operationId,
);
const retainedD1Summary = join(retainedD1Root, 'summary.json');
let stage = 'init';

try {
  const args = process.argv.slice(2);
  if (args.includes('--execute')) {
    stage = 'confirm-local-summary-materialization';
    assertMetaHistoryExactContinuationConfirmation(process.env);
    stage = 'verify-current-main-before-local-summary';
    assertExactCurrentMain();
    stage = 'materialize-retained-d1-summary';
    await ensureRetainedD1Summary();
  }

  stage = 'run-exact-plan-continuation';
  const child = spawnSync(
    process.execPath,
    [childPath, ...args],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MKT_META_D1_ONLY_WRANGLER_CONFIG: retainedSafeConfig,
        MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: retainedSafeConfig,
      },
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: 'inherit',
    },
  );

  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_HISTORY_EXACT_CONTINUATION_TERMINAL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    remoteProviderRequestCount: 0,
    remoteQueueSendCount: 0,
    remoteD1MutationCount: 0,
    remoteLarkMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function assertExactCurrentMain() {
  const currentHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || currentHead !== originMain || dirty.trim() !== '') {
    throw terminalError(
      'Retained D1 summary materialization requires clean current main equal to origin/main',
      'META_HISTORY_RETAINED_D1_SUMMARY_REPOSITORY_INVALID',
      { branch, currentHead, originMain, clean: dirty.trim() === '' },
    );
  }
  if (!gitSuccess(['merge-base', '--is-ancestor', target.repositoryHead, currentHead])) {
    throw terminalError(
      'Retained Meta Head is not an ancestor of current main',
      'META_HISTORY_RETAINED_D1_SUMMARY_ANCESTRY_INVALID',
    );
  }

  const changedPaths = gitText([
    'diff', '--name-only', `${target.repositoryHead}..${currentHead}`,
  ]).split('\n').filter(Boolean);
  validateMetaHistoryExactContinuationDelta(changedPaths);
  const criticalDrift = gitText([
    'diff', '--name-only', `${target.repositoryHead}..${currentHead}`, '--',
    ...META_HISTORY_EXACT_CONTINUATION_CRITICAL_PATHS,
  ]).split('\n').filter(Boolean);
  if (criticalDrift.length > 0) {
    throw terminalError(
      'Meta continuation-critical Source changed after the retained operation Head',
      'META_HISTORY_RETAINED_D1_SUMMARY_CRITICAL_DRIFT',
      { criticalDrift },
    );
  }
}

async function ensureRetainedD1Summary() {
  if (await regularFile(retainedD1Summary)) {
    const existing = JSON.parse(await readFile(retainedD1Summary, 'utf8'));
    validateMetaD1OnlySummaryForLark(existing, {
      targetKey: target.target,
      operationId: target.operationId,
    });
    return;
  }

  const fullPhases = META_D1_ONLY_OPERATOR_PHASES.slice(0, -1);
  const planEvidencePresent = await regularFile(join(retainedD1Root, 'plan.json'));
  const phases = planEvidencePresent ? fullPhases : fullPhases.slice(1);
  const missing = [];
  const evidence = [];
  for (const phase of phases) {
    const path = join(retainedD1Root, `${phase}.json`);
    if (!(await regularFile(path))) {
      missing.push(`${phase}.json`);
      continue;
    }
    try {
      evidence.push(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      throw terminalError(
        `Retained Meta D1 evidence is not valid JSON: ${phase}.json`,
        'META_HISTORY_RETAINED_D1_EVIDENCE_JSON_INVALID',
        { phase },
      );
    }
  }
  if (missing.length > 0) {
    throw terminalError(
      'Retained Meta D1 summary cannot be materialized because phase evidence is incomplete',
      'META_HISTORY_RETAINED_D1_EVIDENCE_FILES_MISSING',
      { missing, planEvidencePresent },
    );
  }

  const summary = materializeRetainedMetaD1Summary(evidence);
  validateMetaD1OnlySummaryForLark(summary, {
    targetKey: target.target,
    operationId: target.operationId,
  });

  await mkdir(retainedD1Root, { recursive: true, mode: 0o700 });
  const temporary = join(
    dirname(retainedD1Summary),
    `.summary.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, retainedD1Summary);
  if (!(await regularFile(retainedD1Summary))) {
    throw terminalError(
      'Retained Meta D1 summary was not written as a regular file',
      'META_HISTORY_RETAINED_D1_SUMMARY_WRITE_INVALID',
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    decision: 'META_HISTORY_RETAINED_D1_SUMMARY_MATERIALIZED',
    operationId: target.operationId,
    phaseCount: summary.data.phaseCount,
    evidenceChainStartPhase: summary.data.evidenceChainStartPhase,
    planEvidencePresent: summary.data.planEvidencePresent,
    providerReplay: false,
    queueResend: false,
    remoteD1MutationCount: 0,
    remoteLarkMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function gitText(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw terminalError(
      `Required git command failed: git ${args.join(' ')}`,
      'META_HISTORY_RETAINED_D1_SUMMARY_GIT_FAILED',
      { exitCode: result.status ?? 1 },
    );
  }
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}

function gitSuccess(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !result.error && result.status === 0;
}

function sanitize(value, key = '') {
  if (/token|secret|password|authorization|cookie|credential/iu.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitize(childValue, childKey),
    ]));
  }
  return value;
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaHistoryRetainedD1SummaryError';
  error.code = code;
  error.details = details;
  return error;
}
