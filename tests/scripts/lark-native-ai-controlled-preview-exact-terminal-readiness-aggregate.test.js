import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkNativeAiControlledPreviewExactTerminalReadiness,
} from '../../scripts/lib/lark-native-ai-controlled-preview-exact-terminal.js';

const HEAD = 'a'.repeat(40);
const PACKAGE_SHA = 'b'.repeat(64);

const sourcePackage = Object.freeze({
  packageSha256: PACKAGE_SHA,
  schemaAuthority: Object.freeze({ status: 'zero_drift' }),
  remoteAuthority: Object.freeze({ capturedAt: 1785754977523 }),
  offlineInputs: Object.freeze([1, 3, 7, 30].map((windowDays) => Object.freeze({
    window: Object.freeze({ windowDays }),
  }))),
});
const repository = Object.freeze({ branch: 'main', clean: true, exactHeadSha: HEAD });

test('returns all four readiness plans when every window is ready', async () => {
  const plans = await buildLarkNativeAiControlledPreviewExactTerminalReadiness({
    sourcePackage,
    repository,
    buildReadiness: async ({ offlineInput }) => readyPlan(offlineInput.window.windowDays),
  });
  assert.deepEqual(plans.map(({ runIdentity }) => runIdentity.windowDays), [1, 3, 7, 30]);
});

test('reports every blocked window in one failure instead of stopping at the first', async () => {
  await assert.rejects(
    () => buildLarkNativeAiControlledPreviewExactTerminalReadiness({
      sourcePackage,
      repository,
      buildReadiness: async ({ offlineInput }) => {
        const windowDays = offlineInput.window.windowDays;
        if ([7, 30].includes(windowDays)) return blockedPlan(windowDays);
        return readyPlan(windowDays);
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_READINESS_NOT_READY',
      );
      assert.equal(error.details.blockedWindowCount, 2);
      assert.deepEqual(
        error.details.blockedWindows.map(({ windowDays }) => windowDays),
        [7, 30],
      );
      assert.equal(error.details.windowResults.length, 4);
      assert.deepEqual(
        error.details.windowResults.map(({ windowDays, status, ready }) => ({
          windowDays,
          status,
          ready,
        })),
        [
          { windowDays: 1, status: 'ready_for_controlled_preview', ready: true },
          { windowDays: 3, status: 'ready_for_controlled_preview', ready: true },
          { windowDays: 7, status: 'blocked', ready: false },
          { windowDays: 30, status: 'blocked', ready: false },
        ],
      );
      assert.deepEqual(
        error.details.blockedWindows.map(({ goldenDatasetAuthority }) => (
          goldenDatasetAuthority.admissionClass
        )),
        ['blocked', 'blocked'],
      );
      return true;
    },
  );
});

function readyPlan(windowDays) {
  return Object.freeze({
    status: 'ready_for_controlled_preview',
    blockers: Object.freeze([]),
    runIdentity: Object.freeze({ windowDays }),
    goldenDatasetAuthority: Object.freeze({
      admissionClass: windowDays >= 7
        ? 'current_totals_only_low_baseline'
        : 'baseline_partial_high_coverage',
      previewEligible: true,
    }),
  });
}

function blockedPlan(windowDays) {
  return Object.freeze({
    status: 'blocked',
    blockers: Object.freeze([
      Object.freeze({ code: 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE', subject: 'tiktok' }),
    ]),
    runIdentity: Object.freeze({ windowDays }),
    goldenDatasetAuthority: Object.freeze({
      admissionClass: 'blocked',
      previewEligible: false,
    }),
  });
}
