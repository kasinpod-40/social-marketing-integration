#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  getReportPlatformContract,
} from '../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  assertReviewedRepositoryState,
  createCommandRunner,
  writePrivateJson,
} from './lib/report-runtime-closeout-reviewed-process.js';
import {
  assertReportRuntimeFinalizerEvidence,
} from './lib/report-runtime-closeout-operator.js';
import {
  META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  RETAINED_MULTICHANNEL_REPORT_HANDOFF_BUILDER_CONTRACT,
  RETAINED_MULTICHANNEL_REPORT_HANDOFF_OUTPUT,
  buildRetainedMultichannelReportHandoff,
} from './lib/retained-multichannel-report-handoff.js';

export const BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONFIRMATION =
  'BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
let stage = 'init';

export function parseRetainedHandoffBuilderArgs(argv = []) {
  const unknown = argv.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) throw terminalError(
    `Unsupported retained handoff builder arguments: ${unknown.join(', ')}`,
    'RETAINED_REPORT_HANDOFF_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export async function runRetainedHandoffBuilder(input = {}) {
  const env = input.env ?? process.env;
  const options = parseRetainedHandoffBuilderArgs(input.argv ?? []);
  if (!options.execute) return buildPlan();
  if (env.CONFIRM_BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF
    !== BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONFIRMATION) throw terminalError(
    'Retained handoff execution requires exact confirmation',
    'RETAINED_REPORT_HANDOFF_CONFIRMATION_REQUIRED',
  );

  const runner = input.runner ?? createCommandRunner({
    execFileAsync,
    cwd: repositoryRoot,
    baseEnv: process.env,
  });

  stage = 'repository-exact-main';
  const repository = input.repository ?? await assertReviewedRepositoryState(runner);

  stage = 'meta-remote-lock-release-authority';
  try {
    await runner.run('git', [
      'merge-base',
      '--is-ancestor',
      META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
      repository.head,
    ]);
  } catch {
    throw terminalError(
      'Merged Meta PR #421 lock-release authority is not an ancestor of current main',
      'RETAINED_REPORT_HANDOFF_META_AUTHORITY_NOT_ANCESTOR',
      { auditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD, repositoryHead: repository.head },
    );
  }

  stage = 'finalizer-exact-head';
  const finalizerPath = resolve(
    env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
      ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
  );
  const finalizer = input.finalizer ?? await readJson(finalizerPath, 'finalizer');
  assertReportRuntimeFinalizerEvidence(finalizer);

  stage = 'channel-readiness-exact-head';
  const readinessByPlatform = input.readinessByPlatform ?? {};
  for (const platformScope of REPORT_RUNTIME_REVIEWED_CHANNELS) {
    if (getReportPlatformContract(platformScope).sourceStatus === 'planned') continue;
    const path = readinessEvidencePath(env, platformScope);
    readinessByPlatform[platformScope] ??= await readJson(path, `${platformScope} readiness`);
  }

  stage = 'retained-handoff-validation';
  const built = buildRetainedMultichannelReportHandoff({
    repository,
    finalizer,
    readinessByPlatform,
    metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  });

  stage = 'private-sanitized-evidence';
  const outputPath = resolve(
    env.MKT_RETAINED_MULTICHANNEL_REPORT_HANDOFF_OUTPUT
      ?? RETAINED_MULTICHANNEL_REPORT_HANDOFF_OUTPUT,
  );
  await writePrivateJson(outputPath, built.handoff);

  return Object.freeze({
    ok: true,
    contractVersion: RETAINED_MULTICHANNEL_REPORT_HANDOFF_BUILDER_CONTRACT,
    repositoryHead: repository.head,
    metaRemoteLockReleased: true,
    metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
    liveMaterializationAuthorized: true,
    readyChannels: built.selection.ready.map((row) => row.platformScope),
    waiting: built.selection.waiting,
    readyCount: built.selection.readyCount,
    waitingCount: built.selection.waitingCount,
    outputPath,
    providerRequestCount: 0,
    remoteMutationCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    notificationAdmissionEnabled: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

function buildPlan() {
  return Object.freeze({
    ok: true,
    planOnly: true,
    contractVersion: RETAINED_MULTICHANNEL_REPORT_HANDOFF_BUILDER_CONTRACT,
    command: [
      `CONFIRM_BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF=${BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONFIRMATION}`,
      'node scripts/build-retained-multichannel-report-handoff.mjs --execute',
    ].join(' \\\n'),
    inputs: Object.freeze({
      finalizer: 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
      readiness: 'outputs/<platform>-report-remote-readiness/readiness-summary.json',
      metaRemoteLockReleaseAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
    }),
    output: RETAINED_MULTICHANNEL_REPORT_HANDOFF_OUTPUT,
    behavior: Object.freeze({
      exactCleanMainRequired: true,
      exactFinalizerHeadRequired: true,
      allNonPlannedReadinessRequired: true,
      plannedSourcesSkipped: true,
      handWrittenJsonAllowed: false,
    }),
    providerRequestCount: 0,
    remoteMutationCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

function readinessEvidencePath(env, platformScope) {
  const environmentName = `MKT_REPORT_${platformScope.toUpperCase()}_READINESS_EVIDENCE`;
  return resolve(
    env[environmentName]
      ?? `outputs/${platformScope}-report-remote-readiness/readiness-summary.json`,
  );
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw terminalError(
      `Unable to load ${label} evidence`,
      'RETAINED_REPORT_HANDOFF_EVIDENCE_LOAD_FAILED',
      { label, sourceCode: error?.code ?? null },
    );
  }
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'RetainedMultichannelReportHandoffTerminalError';
  error.code = code;
  error.details = details;
  return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await runRetainedHandoffBuilder({
      env: process.env,
      argv: process.argv.slice(2),
    }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      stage,
      code: error?.code ?? 'RETAINED_REPORT_HANDOFF_BUILD_FAILED',
      message: error?.message ?? 'Retained Multichannel Report handoff build failed',
      details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
      providerRequestCount: 0,
      remoteMutationCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      notificationAdmissionEnabled: false,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2));
    process.exitCode = 2;
  }
}
