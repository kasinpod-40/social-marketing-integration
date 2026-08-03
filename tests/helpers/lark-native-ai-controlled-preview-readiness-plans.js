import { LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE } from '../../packages/config/src/lark-native-ai-controlled-preview-contract.js';
import { buildLarkNativeAiControlledPreviewReadiness } from '../../packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js';
import { createLarkNativeAiOfflineFixture } from '../fixtures/lark-native-ai-offline-preview-fixtures.js';

export const CONTROLLED_PREVIEW_TEST_HEAD = 'a'.repeat(40);
const SCHEMA_SHA = 'b'.repeat(64);
const REMOTE_SHA = 'c'.repeat(64);

export async function buildControlledPreviewReadinessPlans(options = {}) {
  const headSha = options.headSha ?? CONTROLLED_PREVIEW_TEST_HEAD;
  const lockReleased = options.lockReleased ?? true;
  const approved = options.approved ?? true;
  const metricDelta = options.metricDelta ?? 0;
  const plans = [];
  for (const windowDays of [1, 3, 7, 30]) {
    const offlineInput = createLarkNativeAiOfflineFixture('executive_mixed_availability').input;
    setWindow(offlineInput, windowDays);
    const tiktok = offlineInput.channels.find(({ platform }) => platform === 'tiktok');
    tiktok.report.metricValues[0].current_value += metricDelta;
    plans.push(await buildLarkNativeAiControlledPreviewReadiness({
      offlineInput,
      repository: { branch: 'main', clean: true, exactHeadSha: headSha },
      schemaAuthority: {
        validationStatus: 'validated',
        frozen: true,
        targetTable: '🧠 MKT_AI_Report_Runs',
        status: 'zero_drift',
        requiredViewCount: 6,
        exactViewFilterCount: 6,
        remainingLogicalActionCount: 0,
        evidenceSha256: SCHEMA_SHA,
      },
      remoteAuthority: {
        source: 'all_channel_audit_workstream',
        validationStatus: 'validated',
        frozen: true,
        evidenceSha256: REMOTE_SHA,
        capturedAt: Date.parse('2026-08-03T06:10:00.000Z'),
        metaRemoteLockReleased: lockReleased,
        workerFlagsAllFalse: true,
        previewUrlsDisabled: true,
        productionBlocked: true,
        scheduleEnabled: false,
      },
      approval: approved ? {
        confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
        approvalId: 'approval-20260803-controlled-preview',
        approvedAt: Date.parse('2026-08-03T06:15:00.000Z'),
        approvedHeadSha: headSha,
      } : undefined,
    }));
  }
  return {
    repository: { branch: 'main', clean: true, exactHeadSha: headSha },
    readinessPlans: plans,
  };
}

function setWindow(input, windowDays) {
  input.window.windowDays = windowDays;
  for (const channel of input.channels) {
    if (!channel.report) continue;
    channel.report.payload.period.windowDays = windowDays;
  }
}
