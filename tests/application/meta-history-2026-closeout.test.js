import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRecoverableMetaHistoryFinalSummaryFailure,
  reconcileMetaHistory2026Evidence,
} from '../../scripts/lib/meta-history-2026-closeout.js';

const requiredOperations = [
  operation('facebook', 'required', '2026-07-01', '2026-07-31'),
  operation('instagram', 'required', '2026-07-01', '2026-07-31'),
  operation('chemistry_k2', 'required'),
  operation('chemistry_k3', 'required'),
];
const conditionalOperations = [
  operation('chemistry_k2', 'conditional', '2026-01-01', '2026-04-30'),
  operation('chemistry_k3', 'conditional', '2026-01-01', '2026-04-30'),
];

test('Meta history closeout requires Facebook and Instagram Lark parity', () => {
  const plan = { operations: requiredOperations };
  const evidenceByOperation = requiredEvidence(requiredOperations, 10);
  const result = reconcileMetaHistory2026Evidence({ plan, evidenceByOperation });
  assert.equal(result.facebookHistoryCompleted, true);
  assert.equal(result.instagramCompleted, true);
  assert.equal(result.adsBaselineCompleted, true);
  assert.equal(result.parityVerified, true);
  assert.equal(result.idempotentRerunsVerified, true);
  assert.equal(result.expansion.allowed, true);
});

test('Meta history closeout rejects missing Facebook supplemental evidence', () => {
  const plan = { operations: requiredOperations };
  const evidenceByOperation = requiredEvidence(requiredOperations.slice(1), 10);
  assert.throws(
    () => reconcileMetaHistory2026Evidence({ plan, evidenceByOperation }),
    (error) => error?.code === 'META_HISTORY_2026_CLOSEOUT_INPUT_INVALID',
  );
});

test('Meta history closeout requires conditional evidence when volume permits expansion', () => {
  const plan = { operations: [...requiredOperations, ...conditionalOperations] };
  const evidenceByOperation = requiredEvidence(requiredOperations, 10);
  assert.throws(
    () => reconcileMetaHistory2026Evidence({ plan, evidenceByOperation }),
    (error) => error?.code === 'META_HISTORY_2026_CLOSEOUT_INPUT_INVALID',
  );
});

test('Meta history closeout skips conditional evidence when baseline exceeds expansion cap', () => {
  const plan = { operations: [...requiredOperations, ...conditionalOperations] };
  const evidenceByOperation = requiredEvidence(requiredOperations, 9000);
  const result = reconcileMetaHistory2026Evidence({ plan, evidenceByOperation });
  assert.equal(result.expansion.allowed, false);
  assert.equal(result.completed.length, 4);
});

test('Meta history closeout rejects Lark summaries without exact parity proof', () => {
  const plan = { operations: requiredOperations };
  const evidenceByOperation = requiredEvidence(requiredOperations, 10);
  evidenceByOperation[requiredOperations[0].operationId].larkSummary.data.larkParityVerified = false;
  assert.throws(
    () => reconcileMetaHistory2026Evidence({ plan, evidenceByOperation }),
    (error) => error?.code === 'META_HISTORY_2026_CLOSEOUT_LARK_INVALID',
  );
});

test('Only the known final parity alias failure is recoverable', () => {
  assert.equal(isRecoverableMetaHistoryFinalSummaryFailure({
    stage: 'final-safe-verification',
    code: 'META_HISTORY_2026_SUMMARY_INVALID',
    details: {
      failed: [
        'facebookHistoryCompleted',
        'instagramCompleted',
        'adsBaselineCompleted',
        'parity',
      ],
    },
  }), true);
  assert.equal(isRecoverableMetaHistoryFinalSummaryFailure({
    stage: 'operation-facebook',
    code: 'META_HISTORY_2026_COMMAND_FAILED',
    details: { failed: ['parity'] },
  }), false);
  assert.equal(isRecoverableMetaHistoryFinalSummaryFailure({
    stage: 'final-safe-verification',
    code: 'META_HISTORY_2026_SUMMARY_INVALID',
    details: { failed: ['executionFlagsAllFalse'] },
  }), false);
});

function requiredEvidence(operations, adsDaily) {
  return Object.fromEntries(operations.map((item) => [
    item.operationId,
    evidence(item, {
      adsDaily: item.target.startsWith('chemistry_k') ? adsDaily : 0,
    }),
  ]));
}

function operation(target, mode, periodStart = '2026-05-01', periodEnd = '2026-07-31') {
  return {
    target,
    mode,
    periodStart,
    periodEnd,
    operationId: `meta-${target}-${mode}-${periodStart.replaceAll('-', '')}`,
  };
}

function evidence(item, { adsDaily }) {
  return {
    d1Summary: {
      phase: 'summary',
      status: 'passed',
      data: {
        accepted: true,
        d1OnlyVerified: true,
        idempotentRerunVerified: true,
        restoredAllFalse: true,
      },
    },
    larkSummary: {
      phase: 'summary',
      status: 'passed',
      data: {
        accepted: true,
        larkParityVerified: true,
        idempotentRerunVerified: true,
        restoredAllFalse: true,
        providerRequestCount: 0,
      },
    },
    d1Verification: {
      data: {
        snapshotAfter: {
          syncRunStatus: 'success',
          activeLockCount: 0,
          invalidCoverageCount: 0,
          coverageEntityCount: adsDaily,
          operationCounts: {
            adsDaily,
            adsEntities: adsDaily === 0 ? 0 : 2,
          },
        },
      },
    },
  };
}
