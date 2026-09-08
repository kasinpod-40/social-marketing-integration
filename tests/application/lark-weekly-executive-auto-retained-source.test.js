import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  collectRetainedD1Weekly7dSource,
  createAutomaticWeeklyExecutiveProcessor,
} from '../../apps/sync-worker/src/lark-weekly-executive-auto.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { LARK_NOTIFICATION_RUNTIME_MODES } from '../../packages/config/src/lark-notification-runtime-config.js';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

test('automatic Weekly resumes a generated AI row after its current-slot Report snapshots advance', async () => {
  const sourceAiRunKey = 'weekly-executive-decision-v4:retained-20260906';
  const sourceHash = sha256(sourceAiRunKey);
  const sourceRecord = {
    recordId: 'rec_source',
    fields: {
      ai_run_key: sourceAiRunKey,
      generation_status: 'generated',
      period_end: Date.parse('2026-09-05T17:00:00.000Z'),
      source_report_ids_json: JSON.stringify(['report-a']),
      metric_summary_json: 'summary',
    },
  };
  const admission = {
    aiRunKey: 'notification-weekly-7d:retained-20260906',
    qualityGate: { passed: true },
    fields: {
      ai_run_key: 'notification-weekly-7d:retained-20260906',
      report_id: 'notification-weekly-7d:retained-20260906',
      template_version: 'executive_weekly_7d_notification_v1',
      scope_type: 'executive',
      channel_key: 'executive',
      generation_status: 'generated',
      dedupe_key: sha256('retained-dedupe'),
      source_report_ids_json: JSON.stringify(['report-a']),
      insight_summary: 'insight',
      strengths: 'strength',
      weaknesses: 'weakness',
      recommendations: 'recommendation',
      period_start: Date.parse('2026-08-30T17:00:00.000Z'),
      period_end: Date.parse('2026-09-05T17:00:00.000Z'),
      notification_eligible: true,
      preview_mode: false,
      failure_code: null,
      sent_to_group: false,
    },
  };
  const admissionRecord = { recordId: 'rec_admission', fields: structuredClone(admission.fields) };
  const repositoryCalls = [];
  const repository = {
    async listByFieldValues(_tableId, fieldName, values) {
      repositoryCalls.push({ fieldName, values });
      if (fieldName === 'scope_type') return [sourceRecord];
      if (fieldName === 'ai_run_key') return [admissionRecord];
      throw new Error(`Unexpected field ${fieldName}`);
    },
  };
  const workEvents = [];
  const workStore = {
    async loadPhase({ phase }) {
      if (phase === 'fresh_ai_row_create_attempt') {
        return { complete: true, state: { identitySha256: sourceHash } };
      }
      if (phase === 'native_ai_trigger_attempt') {
        return { complete: true, state: { aiRunKeySha256: sourceHash } };
      }
      return null;
    },
    async assertCurrentGeneration(input) { workEvents.push({ type: 'fence', input }); },
    async completeWork(input) { workEvents.push({ type: 'complete', input }); },
    async abandonWork(input) { workEvents.push({ type: 'abandon', input }); },
  };
  const queueJobs = [];
  const aiWorkflowId = '1234567890';
  const notificationWorkflowId = '0987654321';
  const client = {
    appToken: 'app_token',
    async requestBitableJson() {
      return {
        data: {
          workflows: [
            { title: 'AI Materialization → MKT_AI_Report_Runs', workflow_id: aiWorkflowId, status: 'active' },
            { title: 'Eligible AI Run → Lark Group Notification', workflow_id: notificationWorkflowId, status: 'inactive' },
          ],
        },
      };
    },
  };
  const processor = createAutomaticWeeklyExecutiveProcessor({
    collectSource: async () => { throw new Error('rolling Report source must not be read'); },
    collectRetainedSource: async (input) => {
      assert.equal(input.customerProfile, 'chemistry_k');
      assert.equal(input.targetPeriodEnd, '2026-09-06');
      return {
        targetPeriod: { periodStart: '2026-08-31', periodEnd: '2026-09-06' },
        settings: [],
        reportBundles: [{ payload: { generatedAt: 1_788_748_251_000 } }],
      };
    },
    createClient: () => client,
    buildSeed: async () => ({ executiveRow: {
      ai_run_key: 'seed',
      source_report_ids_json: JSON.stringify(['report-a']),
      metric_summary_json: 'summary',
    } }),
    buildFactualReport: () => ({
      businessFactChannelCount: 1,
      period: { periodStart: '2026-08-31', periodEnd: '2026-09-06' },
      channels: Array.from({ length: 9 }, (_, index) => ({
        channelKey: `channel-${index}`,
        displayName: `Channel ${index}`,
        metrics: [],
        contentCandidates: [],
        adCandidates: [],
        topContent: null,
        topAd: null,
      })),
    }),
    buildSynthesis: () => ({
      aiRunKey: 'reconstructed-different-key',
      sourceReportIds: ['report-a'],
      factualReportSha256: 'b'.repeat(64),
      factualReport: {
        period: { periodStart: '2026-08-31', periodEnd: '2026-09-06' },
        channels: [],
      },
      evidence: { evidence: {} },
      fields: { metric_summary_json: 'summary' },
    }),
    assertGenerated: (fields, synthesis) => {
      assert.equal(fields, sourceRecord.fields);
      assert.equal(synthesis.aiRunKey, sourceAiRunKey);
      return { qualityGate: { passed: true } };
    },
    renderChannelSections: () => Array.from({ length: 9 }, (_, index) => ({
      heading: `Channel ${index}`,
      lines: ['No data'],
    })),
    buildAdmission: ({ sourceRecord: record, acceptedEvidence }) => {
      assert.equal(record, sourceRecord);
      assert.equal(acceptedEvidence.qualityGate.passed, true);
      return admission;
    },
    buildNotificationJob: (input) => ({ type: 'notification', ...input }),
  });

  const result = await processor({
    job: {
      body: {
        type: JOB_TYPES.LARK_NOTIFICATION_SEND,
        trigger: JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME,
        automaticWeekly: true,
        scheduleCadence: 'weekly',
        periodEnd: '2026-09-06',
      },
    },
    config: {
      customerProfile: 'chemistry_k',
      mode: LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME,
      flags: { runtimeEnabled: true, sendEnabled: true, mirrorEnabled: true },
      tables: { aiRuns: 'tbl_ai' },
    },
    env: {
      MKT_LARK_AI_MATERIALIZATION_WORKFLOW_ID_SHA256: sha256(aiWorkflowId),
      MKT_LARK_NOTIFICATION_WORKFLOW_ID_SHA256: sha256(notificationWorkflowId),
      MKT_SYNC_QUEUE: { async send(job) { queueJobs.push(job); } },
    },
    operation: {
      stable: true,
      operationId: 'weekly-executive-auto-20260906',
      workKey: 'lark_notification:weekly-executive-auto-20260906',
      generation: 1_788_748_251_000,
      originalRequestedAt: 1_788_748_251_000,
    },
    mainQueueAttempts: 7,
    getInfrastructure: () => ({
      repository,
      syncEngine: {},
      getResumableWorkStore: () => workStore,
    }),
  });

  assert.equal(result.status, 'notification_queued');
  assert.equal(result.qualityGatePassed, true);
  assert.equal(queueJobs.length, 1);
  assert.equal(queueJobs[0].aiRunKey, admission.aiRunKey);
  assert.equal(queueJobs[0].operationId, 'weekly-executive-send-20260906');
  assert.deepEqual(repositoryCalls, [
    { fieldName: 'scope_type', values: ['executive'] },
    { fieldName: 'ai_run_key', values: [admission.aiRunKey] },
  ]);
  assert.equal(workEvents.some(({ type }) => type === 'abandon'), false);
  assert.equal(workEvents.filter(({ type }) => type === 'complete').length, 1);
});

test('retained Weekly source rebuilds the eight active channels from exact D1 materializations', async () => {
  const reportIds = [];
  const source = await collectRetainedD1Weekly7dSource({
    customerProfile: 'chemistry_k',
    targetPeriodEnd: '2026-09-06',
    reader: {
      async readById(reportId) {
        reportIds.push(reportId);
        const platform = reportId.match(/^chemistry_k:([^:]+):rolling:7d:/u)?.[1];
        const capability = ['meta_ads', 'google_ads'].includes(platform)
          ? 'paid_ads'
          : platform === 'woocommerce'
            ? 'commerce'
            : platform === 'chatwoot'
              ? 'customer_service'
              : 'organic';
        return {
          row: {
            report_id: reportId,
            report_setting_key: `chemistry_k:${platform}:rolling:7d`,
            customer_key: 'chemistry_k',
            account_key: 'chemistry_k',
            report_type: 'dashboard_performance_report',
            generated_at: 1_788_748_251_000,
          },
          payload: {
            schemaVersion: 'report_materialization_v1',
            sourceReportId: reportId,
            platformScope: platform,
            capability,
            reportType: 'dashboard_performance_report',
            period: {
              periodKind: 'rolling_days',
              windowDays: 7,
              periodStart: '2026-08-31',
              periodEnd: '2026-09-06',
              comparisonMode: 'none',
              compareStart: null,
              compareEnd: null,
            },
            dataStatus: 'complete',
            coverageRate: 1,
            metricPayload: {},
            collections: { dimension_metrics: [] },
            topContent: [],
            topAds: [],
            source: 'd1',
            sourceWatermark: 'retained',
            generatedAt: 1_788_748_251_000,
            sourceUnavailableReason: null,
            aiSummary: null,
          },
        };
      },
    },
  });

  assert.equal(source.selectedChannelCount, 8);
  assert.equal(source.reportBundles.length, 8);
  assert.equal(source.settings.length, 8);
  assert.equal(source.selectedChannels.includes('tiktok_ads'), false);
  assert.equal(reportIds.every((reportId) => reportId.includes(':2026-08-31:2026-09-06:')), true);
  assert.equal(source.reportBundles.every(({ payload }) => (
    payload.source === 'validated_lark_report_output'
    && payload.sourceWatermark.startsWith('lark-report:')
  )), true);
});
