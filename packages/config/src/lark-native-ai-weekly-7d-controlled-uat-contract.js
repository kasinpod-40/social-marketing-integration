export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION =
  'lark_native_ai_weekly_7d_controlled_uat_v1';

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_CONFIRMATION =
  'RUN_LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_V1';

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_OUTPUT_ROOT =
  'outputs/lark-native-ai-weekly-7d-controlled-uat';

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION =
  'weekly_executive_quality_v2_uat';

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS = 7;

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES = Object.freeze({
  settings: '⚙️ MKT_Report_Settings',
  snapshots: '🧾 MKT_Report_Snapshots',
  metrics: '📊 MKT_Report_Metric_Values',
  topContent: '🏆 MKT_Report_Top_Content',
  topAds: '📣 MKT_Report_Top_Ads',
  aiRuns: '🧠 MKT_AI_Report_Runs',
});

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS = Object.freeze([
  Object.freeze({
    title: 'AI Materialization → MKT_AI_Report_Runs',
    workflowIdSha256: '7e775f95993ce084ea03e7cb45b1c7e4334064cd0b6784df312f8dc1b5fbcf5d',
    requiredState: 'inactive',
  }),
  Object.freeze({
    title: 'Eligible AI Run → Lark Group Notification',
    workflowIdSha256: '52a205b281b466023625c426ec03a528542bb77b31dcc7b6ef6b93a2acb7ec42',
    requiredState: 'inactive',
  }),
]);

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS = Object.freeze({
  maximumSettingsRows: 500,
  maximumSnapshotRows: 500,
  maximumMetricRows: 2000,
  maximumTopContentRows: 100,
  maximumTopAdsRows: 100,
  maximumAiRunMatches: 1,
  maximumRecordWrites: 1,
  maximumAutomationListReads: 1,
});

export const LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SAFETY = Object.freeze({
  previewOnly: true,
  notificationEligible: false,
  sentToGroup: false,
  automationActivation: false,
  notificationSend: 0,
  scheduleEnabled: false,
  queueActionCount: 0,
  remoteD1ActionCount: 0,
  workerDeploymentCount: 0,
  providerActionCount: 0,
  production: 'BLOCKED',
});
