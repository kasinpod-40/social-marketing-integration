#!/usr/bin/env node

import { resolve } from 'node:path';
import { auditOperatorTerminalChannels } from './lib/operator-terminal-channel-audit.js';

const projectRoot = resolve(process.cwd());

try {
  const report = await auditOperatorTerminalChannels({ projectRoot });
  const compactEntries = report.entries.map((entry) => ({
    path: entry.path,
    channel: entry.channel,
    packageExposed: entry.packageExposed,
    changedInBranch: entry.changedInBranch,
    status: entry.status,
    controls: {
      planOnly: entry.features.hasPlanOnly,
      spawnedTest: entry.features.hasSpawnedTest,
      allBlockerPreflight: entry.features.hasAllBlockerPreflight,
      exactRepositoryGate: entry.features.hasExactRepositoryGate,
      privateEvidence: entry.features.hasPrivateEvidence,
      exitCodeContract: entry.features.hasExitCodeContract,
      safeRestore: entry.features.hasSafeRestore,
      sameInputReplay: entry.features.hasReplay,
      localLock: entry.features.hasLocalLock,
      completionProof: entry.features.completionProof,
      unsafeShell: entry.features.hasUnsafeShell,
    },
  }));
  process.stdout.write(`${JSON.stringify({
    ...report,
    entries: compactEntries,
  }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: 'operator_terminal_channel_audit_v1',
    code: error?.code ?? 'OPERATOR_TERMINAL_AUDIT_FAILED',
    message: error?.message ?? String(error),
    remoteReadCount: 0,
    remoteWriteCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}
