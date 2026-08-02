#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessYouTubeReportLiveReadiness,
} from './lib/youtube-report-live-readiness-reviewed-audit.js';
import {
  YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  parseYouTubeReportRemoteCollectorArgs,
  sanitizeYouTubeRemoteEvidence,
} from './lib/youtube-report-remote-readiness-collector.js';

const repositoryRoot = resolve(process.cwd());
const internalCollectorPath = fileURLToPath(
  new URL('./youtube-report-remote-readiness-collector.mjs', import.meta.url),
);
const evidencePath = resolve(
  process.env.MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_EVIDENCE
    ?? 'outputs/youtube-report-remote-readiness/readiness-summary.json',
);

let stage = 'init';
let temporaryDirectory = null;

try {
  const options = parseYouTubeReportRemoteCollectorArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeReviewedCollector();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'YOUTUBE_REPORT_REMOTE_REVIEWED_TERMINAL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeYouTubeRemoteEvidence(error?.details ?? {}),
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'youtube_report_remote_readiness_reviewed_terminal_v1',
    command: `CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=${YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION} MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs --execute`,
    repositoryGate: {
      branch: 'main',
      clean: true,
      headEqualsReviewedHead: true,
    },
    internalCollectorDirectExecutionBlocked: true,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeReviewedCollector() {
  stage = 'confirmation';
  assertPublicConfirmation(process.env);

  stage = 'repository-read-only-preflight';
  const reviewedHead = requireCommitSha(
    process.env.MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD,
    'MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD',
  );
  const repository = collectRepositoryState(reviewedHead);
  assertReviewedRepository(repository);

  stage = 'run-internal-read-only-collector';
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'youtube-report-readiness-'));
  const internalEvidencePath = resolve(temporaryDirectory, 'internal-summary.json');
  const child = spawnSync(process.execPath, [internalCollectorPath, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MKT_YOUTUBE_REPORT_REMOTE_INTERNAL_HANDOFF:
        YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
      MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_EVIDENCE: internalEvidencePath,
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.error) throw terminalError(
    'Unable to run the internal YouTube read-only collector',
    'YOUTUBE_REPORT_REMOTE_INTERNAL_COLLECTOR_START_FAILED',
  );
  if (![0, 2].includes(child.status)) throw terminalError(
    'Internal YouTube read-only collector failed before producing assessable evidence',
    'YOUTUBE_REPORT_REMOTE_INTERNAL_COLLECTOR_FAILED',
    { status: child.status, stderrPresent: String(child.stderr ?? '').trim() !== '' },
  );
  const internalSummary = parseJsonObject(child.stdout);
  if (!internalSummary.evidence || typeof internalSummary.evidence !== 'object') throw terminalError(
    'Internal YouTube collector output did not contain evidence',
    'YOUTUBE_REPORT_REMOTE_INTERNAL_EVIDENCE_MISSING',
  );

  stage = 'assess-reviewed-readiness';
  const evidence = Object.freeze({
    ...internalSummary.evidence,
    repository,
  });
  const assessment = assessYouTubeReportLiveReadiness(evidence);
  const summary = sanitizeYouTubeRemoteEvidence({
    ok: assessment.readyForLive,
    contractVersion: 'youtube_report_remote_readiness_reviewed_terminal_v1',
    evidence,
    assessment,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  });

  stage = 'write-private-reviewed-evidence';
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  await chmod(evidencePath, 0o600);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (!assessment.readyForLive) process.exitCode = 2;
}

function assertPublicConfirmation(env) {
  if (env.CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR
    !== YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION) {
    throw terminalError(
      `Execution requires CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=${YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION}`,
      'YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION_REQUIRED',
    );
  }
}

function collectRepositoryState(reviewedHead) {
  return Object.freeze({
    branch: runGit(['branch', '--show-current']),
    head: runGit(['rev-parse', 'HEAD']),
    reviewedHead,
    clean: runGit(['status', '--porcelain', '--untracked-files=all'], false).trim() === '',
  });
}

function assertReviewedRepository(repository) {
  if (repository.branch !== 'main') throw terminalError(
    'YouTube Remote readiness must run from main',
    'YOUTUBE_REPORT_REMOTE_REPOSITORY_BRANCH_INVALID',
    { observed: repository.branch },
  );
  if (!repository.clean) throw terminalError(
    'YouTube Remote readiness requires a clean repository',
    'YOUTUBE_REPORT_REMOTE_REPOSITORY_DIRTY',
  );
  if (repository.head !== repository.reviewedHead) throw terminalError(
    'YouTube Remote readiness Head does not match the reviewed Head',
    'YOUTUBE_REPORT_REMOTE_REPOSITORY_HEAD_NOT_REVIEWED',
    { head: repository.head, reviewedHead: repository.reviewedHead },
  );
}

function runGit(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw terminalError(
    `Unable to read repository state: git ${args.join(' ')}`,
    'YOUTUBE_REPORT_REMOTE_REPOSITORY_READ_FAILED',
    { status: result.status },
  );
  const value = String(result.stdout ?? '');
  return trim ? value.trim() : value;
}

function parseJsonObject(value) {
  const text = String(value ?? '').trim();
  const start = text.indexOf('{');
  if (start < 0) throw terminalError(
    'Internal YouTube collector output did not contain JSON',
    'YOUTUBE_REPORT_REMOTE_INTERNAL_JSON_INVALID',
  );
  try {
    const parsed = JSON.parse(text.slice(start));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError();
    return parsed;
  } catch {
    throw terminalError(
      'Internal YouTube collector output contained invalid JSON',
      'YOUTUBE_REPORT_REMOTE_INTERNAL_JSON_INVALID',
    );
  }
}

function requireCommitSha(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{40}$/u.test(text)) throw terminalError(
    `${field} must be an exact 40-character lowercase commit SHA`,
    'YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD_REQUIRED',
  );
  return text;
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeReportRemoteReviewedTerminalError';
  error.code = code;
  error.details = details;
  return error;
}
