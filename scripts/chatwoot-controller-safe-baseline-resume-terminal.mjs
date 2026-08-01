#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import {
  readChatwootExecutionFlags,
} from './lib/chatwoot-controller-evidence-arbitration.js';
import {
  selectChatwootControllerSafeBaselineEvidence,
} from './lib/chatwoot-controller-safe-baseline-resume.js';
import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
  assertChatwootFinalUatControllerResume,
  buildChatwootFinalUatSnapshotSql,
  normalizeChatwootFinalUatSnapshot,
  stableJson,
} from './lib/chatwoot-final-30d-daily-uat.js';
import {
  validateRetainedSession,
} from './lib/chatwoot-initial-terminal-failure-recovery.js';
import {
  parseChatwootWranglerJsonOutput,
} from './lib/chatwoot-final-source-config-recovery.js';
import {
  loadChatwootSafeBaselinePriorAttempt,
} from './lib/chatwoot-safe-baseline-prior-attempt.js';
import { readDevVars } from './lib/dev-vars.js';

const WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_WRAPPER_HEAD';
const ARBITRATION_HEAD_ENV = 'MKT_CHATWOOT_EVIDENCE_ARBITRATION_WRAPPER_HEAD';
const PRIOR_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_HEAD';
const CONFIRMATION_ENV = 'CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY';
const CONFIRMATION_VALUE = 'RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY';
const CHILD = 'scripts/chatwoot-controller-evidence-arbitration-terminal.mjs';
const WORKER_NAME = 'social-mkt-sync-worker';
const DATABASE_NAME = 'social-mkt-state-dev';
const SOURCE_CONFIG = 'wrangler.sync.jsonc';
const FINAL_UAT_OUTPUT = 'chatwoot-final-30d-daily-uat';
const RECOVERY_OUTPUT = 'chatwoot-controller-safe-baseline-resume';
const SUCCESS_MARKER = 'CHATWOOT_SAFE_BASELINE_RESUME_COMPLETED_SAFE';
const CONTRACT_VERSION = 'chatwoot_controller_safe_baseline_resume_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPECTED_ACTIVE_FLAGS = Object.freeze([...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort());

const repositoryRoot = resolve(process.cwd());
let stage = 'init';
let repository = null;
let assets = null;
let runtimeEnv = null;
let selection = null;
let priorAttempt = null;
let boundary = null;
let evidenceDirectory = null;
let promotionAttempted = false;
let childStarted = false;
let workerDeploymentCount = 0;
let primaryError = null;
let safeRestoreResult = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    stage = 'confirm-chatwoot-safe-baseline-resume';
    assertConfirmation(process.env);

    stage = 'verify-chatwoot-safe-baseline-wrapper';
    repository = verifyWrapperCheckout(process.env);

    stage = 'load-chatwoot-safe-baseline-runtime';
    assets = await verifyLocalAssets();
    const fileEnv = await readDevVars(assets.devVars);
    runtimeEnv = Object.freeze({ ...fileEnv, ...process.env });

    stage = 'read-current-chatwoot-safe-baseline';
    const current = readCurrentWorker(runtimeEnv, assets.sourceConfig);
    if (current.enabledFlags.length !== 0) {
      throw operatorError(
        'Current Worker must have every execution flag false before safe-baseline resume',
        'CHATWOOT_SAFE_BASELINE_WORKER_FLAGS_INVALID',
        { enabledFlags: current.enabledFlags },
      );
    }

    const priorHeadValue = String(runtimeEnv[PRIOR_HEAD_ENV] ?? '').trim();
    if (priorHeadValue) {
      stage = 'verify-chatwoot-safe-baseline-prior-selection-handoff';
      const priorHead = requireSha(priorHeadValue, PRIOR_HEAD_ENV);
      if (priorHead === repository.currentHead
          || !gitSuccess(['merge-base', '--is-ancestor', priorHead, repository.currentHead])) {
        throw operatorError(
          'Prior Chatwoot safe-baseline attempt must be a strict ancestor of the current wrapper Head',
          'CHATWOOT_SAFE_BASELINE_PRIOR_HEAD_INVALID',
          { priorHead, currentHead: repository.currentHead },
        );
      }
      priorAttempt = await loadChatwootSafeBaselinePriorAttempt({
        directory: join(assets.outputs, RECOVERY_OUTPUT, priorHead),
        priorHead,
        currentWorker: current,
      });
    }

    stage = 'select-chatwoot-safe-baseline-evidence';
    const candidates = await loadControllerEvidence(assets.outputs, repository.currentHead);
    selection = selectChatwootControllerSafeBaselineEvidence(
      candidates,
      current.activeVersion,
      current.enabledFlags,
      priorAttempt ? {
        sessionFingerprint: priorAttempt.retainedSessionFingerprint,
        baselineVersionFingerprint: priorAttempt.baselineVersionFingerprint,
        activeVersionFingerprint: priorAttempt.retainedActiveVersionFingerprint,
      } : null,
    );

    stage = 'verify-chatwoot-retained-active-version';
    const retainedActiveFlags = readVersionFlags(
      runtimeEnv,
      assets.sourceConfig,
      selection.activeVersion,
    );
    if (stableJson(retainedActiveFlags) !== stableJson(EXPECTED_ACTIVE_FLAGS)) {
      throw operatorError(
        'Retained Chatwoot active version does not contain the exact Final UAT flag window',
        'CHATWOOT_SAFE_BASELINE_RETAINED_ACTIVE_INVALID',
        { enabledFlags: retainedActiveFlags },
      );
    }

    stage = 'verify-chatwoot-safe-baseline-d1-boundary';
    const snapshot = readSnapshot(
      runtimeEnv,
      assets.sourceConfig,
      selection.session.initial,
    );
    boundary = assertChatwootFinalUatControllerResume(snapshot, selection.session.initial);
    if (boundary.boundary !== 'queue_retry_exhausted_terminal_v1'
        || boundary.replaceActiveDeployment !== true
        || snapshot.activeLockCount !== 0) {
      throw operatorError(
        'Safe-baseline resume requires the exact Queue retry-exhausted controller boundary',
        'CHATWOOT_SAFE_BASELINE_BOUNDARY_INVALID',
        {
          boundary: boundary.boundary,
          replaceActiveDeployment: boundary.replaceActiveDeployment,
          activeLockCount: snapshot.activeLockCount,
          lifecycle: boundary.lifecycle,
        },
      );
    }

    stage = 'prepare-chatwoot-safe-baseline-evidence';
    evidenceDirectory = join(assets.outputs, RECOVERY_OUTPUT, repository.currentHead);
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    await writePrivateJson(join(evidenceDirectory, '01-active-window.attempt.json'), {
      contractVersion: CONTRACT_VERSION,
      repositoryHead: repository.currentHead,
      retainedSessionFingerprint: selection.sessionFingerprint,
      baselineVersionFingerprint: sha256(selection.baselineVersion),
      retainedActiveVersionFingerprint: sha256(selection.activeVersion),
      controllerBoundary: boundary.boundary,
      candidateCount: selection.candidateCount,
      selectedBy: selection.selectedBy,
      ...(priorAttempt ? {
        priorAttemptHead: priorAttempt.priorHead,
        priorAttemptValidated: true,
      } : {}),
      secondInitialAdmission: false,
      queueAction: false,
      d1Mutation: false,
      larkMutation: false,
      scheduleEnabled: false,
      webhookEnabled: false,
      production: false,
    });

    stage = 'promote-chatwoot-retained-active-version';
    promotionAttempted = true;
    promoteVersion(
      runtimeEnv,
      assets.sourceConfig,
      selection.activeVersion,
      repository.currentHead,
      'resume-active',
    );
    workerDeploymentCount += 1;
    assertWorkerState(
      runtimeEnv,
      assets.sourceConfig,
      selection.activeVersion,
      EXPECTED_ACTIVE_FLAGS,
    );

    stage = 'run-chatwoot-existing-arbitration-authority';
    childStarted = true;
    const child = spawnSync(
      process.execPath,
      [join(repositoryRoot, CHILD), '--execute'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          [ARBITRATION_HEAD_ENV]: repository.currentHead,
          DEV_VARS_FILE: assets.devVars,
        },
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: 'inherit',
      },
    );
    if (child.error) throw child.error;
    if (child.status !== 0) {
      throw operatorError(
        'Existing Chatwoot evidence arbitration authority did not complete',
        'CHATWOOT_SAFE_BASELINE_CHILD_FAILED',
        { exitCode: child.status ?? null },
      );
    }

    stage = 'verify-chatwoot-safe-baseline-completion';
    const finalWorker = readCurrentWorker(runtimeEnv, assets.sourceConfig);
    if (finalWorker.enabledFlags.length !== 0) {
      throw operatorError(
        'Chatwoot child completed without restoring every execution flag false',
        'CHATWOOT_SAFE_BASELINE_FINAL_WORKER_INVALID',
        { enabledFlags: finalWorker.enabledFlags },
      );
    }
  }
} catch (error) {
  primaryError = error;
} finally {
  if (promotionAttempted && selection && runtimeEnv && assets) {
    try {
      safeRestoreResult = await ensureSafeRestore();
    } catch (error) {
      if (primaryError) primaryError.restoreError = error;
      else primaryError = error;
    }
  }
}

if (primaryError) {
  const failure = {
    ok: false,
    stage,
    code: primaryError?.code ?? 'CHATWOOT_SAFE_BASELINE_RESUME_FAILED',
    message: primaryError instanceof Error ? primaryError.message : String(primaryError),
    details: scrub(primaryError?.details ?? {}),
    safeRestore: primaryError?.restoreError
      ? 'FAILED_REVIEW_REQUIRED'
      : safeRestoreResult?.restoredAllFlagsFalse
        ? 'VERIFIED_ALL_FLAGS_FALSE'
        : childStarted
          ? 'OWNED_BY_INNER_OPERATOR_AFTER_CHILD_START'
          : promotionAttempted
            ? 'ATTEMPTED'
            : 'NOT_REQUIRED_BEFORE_PROMOTION',
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
  };
  if (!childStarted) {
    Object.assign(failure, {
      providerRequests: 0,
      queueActions: 0,
      remoteD1Mutations: 0,
      remoteLarkMutations: 0,
      incidentClosureActions: 0,
      workerDeployments: workerDeploymentCount,
    });
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} else if (selection) {
  const final = {
    ok: true,
    marker: SUCCESS_MARKER,
    repositoryHead: repository.currentHead,
    candidateCount: selection.candidateCount,
    selectedBy: selection.selectedBy,
    priorAttemptHead: priorAttempt?.priorHead ?? null,
    controllerBoundary: boundary.boundary,
    retainedEvidenceMutation: false,
    secondInitialAdmission: false,
    restoredAllFlagsFalse: true,
    workerDeploymentsOwnedByWrapper: workerDeploymentCount,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
  };
  await writePrivateJson(join(evidenceDirectory, '03-summary.json'), final);
  process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
}

function parseArgs(args) {
  const unknown = args.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) {
    throw operatorError(
      'Chatwoot safe-baseline resume accepts only --execute',
      'CHATWOOT_SAFE_BASELINE_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: CONTRACT_VERSION,
    wrapperHeadEnv: WRAPPER_HEAD_ENV,
    priorAttemptHeadEnv: PRIOR_HEAD_ENV,
    confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
    selectionAuthority:
      'current_safe_baseline_version_or_verified_prior_safe_baseline_attempt',
    requiredBoundary: 'queue_retry_exhausted_terminal_v1',
    activeWindowSource: 'retained_reviewed_active_version',
    child: CHILD,
    retainedEvidenceMutation: false,
    secondInitialAdmissionAllowed: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

function assertConfirmation(env) {
  if (env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw operatorError(
      `Chatwoot safe-baseline resume requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'CHATWOOT_SAFE_BASELINE_CONFIRMATION_REQUIRED',
      { envName: CONFIRMATION_ENV },
    );
  }
}

function verifyWrapperCheckout(env) {
  const expectedHead = requireSha(env[WRAPPER_HEAD_ENV], WRAPPER_HEAD_ENV);
  const currentHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current'], false);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (currentHead !== expectedHead || dirty.trim() !== '') {
    throw operatorError(
      'Chatwoot safe-baseline resume requires the exact clean reviewed wrapper commit',
      'CHATWOOT_SAFE_BASELINE_WRAPPER_CHECKOUT_INVALID',
      {
        expectedHead,
        currentHead,
        originMain,
        branch: branch || '(detached)',
        clean: dirty.trim() === '',
      },
    );
  }
  if (!gitSuccess(['merge-base', '--is-ancestor', currentHead, originMain])) {
    throw operatorError(
      'Reviewed Chatwoot safe-baseline wrapper is not contained in current origin/main history',
      'CHATWOOT_SAFE_BASELINE_WRAPPER_ANCESTRY_INVALID',
      { currentHead, originMain },
    );
  }
  const conflicts = Object.keys(env).filter(
    (key) => /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key),
  );
  if (conflicts.length > 0) {
    throw operatorError(
      'Chatwoot safe-baseline resume refuses caller-provided Git config overrides',
      'CHATWOOT_SAFE_BASELINE_GIT_CONFIG_ENV_INVALID',
      { conflicts: conflicts.sort() },
    );
  }
  return Object.freeze({ currentHead, originMain, branch: branch || '(detached)' });
}

async function verifyLocalAssets() {
  const outputs = join(repositoryRoot, 'outputs');
  const devVars = join(repositoryRoot, '.dev.vars');
  const nodeModules = join(repositoryRoot, 'node_modules');
  const sourceConfig = join(repositoryRoot, SOURCE_CONFIG);
  await assertDirectory(outputs, 'outputs');
  await assertPrivateRegularFile(devVars, '.dev.vars');
  await assertDirectory(nodeModules, 'node_modules');
  await assertRegularFile(sourceConfig, SOURCE_CONFIG);
  await assertDirectory(join(outputs, FINAL_UAT_OUTPUT), FINAL_UAT_OUTPUT);
  return Object.freeze({ outputs, devVars, nodeModules, sourceConfig });
}

async function loadControllerEvidence(outputs, currentHead) {
  const root = join(outputs, FINAL_UAT_OUTPUT);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === currentHead) continue;
    const directory = join(root, entry.name);
    const required = [
      'session.json',
      'read-only-preflight.json',
      'active-deployment.json',
      'initial-send.attempt.json',
    ];
    if (!(await Promise.all(required.map((name) => isRegularFile(join(directory, name)))))
      .every(Boolean)) continue;
    if (await isRegularFile(join(directory, 'summary.json'))
        || await isRegularFile(join(directory, 'safe-restore.json'))) continue;

    const session = validateRetainedSession(await readJson(join(directory, 'session.json')));
    const attempt = await readJson(join(directory, 'initial-send.attempt.json'));
    if (attempt.operationId !== session.initial.operationId
        || attempt.workKey !== session.initial.workKey
        || attempt.generation !== session.initial.generation) continue;
    const preflight = unwrapEvidence(await readJson(join(directory, 'read-only-preflight.json')));
    const deployment = unwrapEvidence(await readJson(join(directory, 'active-deployment.json')));
    candidates.push({
      directory,
      directoryName: entry.name,
      session,
      sessionFingerprint: session.sessionFingerprint,
      baselineVersion: preflight.activeVersion,
      activeVersion: deployment.activeVersion,
      baseline: preflight.baseline,
      modifiedAt: (await stat(join(directory, 'initial-send.attempt.json'))).mtimeMs,
    });
  }
  return candidates;
}

function readCurrentWorker(env, sourceConfig) {
  const status = parseChatwootWranglerJsonOutput(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--json',
  ], buildWranglerOAuthEnvironment(env)), 'Chatwoot Worker deployment status');
  const item = Array.isArray(status) ? status[0] : status;
  const active = (item?.versions ?? []).filter(
    (version) => Number(version?.percentage) === 100,
  );
  if (active.length !== 1) {
    throw operatorError(
      'Chatwoot Worker does not have exactly one active version',
      'CHATWOOT_SAFE_BASELINE_WORKER_STATE_INVALID',
      { activeVersionCount: active.length },
    );
  }
  const activeVersion = requireVersionId(
    active[0]?.version_id ?? active[0]?.id,
    'current active Worker version',
  );
  return Object.freeze({
    activeVersion,
    enabledFlags: readVersionFlags(env, sourceConfig, activeVersion),
  });
}

function readVersionFlags(env, sourceConfig, version) {
  const view = parseChatwootWranglerJsonOutput(runText('npx', [
    'wrangler', 'versions', 'view', requireVersionId(version, 'Worker version'),
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--json',
  ], buildWranglerOAuthEnvironment(env)), 'Chatwoot Worker version view');
  return readChatwootExecutionFlags(view);
}

function assertWorkerState(env, sourceConfig, expectedVersion, expectedFlags) {
  const current = readCurrentWorker(env, sourceConfig);
  if (current.activeVersion !== expectedVersion
      || stableJson(current.enabledFlags) !== stableJson(expectedFlags)) {
    throw operatorError(
      'Chatwoot Worker state changed during safe-baseline resume',
      'CHATWOOT_SAFE_BASELINE_WORKER_STATE_INVALID',
      {
        expectedVersionFingerprint: sha256(expectedVersion),
        observedVersionFingerprint: sha256(current.activeVersion),
        expectedFlags,
        observedFlags: current.enabledFlags,
      },
    );
  }
  return current;
}

function readSnapshot(env, sourceConfig, operation) {
  const output = runText('npx', [
    'wrangler', 'd1', 'execute', DATABASE_NAME,
    '--remote', '--json',
    '--config', sourceConfig,
    '--command', buildChatwootFinalUatSnapshotSql(operation),
  ], buildWranglerOAuthEnvironment(env));
  const parsed = parseChatwootWranglerJsonOutput(output, 'Chatwoot exact D1 boundary');
  const row = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) {
    throw operatorError(
      'Chatwoot exact D1 boundary returned no row',
      'CHATWOOT_SAFE_BASELINE_D1_EMPTY',
    );
  }
  return normalizeChatwootFinalUatSnapshot(row);
}

function promoteVersion(env, sourceConfig, version, head, mode) {
  const result = spawnSync('npx', [
    'wrangler', 'versions', 'deploy', `${requireVersionId(version, 'promoted version')}@100%`,
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--message', `${CONTRACT_VERSION} mode=${mode} git=${head}`,
    '-y',
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, ...buildWranglerOAuthEnvironment(env) },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw operatorError(
      'Chatwoot Worker version promotion failed',
      'CHATWOOT_SAFE_BASELINE_VERSION_PROMOTION_FAILED',
      {
        mode,
        exitCode: result.status ?? null,
        spawnErrorCode: result.error?.code ?? null,
        stderrFingerprint: sha256(String(result.stderr ?? '')),
      },
    );
  }
}

async function ensureSafeRestore() {
  stage = primaryError ? stage : 'verify-chatwoot-safe-baseline-final-restore';
  const current = readCurrentWorker(runtimeEnv, assets.sourceConfig);
  if (current.enabledFlags.length === 0) {
    const result = Object.freeze({
      restoredAllFlagsFalse: true,
      restoreDeployment: false,
      finalVersionFingerprint: sha256(current.activeVersion),
    });
    await writeSafeRestoreEvidence(result);
    return result;
  }
  if (stableJson(current.enabledFlags) !== stableJson(EXPECTED_ACTIVE_FLAGS)) {
    throw operatorError(
      'Current Worker contains flags outside the exact Chatwoot active window',
      'CHATWOOT_SAFE_BASELINE_RESTORE_REVIEW_REQUIRED',
      { enabledFlags: current.enabledFlags },
    );
  }

  const allowedActiveVersions = new Set([selection.activeVersion]);
  const replacement = await readCurrentHeadReplacementVersion();
  if (replacement) allowedActiveVersions.add(replacement);
  if (!allowedActiveVersions.has(current.activeVersion)) {
    throw operatorError(
      'Unknown active Worker version blocks automatic Chatwoot safe restore',
      'CHATWOOT_SAFE_BASELINE_RESTORE_REVIEW_REQUIRED',
      {
        observedVersionFingerprint: sha256(current.activeVersion),
        knownActiveVersionCount: allowedActiveVersions.size,
      },
    );
  }

  promoteVersion(
    runtimeEnv,
    assets.sourceConfig,
    selection.baselineVersion,
    repository.currentHead,
    'safe-restore',
  );
  workerDeploymentCount += 1;
  assertWorkerState(runtimeEnv, assets.sourceConfig, selection.baselineVersion, []);
  const result = Object.freeze({
    restoredAllFlagsFalse: true,
    restoreDeployment: true,
    finalVersionFingerprint: sha256(selection.baselineVersion),
  });
  await writeSafeRestoreEvidence(result);
  return result;
}

async function readCurrentHeadReplacementVersion() {
  const path = join(
    assets.outputs,
    FINAL_UAT_OUTPUT,
    repository.currentHead,
    'active-deployment.json',
  );
  if (!await isRegularFile(path)) return null;
  const evidence = unwrapEvidence(await readJson(path));
  try {
    return requireVersionId(evidence.activeVersion, 'current-head active version');
  } catch {
    return null;
  }
}

async function writeSafeRestoreEvidence(result) {
  if (!evidenceDirectory) return;
  await writePrivateJson(join(evidenceDirectory, '02-safe-restore.json'), {
    contractVersion: CONTRACT_VERSION,
    repositoryHead: repository.currentHead,
    retainedSessionFingerprint: selection.sessionFingerprint,
    ...result,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw operatorError(
      'Chatwoot retained evidence is missing or invalid',
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
      { fileName: relative(repositoryRoot, path), errorCode: cause?.code ?? 'JSON_PARSE_FAILED' },
    );
  }
}

function unwrapEvidence(value) {
  return value?.data && typeof value.data === 'object' ? value.data : value;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await import('node:fs/promises').then(({ writeFile }) => writeFile(
    temporary,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  ));
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function assertDirectory(path, field) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    // normalized below
  }
  throw operatorError(
    `Required local ${field} directory is missing`,
    'CHATWOOT_SAFE_BASELINE_LOCAL_ASSET_MISSING',
    { field },
  );
}

async function assertRegularFile(path, field) {
  try {
    if ((await stat(path)).isFile()) return;
  } catch {
    // normalized below
  }
  throw operatorError(
    `Required local ${field} file is missing`,
    'CHATWOOT_SAFE_BASELINE_LOCAL_ASSET_MISSING',
    { field },
  );
}

async function assertPrivateRegularFile(path, field) {
  try {
    const info = await stat(path);
    if (info.isFile() && (info.mode & 0o077) === 0) return;
  } catch {
    // normalized below
  }
  throw operatorError(
    `Required local ${field} must be a private regular file`,
    'CHATWOOT_SAFE_BASELINE_LOCAL_PRIVATE_FILE_INVALID',
    { field },
  );
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    throw cause;
  }
}

function requireSha(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw operatorError(
      `${field} must be an exact 40-character Git SHA`,
      'CHATWOOT_SAFE_BASELINE_HEAD_ENV_INVALID',
      { field },
    );
  }
  return text;
}

function requireVersionId(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(text)) {
    throw operatorError(
      `${field} is invalid`,
      'CHATWOOT_SAFE_BASELINE_VERSION_INVALID',
      { field },
    );
  }
  return text;
}

function gitText(args, required = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && required) {
    throw operatorError(
      `Git read failed: git ${args.join(' ')}`,
      'CHATWOOT_SAFE_BASELINE_GIT_READ_FAILED',
      { exitCode: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitSuccess(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return !result.error && result.status === 0;
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw operatorError(
      `Command failed: ${command} ${args.join(' ')}`,
      'CHATWOOT_SAFE_BASELINE_COMMAND_FAILED',
      {
        command,
        exitCode: result.status ?? null,
        spawnErrorCode: result.error?.code ?? null,
        stderrFingerprint: sha256(String(result.stderr ?? '')),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|password|cookie|tableId|accountId|queueId|versionId/iu.test(key))
    .map(([key, nested]) => [key, scrub(nested)]));
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeBaselineResumeError';
  error.code = code;
  error.details = details;
  return error;
}
