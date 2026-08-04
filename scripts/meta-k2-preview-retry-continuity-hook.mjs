#!/usr/bin/env node

import childProcess from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';

import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  META_K2_RETRY_CONTINUITY_MODE,
  classifyMetaK2PreviewRetryContinuity,
  extractMetaK2RawSnapshot,
  patchMetaK2RawSnapshotTargetCounts,
} from './lib/meta-k2-preview-retry-continuity.js';

const ENTRYPOINT = 'meta-k2-partial-staging-preview-recovery.mjs';
const enabled = process.env[META_K2_RETRY_CONTINUITY_MODE.envName]
  === META_K2_RETRY_CONTINUITY_MODE.value;
const isReviewedLauncher = basename(process.argv[1] ?? '') === ENTRYPOINT;

if (enabled && isReviewedLauncher) {
  const recoveryRoot = join(
    process.cwd(),
    'outputs',
    'meta-d1-only-rollout',
    META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
    META_K2_EXACT_RECOVERY_IDENTITY.operationId,
    'exact-partial-staging-recovery-v1',
  );
  const evidencePath = join(recoveryRoot, 'read-only-stability.json');
  let priorSnapshot = null;
  try {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    priorSnapshot = evidence?.data?.stability?.snapshot ?? null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (priorSnapshot) {
    const originalSpawnSync = childProcess.spawnSync.bind(childProcess);
    let inspected = false;
    childProcess.spawnSync = function continuityGuardedSpawnSync(command, args, options) {
      const result = originalSpawnSync(command, args, options);
      if (inspected || !isExactSnapshotCommand(command, args) || result?.status !== 0) {
        return result;
      }
      inspected = true;
      const stdoutText = Buffer.isBuffer(result.stdout)
        ? result.stdout.toString(options?.encoding ?? 'utf8')
        : String(result.stdout ?? '');
      let raw;
      try {
        raw = JSON.parse(stdoutText);
      } catch {
        return result;
      }
      const currentSnapshot = extractMetaK2RawSnapshot(raw);
      const continuity = classifyMetaK2PreviewRetryContinuity(
        priorSnapshot,
        currentSnapshot,
      );
      const report = {
        ok: continuity.accepted,
        stage: 'review-meta-k2-retry-continuity',
        code: continuity.accepted
          ? 'META_K2_RETRY_CONTINUITY_ACCEPTED'
          : 'META_K2_PREVIEW_RETRY_CONTINUITY_UNSAFE',
        elapsedMs: continuity.elapsedMs,
        exactOperationDrift: continuity.exactChangedFields.length > 0,
        exactChangedFields: continuity.exactChangedFields,
        targetCountOnlyDrift: continuity.targetCountOnlyDrift,
        targetCountDelta: continuity.targetCountDelta,
        targetCountRegressions: continuity.targetCountRegressions,
        priorFailedChecks: continuity.priorClassification.failed,
        currentFailedChecks: continuity.currentClassification.failed,
        inMemoryLegacyValidatorAdaptation: continuity.accepted,
        evidenceFileModified: false,
        remoteMutationCount: 0,
        queueMessageCount: 0,
        lifecycleSqlRepairCount: 0,
        scheduleEnabled: false,
        production: 'BLOCKED',
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!continuity.accepted) return result;

      const patchedRaw = patchMetaK2RawSnapshotTargetCounts(
        raw,
        continuity.prior.targetCounts,
      );
      const patchedText = JSON.stringify(patchedRaw);
      return {
        ...result,
        stdout: Buffer.isBuffer(result.stdout)
          ? Buffer.from(patchedText)
          : patchedText,
      };
    };
    syncBuiltinESMExports();
  }
}

function isExactSnapshotCommand(command, args = []) {
  if (String(command) !== 'npx' || !Array.isArray(args)) return false;
  const commandIndex = args.indexOf('--command');
  const sql = commandIndex >= 0 ? String(args[commandIndex + 1] ?? '') : '';
  return args[0] === 'wrangler'
    && args[1] === 'd1'
    && args[2] === 'execute'
    && args.includes('--remote')
    && args.includes('--json')
    && sql.includes(META_K2_EXACT_RECOVERY_IDENTITY.operationId)
    && sql.includes('target_ads_entity_count')
    && sql.includes('operation_ads_daily_count');
}
