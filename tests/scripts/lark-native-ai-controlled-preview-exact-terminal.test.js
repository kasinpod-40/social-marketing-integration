import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION,
} from '../../packages/config/src/lark-native-ai-controlled-preview-exact-terminal-contract.js';
import { stableStringify } from '../../packages/application/src/use-cases/build-report-snapshot.js';
import {
  assertLarkNativeAiControlledPreviewExactTerminalConfirmation,
  assertLarkNativeAiControlledPreviewExactTerminalFirstPass,
  assertLarkNativeAiControlledPreviewExactTerminalNodeVersion,
  assertLarkNativeAiControlledPreviewExactTerminalReplay,
  assertLarkNativeAiControlledPreviewExactTerminalRepository,
  buildLarkNativeAiControlledPreviewExactTerminalChildEnv,
  buildLarkNativeAiControlledPreviewExactTerminalReadiness,
  parseLarkNativeAiControlledPreviewExactTerminalArgs,
  sha256Hex,
  validateLarkNativeAiControlledPreviewSourcePackage,
} from '../../scripts/lib/lark-native-ai-controlled-preview-exact-terminal.js';

const HEAD = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

test('plan-only terminal prints one command without shell placeholders', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/lark-native-ai-controlled-preview-exact-terminal.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.planOnly, true);
  assert.equal(output.maximumFirstPassWrites, 40);
  assert.equal(output.replayWritesRequired, 0);
  assert.match(output.exactCommand, /--execute$/u);
  assert.doesNotMatch(output.exactCommand, /<[^>]+>/u);
  assert.equal(output.executed, false);
  assert.equal(output.production, 'BLOCKED');
});

test('argument confirmation repository and Node gates fail closed', () => {
  assert.deepEqual(parseLarkNativeAiControlledPreviewExactTerminalArgs([]), { execute: false });
  assert.deepEqual(parseLarkNativeAiControlledPreviewExactTerminalArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseLarkNativeAiControlledPreviewExactTerminalArgs(['--apply']),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_ARGUMENT_UNSUPPORTED',
  );
  assert.throws(
    () => assertLarkNativeAiControlledPreviewExactTerminalConfirmation({}),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNativeAiControlledPreviewExactTerminalConfirmation({
    CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION,
  }), true);
  assert.equal(assertLarkNativeAiControlledPreviewExactTerminalNodeVersion('22.14.0'), 22);
  assert.throws(
    () => assertLarkNativeAiControlledPreviewExactTerminalNodeVersion('20.18.0'),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_NODE_VERSION_INVALID',
  );
  assert.deepEqual(assertLarkNativeAiControlledPreviewExactTerminalRepository({
    branch: 'main', clean: true, head: HEAD, originMain: HEAD,
  }), { branch: 'main', clean: true, exactHeadSha: HEAD });
  assert.throws(
    () => assertLarkNativeAiControlledPreviewExactTerminalRepository({
      branch: 'main', clean: true, head: HEAD, originMain: 'c'.repeat(40),
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_MAIN_NOT_CURRENT',
  );
});

test('retained source package binds exact Head checksum windows and real-data authority', async () => {
  const sourcePackage = await makeSourcePackage();
  const validated = await validateLarkNativeAiControlledPreviewSourcePackage(sourcePackage, {
    exactHeadSha: HEAD,
  });
  assert.equal(validated.packageSha256, sourcePackage.packageSha256);
  assert.deepEqual(validated.offlineInputs.map((item) => item.window.windowDays), [1, 3, 7, 30]);
  assert.equal(validated.remoteAuthority.metaRemoteLockReleased, true);

  const tampered = structuredClone(sourcePackage);
  tampered.offlineInputs[0].generation.generationId = 'changed-after-checksum';
  await assert.rejects(
    () => validateLarkNativeAiControlledPreviewSourcePackage(tampered, { exactHeadSha: HEAD }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_CHECKSUM_INVALID',
  );

  const fixture = await makeSourcePackage((value) => {
    value.offlineInputs[0].generation.generationId = 'fixture-1d';
  });
  await assert.rejects(
    () => validateLarkNativeAiControlledPreviewSourcePackage(fixture, { exactHeadSha: HEAD }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_NON_REAL_DATA_FORBIDDEN',
  );
});

test('readiness construction creates stable exact-head approval for all four windows', async () => {
  const sourcePackage = await validateLarkNativeAiControlledPreviewSourcePackage(
    await makeSourcePackage(),
    { exactHeadSha: HEAD },
  );
  const calls = [];
  const plans = await buildLarkNativeAiControlledPreviewExactTerminalReadiness({
    sourcePackage,
    repository: { branch: 'main', clean: true, exactHeadSha: HEAD },
    buildReadiness: async (input) => {
      calls.push(input);
      return Object.freeze({
        status: 'ready_for_controlled_preview',
        blockers: Object.freeze([]),
        runIdentity: Object.freeze({ windowDays: input.offlineInput.window.windowDays }),
      });
    },
  });
  assert.equal(plans.length, 4);
  assert.equal(new Set(calls.map((item) => item.approval.approvalId)).size, 1);
  assert.equal(calls[0].approval.approvedAt, sourcePackage.remoteAuthority.capturedAt);
  assert.equal(calls[0].approval.approvedHeadSha, HEAD);
  assert.equal(calls[0].remoteAuthority.metaRemoteLockReleased, true);
});

test('child environment overrides retry pagination and path authority deterministically', () => {
  const env = buildLarkNativeAiControlledPreviewExactTerminalChildEnv({
    LARK_MAX_ATTEMPTS: '9',
    LARK_MAX_PAGES: '999',
    LARK_MAX_FILTER_CONDITIONS: '1',
  }, {
    head: HEAD,
    inputPath: '/private/input.json',
    evidencePath: '/private/evidence.json',
  });
  assert.equal(env.LARK_MAX_ATTEMPTS, '1');
  assert.equal(env.LARK_MAX_PAGES, '1');
  assert.equal(env.LARK_MAX_FILTER_CONDITIONS, '50');
  assert.equal(env.LARK_REQUEST_TIMEOUT_MS, '30000');
  assert.equal(env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_REVIEWED_HEAD, HEAD);
  assert.equal(env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_INPUT, '/private/input.json');
});

test('first pass and same-input replay require verified bounded writes then forty no-op rows', () => {
  const first = assertLarkNativeAiControlledPreviewExactTerminalFirstPass({
    ok: true,
    mode: 'applied_and_verified',
    writes: { created: 40, updated: 0, total: 40 },
    verification: { status: 'zero_drift', counts: { write: 0, noOp: 40, delete: 0 } },
    remote: { blockedRequestCount: 0, totalRecordWrites: 40 },
    aiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  assert.equal(first.writes.total, 40);
  const replay = assertLarkNativeAiControlledPreviewExactTerminalReplay({
    ok: true,
    mode: 'already_zero_drift',
    writes: { created: 0, updated: 0, total: 0 },
    verification: { status: 'zero_drift', counts: { write: 0, noOp: 40, delete: 0 } },
    remote: { blockedRequestCount: 0, totalRecordWrites: 0 },
    aiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  assert.equal(replay.writes.total, 0);
  assert.throws(
    () => assertLarkNativeAiControlledPreviewExactTerminalReplay({
      ...replay,
      mode: 'applied_and_verified',
      writes: { created: 1, updated: 0, total: 1 },
      remote: { blockedRequestCount: 0, totalRecordWrites: 1 },
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_REPLAY_INVALID',
  );
});

async function makeSourcePackage(mutator = () => undefined) {
  const source = {
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    repositoryHead: HEAD,
    provenance: {
      sourceKind: 'retained_real_validated_report_evidence',
      validationStatus: 'validated',
      frozen: true,
      fixtureData: false,
      sourceEvidenceSha256: HASH,
    },
    schemaAuthority: {
      validationStatus: 'validated',
      frozen: true,
      targetTable: '🧠 MKT_AI_Report_Runs',
      status: 'zero_drift',
      requiredViewCount: 6,
      exactViewFilterCount: 6,
      remainingLogicalActionCount: 0,
      evidenceSha256: HASH,
    },
    remoteAuthority: {
      source: 'retained-safe-state',
      validationStatus: 'validated',
      frozen: true,
      evidenceSha256: HASH,
      capturedAt: 1785720000000,
      metaRemoteLockReleased: true,
      workerFlagsAllFalse: true,
      previewUrlsDisabled: true,
      productionBlocked: true,
      scheduleEnabled: false,
    },
    offlineInputs: [1, 3, 7, 30].map((windowDays) => ({
      customer: { customerKey: 'integration_workspace' },
      window: { windowDays },
      generation: { generationId: `real-report-${windowDays}d` },
      channels: [{ platform: 'tiktok' }],
    })),
  };
  mutator(source);
  source.packageSha256 = await sha256Hex(stableStringify(source));
  return source;
}
