#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { extractWranglerD1Rows } from './lib/tiktok-post-lark-rollout-operator.js';
import {
  TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION,
} from './lib/tiktok-course-level-schema-recovery.js';
import {
  TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION,
  buildTikTokCourseLevelTerminalEvidenceSql,
  buildTikTokCourseLevelTerminalReactivationSql,
  validateTikTokCourseLevelTerminalEvidence,
  validateTikTokCourseLevelTerminalReactivationRow,
} from './lib/tiktok-course-level-terminal-reactivation.js';

const ROOT = resolve(process.cwd());
const DATABASE_NAME = 'social-mkt-state-dev';
const DEFAULT_SAFE_CONFIG = 'wrangler.sync.tiktok-rollout-safe.jsonc';
let terminalWorkReactivated = false;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    phase: 'tiktok-course-level-terminal-reactivation',
    code: error?.code ?? 'TIKTOK_COURSE_LEVEL_TERMINAL_WRAPPER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    terminalWorkReactivated,
    larkSchemaMutationByWrapper: 0,
    larkBusinessRecordWriteByWrapper: 0,
    remoteD1BusinessWriteByWrapper: 0,
    queueMessageSentByWrapper: 0,
    scheduleActivationCount: 0,
    productionActionCount: 0,
    retrySafe: true,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
    return;
  }

  const fileEnv = await readOptionalDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  requireExact(
    env[TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION.envName],
    TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION.value,
    TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION.envName,
  );
  const repository = assertRepositoryState(env);
  const configPath = resolveRepositoryFile(
    env.MKT_TIKTOK_RECONCILIATION_WRANGLER_CONFIG ?? DEFAULT_SAFE_CONFIG,
  );
  await access(configPath, constants.R_OK);

  const beforeRows = runD1({
    env,
    configPath,
    sql: buildTikTokCourseLevelTerminalEvidenceSql({ checkedAt: Date.now() }),
  });
  if (beforeRows.length !== 1) {
    throw operatorError(
      'TikTok course-level terminal evidence did not return exactly one row',
      'TIKTOK_COURSE_LEVEL_TERMINAL_EVIDENCE_NOT_FOUND',
      { rowCount: beforeRows.length },
    );
  }

  const lifecycleStatus = beforeRows[0]?.work_lifecycle_status;
  let terminalEvidence = null;
  if (lifecycleStatus === 'terminal') {
    terminalEvidence = validateTikTokCourseLevelTerminalEvidence(beforeRows[0], 'terminal');
    const updateRows = runD1({
      env,
      configPath,
      sql: buildTikTokCourseLevelTerminalReactivationSql({ updatedAt: Date.now() }),
    });
    if (updateRows.length !== 1) {
      throw operatorError(
        'TikTok terminal reactivation did not update exactly one guarded row',
        'TIKTOK_COURSE_LEVEL_TERMINAL_REACTIVATION_REJECTED',
        { rowCount: updateRows.length },
      );
    }
    validateTikTokCourseLevelTerminalReactivationRow(updateRows[0]);
    terminalWorkReactivated = true;
    process.stdout.write('TIKTOK_TERMINAL_WORK_REACTIVATED=PASS\n');
  } else if (lifecycleStatus === 'active') {
    validateTikTokCourseLevelTerminalEvidence(beforeRows[0], 'active');
    process.stdout.write('TIKTOK_TERMINAL_WORK_ALREADY_ACTIVE=PASS\n');
  } else {
    throw operatorError(
      'TikTok course-level Work is neither terminal-recoverable nor active',
      'TIKTOK_COURSE_LEVEL_TERMINAL_STATE_INVALID',
      { lifecycleStatus: lifecycleStatus ?? null },
    );
  }

  const afterRows = runD1({
    env,
    configPath,
    sql: buildTikTokCourseLevelTerminalEvidenceSql({ checkedAt: Date.now() }),
  });
  if (afterRows.length !== 1) {
    throw operatorError(
      'TikTok active-state verification did not return exactly one row',
      'TIKTOK_COURSE_LEVEL_TERMINAL_ACTIVE_VERIFY_FAILED',
      { rowCount: afterRows.length },
    );
  }
  const activeEvidence = validateTikTokCourseLevelTerminalEvidence(afterRows[0], 'active');
  process.stdout.write('TIKTOK_TERMINAL_WORK_ACTIVE_VERIFY=PASS\n');

  const child = runCourseLevelRecovery({ env });
  const proof = String(child.stdout ?? '');
  for (const marker of [
    'TIKTOK_COURSE_LEVEL_RECOVERY=PASS',
    'FINAL_RECONCILIATION_RESULT=PASS_SAFE_CLOSED',
    'FINAL_ISSUE_COUNT=0',
    'IDEMPOTENT_REPLAY=true',
    'FINAL_ROUTE_STATUS=404',
  ]) {
    if (!proof.includes(marker)) {
      throw operatorError(
        'TikTok course-level child recovery did not prove final zero-gap safe-close',
        'TIKTOK_COURSE_LEVEL_TERMINAL_FINAL_PROOF_MISSING',
        { marker },
      );
    }
  }

  process.stdout.write([
    'TIKTOK_COURSE_LEVEL_TERMINAL_RECOVERY=PASS',
    `REPOSITORY_HEAD=${repository.head}`,
    `TERMINAL_WORK_REACTIVATED=${String(terminalWorkReactivated)}`,
    `TERMINAL_DLQ_REFERENCE_CAPTURED=${String(Boolean(terminalEvidence?.auditReference))}`,
    `ACTIVE_CURSOR_KEY_PRESENT=${String(Boolean(activeEvidence.cursorKey))}`,
    'LARK_SCHEMA_MUTATION_BY_WRAPPER=0',
    'LARK_BUSINESS_WRITE_BY_WRAPPER=0',
    'REMOTE_D1_BUSINESS_WRITE_BY_WRAPPER=0',
    'QUEUE_MESSAGE_SENT_BY_WRAPPER=0',
    'SCHEDULES_ACTIVATED=false',
    'PRODUCTION_ACTION=false',
  ].join('\n') + '\n');
}

function runCourseLevelRecovery(input) {
  const result = spawnSync(
    process.execPath,
    ['scripts/tiktok-course-level-schema-recovery.mjs', '--execute'],
    {
      cwd: ROOT,
      env: {
        ...input.env,
        [TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.envName]:
          TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION.value,
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw operatorError(
      'TikTok course-level recovery failed after terminal Work reactivation',
      'TIKTOK_COURSE_LEVEL_TERMINAL_CHILD_FAILED',
      { exitCode: result.status },
    );
  }
  return result;
}

function runD1(input) {
  const result = spawnSync('npx', [
    'wrangler', 'd1', 'execute', DATABASE_NAME,
    '--remote', '--config', input.configPath,
    '--command', input.sql, '--json',
  ], {
    cwd: ROOT,
    env: input.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw operatorError(
      'Wrangler D1 command failed during TikTok terminal Work recovery',
      'TIKTOK_COURSE_LEVEL_TERMINAL_D1_COMMAND_FAILED',
      { exitCode: result.status },
    );
  }
  return extractWranglerD1Rows(result.stdout);
}

function assertRepositoryState(env) {
  runGit(['fetch', 'origin', 'main'], env, true);
  const branch = runGit(['branch', '--show-current'], env).trim();
  const head = runGit(['rev-parse', 'HEAD'], env).trim();
  const originMain = runGit(['rev-parse', 'origin/main'], env).trim();
  const clean = runGit(['status', '--porcelain', '--untracked-files=no'], env).trim() === '';
  if (branch !== 'main' || head !== originMain || !clean) {
    throw operatorError(
      'TikTok terminal recovery requires clean current main matching origin/main',
      'TIKTOK_COURSE_LEVEL_TERMINAL_REPOSITORY_STATE_INVALID',
      { branch, headMatchesOriginMain: head === originMain, clean },
    );
  }
  return Object.freeze({ branch, head, clean, headMatchesOriginMain: true });
}

function runGit(args, env, ignoreOutput = false) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ignoreOutput ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw operatorError(
      `Git command failed: git ${args.join(' ')}`,
      'TIKTOK_COURSE_LEVEL_TERMINAL_GIT_COMMAND_FAILED',
      { exitCode: result.status },
    );
  }
  return result.stdout ?? '';
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    phase: 'tiktok-course-level-terminal-reactivation',
    confirmation: TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION,
    sequence: [
      'verify-clean-current-main',
      'read-exact-admission-work-fence-lock-terminal-dlq-evidence',
      'reactivate-one-exact-terminal-work-or-accept-exact-active-rerun',
      'verify-active-work-with-same-generation-and-fence',
      'delegate-to-merged-course-level-schema-and-reconciliation-operator',
      'require-zero-gap-idempotent-safe-closed-proof',
    ],
    safety: {
      planOnlyByDefault: true,
      newWorkOrGeneration: false,
      businessFactMutationByWrapper: false,
      queueSendByWrapper: false,
      scheduleActivation: false,
      production: false,
      retrySafeAfterReactivation: true,
    },
    command: `${TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION.envName}=${TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION.value} node scripts/tiktok-course-level-terminal-reactivation.mjs --execute`,
  }, null, 2)}\n`);
}

function parseArgs(args) {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === '--execute') return true;
  throw operatorError(
    'Unsupported TikTok course-level terminal recovery arguments',
    'TIKTOK_COURSE_LEVEL_TERMINAL_ARGUMENT_INVALID',
  );
}

async function readOptionalDevVars(path) {
  try {
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function resolveRepositoryFile(value) {
  const path = resolve(ROOT, requireText(value, 'config path'));
  if (!path.startsWith(`${ROOT}/`)) {
    throw operatorError(
      'TikTok terminal recovery config must stay inside the repository',
      'TIKTOK_COURSE_LEVEL_TERMINAL_CONFIG_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(actual, expected, label) {
  if (actual !== expected) {
    throw operatorError(
      `${label} must equal the exact reviewed confirmation`,
      'TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION_REQUIRED',
      { label },
    );
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokCourseLevelTerminalRecoveryOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
