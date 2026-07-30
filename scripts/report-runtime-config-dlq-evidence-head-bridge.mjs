#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT,
  buildReportRuntimeConfigDlqRetryStateSql,
} from './lib/report-runtime-config-dlq-recovery.js';
import {
  REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION,
  REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION,
  REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD,
  assertReportRuntimeConfigDlqEvidenceHeadBridgeConfirmation,
  assertReportRuntimeConfigDlqRetryAttemptForHeadBridge,
  buildReportRuntimeConfigDlqBridgedRetryAttempt,
} from './lib/report-runtime-config-dlq-evidence-head-bridge.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR
    ?? 'outputs/report-runtime-window-repair/3d-refresh',
);
const attemptPath = join(outputRoot, 'config-dlq-retry-send.attempt.json');
const backupPath = join(outputRoot, 'config-dlq-retry-send.attempt.pre-head-bridge.json');
const summaryPath = join(outputRoot, 'config-dlq-evidence-head-bridge-summary.json');
let currentStage = 'init';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeDetails(error?.details ?? {}),
    remoteWorkerDeploymentAttempted: false,
    queueMessageSent: false,
    remoteD1Mutated: false,
    larkMutated: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  assertReportRuntimeConfigDlqEvidenceHeadBridgeConfirmation(process.env);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  currentStage = 'verify-clean-current-main-and-source-ancestry';
  const repository = await assertRepositoryState();
  await assertSourceHeadAncestor(repository.head);

  currentStage = 'verify-current-payload-readback-fix';
  const retrySql = buildReportRuntimeConfigDlqRetryStateSql(Date.now());
  if (!/SELECT payload_json FROM report_materializations/u.test(retrySql)
    || !/AS payload_json/u.test(retrySql)) {
    throw bridgeFailure(
      'Current main does not contain the reviewed Report payload_json retry readback',
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_FIX_MISSING',
    );
  }

  currentStage = 'read-exact-retry-attempt';
  const attemptBytes = await readRequiredRegularFile(attemptPath);
  const attempt = parseJson(attemptBytes, 'retry attempt');
  const currentAttemptSha256 = sha256(attemptBytes);
  const alreadyBridged = attempt.repositoryHead === repository.head;

  let originalBytes;
  let originalSha256;
  if (alreadyBridged) {
    originalBytes = await readRequiredRegularFile(backupPath);
    originalSha256 = sha256(originalBytes);
  } else {
    originalBytes = attemptBytes;
    originalSha256 = currentAttemptSha256;
  }

  const validation = assertReportRuntimeConfigDlqRetryAttemptForHeadBridge(attempt, {
    currentHead: repository.head,
    reportId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId,
    dlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
    originalSha256,
  });

  let backupCreated = false;
  let bridgedAttempt = attempt;
  if (!validation.alreadyBridged) {
    currentStage = 'backup-original-retry-attempt';
    backupCreated = await ensureExactBackup(backupPath, originalBytes);

    currentStage = 'write-atomic-bridged-retry-attempt';
    bridgedAttempt = buildReportRuntimeConfigDlqBridgedRetryAttempt(attempt, {
      currentHead: repository.head,
      reportId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId,
      dlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
      originalSha256,
      bridgedAt: new Date().toISOString(),
    });
    await writePrivateJsonAtomic(attemptPath, bridgedAttempt);
  }

  currentStage = 'verify-bridged-attempt-readback';
  const readbackBytes = await readRequiredRegularFile(attemptPath);
  const readback = parseJson(readbackBytes, 'bridged retry attempt');
  assertReportRuntimeConfigDlqRetryAttemptForHeadBridge(readback, {
    currentHead: repository.head,
    reportId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId,
    dlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
    originalSha256,
  });
  const backupReadback = await readRequiredRegularFile(backupPath);
  if (sha256(backupReadback) !== originalSha256) {
    throw bridgeFailure(
      'Report retry attempt backup differs from the exact original evidence',
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_BACKUP_MISMATCH',
    );
  }

  currentStage = 'write-bridge-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION,
    decision: 'EXACT_REPORT_CONFIG_DLQ_RETRY_HEAD_BRIDGED',
    repository,
    evidence: Object.freeze({
      reportId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId,
      dlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
      sourceHead: REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD,
      targetHead: repository.head,
      originalSha256,
      bridgedSha256: sha256(readbackBytes),
      backupFile: relative(repositoryRoot, backupPath),
      backupCreated,
      verificationOnly: validation.alreadyBridged,
    }),
    safety: Object.freeze({
      remoteWorkerDeploymentAttempted: false,
      queueMessageSent: false,
      remoteD1Mutated: false,
      larkMutated: false,
      providerCalls: 0,
      scheduleChanged: false,
      production: false,
    }),
  });
  await writePrivateJsonAtomic(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function assertRepositoryState() {
  await run('git', ['fetch', 'origin', 'main', '--quiet']);
  const [branch, head, originMainHead, dirty] = await Promise.all([
    runText('git', ['branch', '--show-current']),
    runText('git', ['rev-parse', 'HEAD']),
    runText('git', ['rev-parse', 'origin/main']),
    runText('git', ['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  if (branch !== 'main' || head !== originMainHead || dirty.trim() !== '') {
    throw bridgeFailure(
      'Report retry evidence bridge requires a clean current main equal to origin/main',
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_REPOSITORY_INVALID',
      { branch, head, originMainHead, clean: dirty.trim() === '' },
    );
  }
  return Object.freeze({ branch, head, originMainHead, clean: true });
}

async function assertSourceHeadAncestor(currentHead) {
  try {
    await run('git', ['merge-base', '--is-ancestor', REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD, currentHead]);
  } catch {
    throw bridgeFailure(
      'Current main is not a descendant of the exact Report retry source head',
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_ANCESTRY_INVALID',
      { sourceHead: REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD, currentHead },
    );
  }
}

async function ensureExactBackup(path, bytes) {
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    await chmod(path, 0o600);
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readRequiredRegularFile(path);
    if (!existing.equals(bytes)) {
      throw bridgeFailure(
        'Existing Report retry attempt backup differs from the exact original evidence',
        'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_BACKUP_COLLISION',
      );
    }
    return false;
  }
}

async function writePrivateJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    try {
      const temporaryStat = await stat(temporaryPath);
      if (temporaryStat.isFile()) await writeFile(temporaryPath, Buffer.alloc(0), { flag: 'w', mode: 0o600 });
    } catch {
      // Best-effort cleanup only; original evidence path is never removed here.
    }
    throw error;
  }
}

async function readRequiredRegularFile(path) {
  let inspected;
  try {
    inspected = await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw bridgeFailure(
        `Required Report retry evidence file is missing: ${relative(repositoryRoot, path)}`,
        'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_FILE_MISSING',
      );
    }
    throw error;
  }
  if (!inspected.isFile()) {
    throw bridgeFailure(
      'Report retry evidence path must be a regular file',
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_FILE_INVALID',
    );
  }
  return readFile(path);
}

function parseJson(bytes, label) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('object required');
    return value;
  } catch {
    throw bridgeFailure(
      `Report retry ${label} JSON is invalid`,
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_JSON_INVALID',
    );
  }
}

async function run(command, args) {
  try {
    await execFileAsync(command, args, { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw bridgeFailure(
      `Report retry evidence bridge command failed: ${command}`,
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_COMMAND_FAILED',
      { command, exitCode: Number(error?.code) || 1 },
    );
  }
}

async function runText(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 });
    return options.trim === false ? result.stdout : result.stdout.trim();
  } catch (error) {
    throw bridgeFailure(
      `Report retry evidence bridge command failed: ${command}`,
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_COMMAND_FAILED',
      { command, exitCode: Number(error?.code) || 1 },
    );
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, item]) => (
    item === null || ['string', 'number', 'boolean'].includes(typeof item)
  ))));
}

function bridgeFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeConfigDlqEvidenceHeadBridgeFailure';
  error.code = code;
  error.details = details;
  return error;
}
