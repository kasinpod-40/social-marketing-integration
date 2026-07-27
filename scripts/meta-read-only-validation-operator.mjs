import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preflightMetaCustomerConnection } from '../packages/application/src/use-cases/preflight-meta-customer-connections.js';
import { createMetaTokenConnectionRuntime } from '../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { sanitizeOperationalError } from '../packages/shared/src/errors/runtime-error.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_READ_ONLY_VALIDATION_CONFIRMATIONS,
  META_READ_ONLY_VALIDATION_CONTRACT_VERSION,
  META_READ_ONLY_VALIDATION_PHASES,
  assertMetaReadOnlyValidationConfirmation,
  expectedMetaReadOnlyIdentitySummary,
  loadMetaReadOnlyValidationTarget,
  parseMetaReadOnlyValidationArgs,
  requiredMetaReadOnlyEvidencePhases,
  resolveMetaReadOnlyValidationScope,
  summarizeMetaReadOnlyRequestEvents,
  validateMetaReadOnlyConnectionResult,
} from './lib/meta-read-only-validation-operator.js';

const EVIDENCE_ROOT = resolve(
  process.env.MKT_META_READ_ONLY_EVIDENCE_DIR ?? 'outputs/meta-read-only-validation',
);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    businessWrites: 0,
    queueMessages: 0,
    error: sanitizeOperationalError(error),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = parseMetaReadOnlyValidationArgs(process.argv.slice(2));
  if (mode.phase === 'plan' || mode.execute !== true) {
    printPlan(mode);
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertMetaReadOnlyValidationConfirmation(mode.phase, env);
  const target = loadMetaReadOnlyValidationTarget(env);
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  const result = await runPhase(mode.phase, env, target);
  console.log(JSON.stringify({
    ok: true,
    phase: mode.phase,
    evidenceRoot: EVIDENCE_ROOT,
    businessWrites: 0,
    queueMessages: 0,
    ...result,
  }, null, 2));
}

function printPlan(mode) {
  const requestedPhase = mode.phase === 'plan' ? null : mode.phase;
  console.log(JSON.stringify({
    ok: true,
    executed: false,
    requestedPhase,
    contractVersion: META_READ_ONLY_VALIDATION_CONTRACT_VERSION,
    phases: META_READ_ONLY_VALIDATION_PHASES,
    confirmations: META_READ_ONLY_VALIDATION_CONFIRMATIONS,
    evidenceRoot: EVIDENCE_ROOT,
    orderedTargets: [
      'facebook',
      'instagram',
      'meta-ads-chemistry-k2',
      'meta-ads-chemistry-k3',
    ],
    safety: {
      transport: 'GET_only',
      tokenInQuery: false,
      queueSend: false,
      d1Mutation: false,
      larkMutation: false,
      reportRead: false,
      scheduleActivation: false,
      workerDeployment: false,
      productionCutover: false,
    },
    note: requestedPhase
      ? `Preview only. Re-run with --phase=${requestedPhase} --execute and the exact phase confirmation.`
      : 'Plan only. No Provider, Git write, Queue, D1, Lark, Worker or schedule action was executed.',
  }, null, 2));
}

async function runPhase(phase, env, target) {
  if (phase === 'preflight') return runPreflight(env, target);
  if (phase === 'summary') return runSummary(target);
  return runProviderValidation(phase, env, target);
}

async function runPreflight(env, target) {
  assertRepositoryState();
  runCommand('npm', ['run', 'check']);
  runCommand('node', [
    '--test',
    'tests/application/meta-read-only-validation-operator.test.js',
    'tests/application/preflight-meta-customer-connections.test.js',
    'tests/connectors/meta-token-connection-adapters.test.js',
    'tests/connectors/meta-token-connection-runtime.test.js',
  ]);
  runCommand('npm', ['run', 'deploy:dry-run']);

  let providerRequests = 0;
  const runtime = createMetaTokenConnectionRuntime(env, {
    onRequest: () => { providerRequests += 1; },
  });
  if (!runtime.facebook || !runtime.instagram || !runtime.metaAds) {
    throw operatorError(
      'Meta read-only preflight requires Facebook, Instagram and Meta Ads adapters',
      'META_READ_ONLY_VALIDATION_RUNTIME_INCOMPLETE',
    );
  }
  if (providerRequests !== 0) {
    throw operatorError(
      'Meta configuration preflight unexpectedly called the Provider',
      'META_READ_ONLY_VALIDATION_PREFLIGHT_SIDE_EFFECT',
    );
  }

  const evidence = createEvidence({
    phase: 'preflight',
    target,
    details: {
      repositoryHead: readCommand('git', ['rev-parse', 'HEAD']).trim(),
      repositoryClean: true,
      adaptersConfigured: 3,
      providerRequests: 0,
      identitySummary: expectedMetaReadOnlyIdentitySummary(),
      verification: {
        repositoryCheck: 'passed',
        focusedTests: 'passed',
        deployDryRun: 'passed',
      },
    },
  });
  await saveEvidence('preflight', evidence);
  return { evidenceFile: evidencePath('preflight'), providerRequests: 0 };
}

async function runProviderValidation(phase, env, target) {
  await requireEvidenceChain(phase, target);
  const scope = resolveMetaReadOnlyValidationScope(phase);
  const requestEvents = [];
  const runtime = createMetaTokenConnectionRuntime(env, {
    onRequest: (event) => requestEvents.push(event),
  });
  const result = await preflightMetaCustomerConnection(runtime, scope.connectorKey, {
    sourceAccountKey: scope.sourceAccountKey,
  });
  const validated = validateMetaReadOnlyConnectionResult(result, scope.connectorKey);
  const requestSummary = summarizeMetaReadOnlyRequestEvents(requestEvents);
  if (requestSummary.requestAttempts === 0 || requestSummary.successfulRequests === 0) {
    throw operatorError(
      'Meta read-only validation did not complete a Provider GET request',
      'META_READ_ONLY_VALIDATION_REQUEST_MISSING',
      { phase },
    );
  }

  const evidence = createEvidence({
    phase,
    target,
    details: {
      connectorKey: scope.connectorKey,
      sourceAccountKey: scope.sourceAccountKey,
      result: validated,
      requests: requestSummary,
    },
  });
  await saveEvidence(phase, evidence);
  return {
    evidenceFile: evidencePath(phase),
    connectorKey: scope.connectorKey,
    sourceAccountKey: scope.sourceAccountKey,
    status: validated.status,
    requests: requestSummary,
  };
}

async function runSummary(target) {
  const evidence = await requireEvidenceChain('summary', target);
  const validations = evidence
    .filter((entry) => entry.phase !== 'preflight')
    .map((entry) => ({
      phase: entry.phase,
      connectorKey: entry.details?.connectorKey ?? null,
      sourceAccountKey: entry.details?.sourceAccountKey ?? null,
      status: entry.details?.result?.status ?? null,
      requestAttempts: entry.details?.requests?.requestAttempts ?? 0,
    }));
  const accepted = validations.length === 4
    && validations.every((entry) => entry.status === 'identity_validated');
  if (!accepted) {
    throw operatorError(
      'Meta read-only validation evidence is incomplete',
      'META_READ_ONLY_VALIDATION_EVIDENCE_INCOMPLETE',
      { validationCount: validations.length },
    );
  }

  const summary = createEvidence({
    phase: 'summary',
    target,
    details: {
      accepted: true,
      validationCount: validations.length,
      validations,
      nextGate: 'separate_d1_only_approval',
    },
  });
  await saveEvidence('summary', summary);
  return {
    evidenceFile: evidencePath('summary'),
    accepted: true,
    validationCount: validations.length,
    nextGate: 'separate_d1_only_approval',
  };
}

function createEvidence({ phase, target, details }) {
  const safeTarget = createSafeTarget(target);
  return Object.freeze({
    phase,
    status: 'passed',
    capturedAt: new Date().toISOString(),
    contractVersion: META_READ_ONLY_VALIDATION_CONTRACT_VERSION,
    targetFingerprint: createTargetFingerprint(target),
    target: safeTarget,
    details,
    mutationPerformed: false,
    businessWrites: 0,
    queueMessages: 0,
  });
}

async function requireEvidenceChain(phase, target) {
  const required = requiredMetaReadOnlyEvidencePhases(phase);
  const expectedTargetFingerprint = createTargetFingerprint(target);
  const evidence = [];
  for (const requiredPhase of required) {
    const value = JSON.parse(await readFile(evidencePath(requiredPhase), 'utf8'));
    if (value?.phase !== requiredPhase
      || value?.status !== 'passed'
      || value?.contractVersion !== META_READ_ONLY_VALIDATION_CONTRACT_VERSION
      || value?.targetFingerprint !== expectedTargetFingerprint
      || value?.mutationPerformed !== false
      || Number(value?.businessWrites) !== 0
      || Number(value?.queueMessages) !== 0) {
      throw operatorError(
        `Meta read-only validation evidence is invalid for phase ${requiredPhase}`,
        'META_READ_ONLY_VALIDATION_EVIDENCE_INVALID',
        { requiredPhase },
      );
    }
    evidence.push(value);
  }
  return evidence;
}

function createTargetFingerprint(target) {
  return createHash('sha256').update(JSON.stringify(createSafeTarget(target))).digest('hex');
}

function createSafeTarget(target) {
  return Object.freeze({
    contractVersion: target.contractVersion,
    environment: target.environment,
    customerProfile: target.customerProfile,
    customerKey: target.customerKey,
    apiVersion: target.apiVersion,
    metaAdAccountKeys: target.metaAdAccountKeys,
    executionFlagsEnabled: target.executionFlagsEnabled,
    schedulesEnabled: target.schedulesEnabled,
  });
}

function assertRepositoryState() {
  const status = readCommand('git', ['status', '--porcelain']).trim();
  if (status !== '') {
    throw operatorError(
      'Meta read-only validation requires a clean Git working tree',
      'META_READ_ONLY_VALIDATION_REPOSITORY_DIRTY',
    );
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(
      `Command failed: ${command} ${args.join(' ')}`,
      'META_READ_ONLY_VALIDATION_COMMAND_FAILED',
      { command, exitCode: result.status },
    );
  }
  return result;
}

function readCommand(command, args) {
  return runCommand(command, args).stdout;
}

async function saveEvidence(phase, evidence) {
  await writeFile(evidencePath(phase), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function evidencePath(phase) {
  return resolve(EVIDENCE_ROOT, `${phase}.json`);
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaReadOnlyValidationError';
  error.code = code;
  error.details = details;
  return error;
}
