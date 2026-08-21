import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessLarkBaseViewUiPlanAuthority,
  assessLarkBaseViewUiRefreshSourceAuthority,
  buildLarkBaseViewJsSdkParityPlan,
  LARK_BASE_VIEW_UI_APPROVED_REFRESH_LAYOUT_SOURCE_SHA256,
} from '../../scripts/lib/lark-base-view-js-sdk-parity.js';

test('projects retained View manifest into functional Base JS SDK mutations only', () => {
  const plan = buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
    fieldOrder: ['Status', 'Name'],
    sortInfo: [{ fieldId: 'Name', order: 'desc' }],
    group: [{ fieldId: 'Status', desc: false }],
    colInfos: {
      Name: { hidden: false, width: null },
      Status: { hidden: true, width: 240 },
    },
    rowHeightLevel: 1,
    frozenColCount: 1,
  }));

  assert.equal(plan.ok, true);
  assert.equal(plan.contractVersion, 'customer_base_view_js_sdk_parity_plan_v1');
  assert.deepEqual(plan.ownership, {
    automaticServerOpenApiVerifyOnly: ['hiddenFields', 'filters', 'hierarchy'],
    baseJsSdkMutations: ['sort', 'group'],
    ignoredCosmetic: ['columnWidth', 'rowHeight'],
    remainingManual: ['fieldOrder', 'frozenColumns'],
  });
  assert.deepEqual(plan.summary, {
    tableCount: 1,
    viewCount: 1,
    fieldOrderAuditViews: 1,
    hiddenVerificationViews: 1,
    hiddenVerificationAssignments: 1,
    sortViews: 1,
    groupViews: 1,
    frozenColumnManualViews: 1,
  });
  assert.deepEqual(plan.tables, [{
    tableName: 'Orders',
    views: [{
      viewName: 'Active',
      viewType: 'grid',
      verifyOnly: {
        fieldOrder: ['Status', 'Name'],
        hiddenFieldNames: ['Status'],
      },
      mutate: {
        sort: [{ fieldName: 'Name', desc: true }],
        group: [{ fieldName: 'Status', desc: false }],
      },
      remainingManual: {
        frozenColCount: 1,
      },
    }],
  }]);
});

test('accepts desc boolean and normalizes ascending order', () => {
  const plan = buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
    fieldOrder: ['Name'],
    sortInfo: [{ fieldId: 'Name', desc: false }],
    group: [{ fieldId: 'Name', order: 'DESC' }],
    rowHeightLevel: 2,
    frozenColCount: 0,
  }));

  const view = plan.tables[0].views[0];
  assert.deepEqual(view.mutate.sort, [{ fieldName: 'Name', desc: false }]);
  assert.deepEqual(view.mutate.group, [{ fieldName: 'Name', desc: true }]);
  assert.equal(Object.hasOwn(view.mutate, 'rowHeightLevel'), false);
  assert.equal(view.remainingManual.frozenColCount, 0);
});

test('fails closed on unknown directional representation', () => {
  assert.throws(
    () => buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
      sortInfo: [{ fieldId: 'Name', order: 'sideways' }],
    })),
    /must contain desc:boolean or order asc\/desc/u,
  );
});

test('ignores cosmetic column widths and row height instead of validating or gating them', () => {
  const plan = buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
    colInfos: {
      Name: { hidden: false, width: -999 },
      Status: { hidden: true, width: 999999 },
    },
    rowHeightLevel: 999,
  }));

  assert.deepEqual(plan.tables[0].views[0].mutate, { sort: [], group: [] });
  assert.deepEqual(plan.tables[0].views[0].verifyOnly.hiddenFieldNames, ['Status']);
  assert.equal(Object.hasOwn(plan.summary, 'columnWidthViews'), false);
  assert.equal(Object.hasOwn(plan.summary, 'columnWidthAssignments'), false);
  assert.equal(Object.hasOwn(plan.summary, 'rowHeightViews'), false);
});

test('admits a different Source SHA when controlled refresh structure remains exact', () => {
  const assessment = assessLarkBaseViewUiRefreshSourceAuthority({
    file: { sha256: 'different-current-source-sha' },
    counts: {
      tables: 33,
      fields: 723,
      records: 36_001,
      views: 111,
      relationFields: 12,
      formulaFields: 4,
      dashboards: 6,
      workflows: 2,
      advancedPermissionRoles: 4,
    },
  });

  assert.equal(assessment.ok, true);
  assert.equal(assessment.authorityMode, 'refresh-compatible');
  assert.equal(assessment.fileSha256, 'different-current-source-sha');
  assert.equal(assessment.records, 36_001);
  assert.deepEqual(assessment.mismatches, []);
});

test('rejects View UI Source when structure or record floor differs', () => {
  const assessment = assessLarkBaseViewUiRefreshSourceAuthority({
    file: { sha256: 'bad-source' },
    counts: {
      tables: 33,
      fields: 722,
      records: 35_000,
      views: 111,
      relationFields: 12,
      formulaFields: 4,
      dashboards: 6,
      workflows: 2,
      advancedPermissionRoles: 4,
    },
  });

  assert.equal(assessment.ok, false);
  assert.equal(assessment.authorityMode, null);
  assert.deepEqual(assessment.mismatches, [
    { dimension: 'fields', expected: 723, actual: 722 },
    { dimension: 'records', expectedMinimum: 35_528, actual: 35_000 },
  ]);
});

test('admits the exact refreshed layout only with the evidence-backed 42-sort inventory', () => {
  const assessment = assessLarkBaseViewUiPlanAuthority(approvedRefreshPlan(), {
    sourceSha256: LARK_BASE_VIEW_UI_APPROVED_REFRESH_LAYOUT_SOURCE_SHA256,
  });

  assert.equal(assessment.ok, true);
  assert.equal(
    assessment.authorityMode,
    'exact-refresh-layout-revision-facebook-content-published-at-desc',
  );
  assert.equal(
    assessment.sortInventoryFingerprintSha256,
    '961936df36fdf70b4cb2df434638630e699b573c26166b4aff04f0f58ecfbf88',
  );
  assert.deepEqual(assessment.mismatches, []);
});

test('rejects the approved refresh SHA if any sorted View identity changes', () => {
  const plan = approvedRefreshPlan();
  plan.tables[0].views[0].mutate.sort[0].fieldName = 'created_at';

  const assessment = assessLarkBaseViewUiPlanAuthority(plan, {
    sourceSha256: LARK_BASE_VIEW_UI_APPROVED_REFRESH_LAYOUT_SOURCE_SHA256,
  });

  assert.equal(assessment.ok, false);
  assert.equal(assessment.authorityMode, null);
  assert.deepEqual(assessment.mismatches.map((item) => item.dimension), [
    'sortInventoryFingerprintSha256',
  ]);
});

test('does not admit a 42-sort plan for an unapproved refresh SHA', () => {
  const assessment = assessLarkBaseViewUiPlanAuthority(approvedRefreshPlan(), {
    sourceSha256: 'another-refresh-sha',
  });

  assert.equal(assessment.ok, false);
  assert.equal(assessment.authorityMode, null);
  assert.deepEqual(assessment.mismatches, [
    { dimension: 'sortViews', expected: 41, actual: 42 },
  ]);
});

test('retained count gate also fails closed on hidden-state inventory drift', () => {
  const plan = approvedRefreshPlan();
  plan.summary.sortViews = 41;
  plan.summary.hiddenVerificationAssignments = 84;

  const assessment = assessLarkBaseViewUiPlanAuthority(plan, {
    sourceSha256: 'retained-compatible-refresh-sha',
  });

  assert.equal(assessment.ok, false);
  assert.deepEqual(assessment.mismatches, [
    { dimension: 'hiddenVerificationAssignments', expected: 85, actual: 84 },
  ]);
});

test('cosmetic sizing drift cannot change plan authority', () => {
  const plan = approvedRefreshPlan();
  plan.summary.columnWidthViews = 999;
  plan.summary.columnWidthAssignments = 9999;
  plan.summary.rowHeightViews = 999;

  const assessment = assessLarkBaseViewUiPlanAuthority(plan, {
    sourceSha256: LARK_BASE_VIEW_UI_APPROVED_REFRESH_LAYOUT_SOURCE_SHA256,
  });

  assert.equal(assessment.ok, true);
  assert.deepEqual(assessment.mismatches, []);
});

function approvedRefreshPlan() {
  const inventory = [
    ['🎬 MKT_Content', '🔵 Facebook Content', 'published_at', true],
    ['🏆 MKT_Report_Top_Content', '🏅 Weekly Top Content', 'rank', false],
    ['🏆 MKT_Report_Top_Content', '🏆 Daily Top Content', 'rank', false],
    ['🏆 MKT_Report_Top_Content', '🏆 Top Content', 'rank', false],
    ['🏢 MKT_Conversation_Account_Daily', '📋 All Account Daily', 'metric_date', true],
    ['👥 MKT_Commerce_Customers', '📋 All Customers', 'last_order_at', true],
    ['💬 MKT_Conversations', '📋 All Conversations', 'last_activity_at', true],
    ['📅 MKT_Commerce_Daily', '📋 All Commerce Daily', 'metric_date', true],
    ['📅 MKT_Content_Daily', '▶️ Latest YouTube Metrics', 'metric_date', true],
    ['📅 MKT_Content_Daily', '🎵 Latest TikTok Metrics', 'metric_date', true],
    ['📅 MKT_Content_Daily', '📋 All Content Daily', 'metric_date', true],
    ['📅 MKT_Content_Daily', '🔵 Latest Facebook Metrics', 'metric_date', true],
    ['📅 MKT_Content_Daily', '🟣 Latest Instagram Metrics', 'metric_date', true],
    ['📅 MKT_Conversation_Daily', '📋 All Conversation Daily', 'metric_date', true],
    ['📆 MKT_Account_Daily', '📋 All Account Daily', 'metric_date', true],
    ['📈 MKT_Ads_Daily', '⚠️ Spend With ROAS Below 1', 'metric_date', true],
    ['📈 MKT_Ads_Daily', '🎵 TikTok Ads Daily', 'metric_date', true],
    ['📈 MKT_Ads_Daily', '📈 Google Ads Daily 30D', 'metric_date', true],
    ['📈 MKT_Ads_Daily', '📋 All Ads Daily', 'metric_date', true],
    ['📈 MKT_Ads_Daily', '🔎 Google Ads Daily', 'metric_date', true],
    ['📈 MKT_Ads_Daily', '🔵 Meta Ads Daily', 'metric_date', true],
    ['📊 MKT_Report_Metric_Values', '📈 Weekly Metrics', 'rank', false],
    ['📊 MKT_Report_Metric_Values', '📊 Client Metrics', 'rank', true],
    ['📊 MKT_Report_Metric_Values', '📊 Daily Metrics', 'rank', false],
    ['📥 MKT_Inbox_Daily', '📋 All Inbox Daily', 'metric_date', true],
    ['📦 MKT_Commerce_Product_Daily', '📋 All Product Daily', 'metric_date', true],
    ['🧑‍💼 MKT_Agent_Daily', '📋 All Agent Daily', 'metric_date', true],
    ['🧠 MKT_AI_Report_Runs', '⚠️ Missing / Partial Data', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '✅ Notification Eligible', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '❌ AI Generation Failures', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '🌐 All Channel Readiness', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '📆 Monthly Reports', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '📊 Dashboard Channel Status', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '📊 Executive Summaries', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '🕘 Latest Reports', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '🗓️ Weekly Reports', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '🧪 Preview Runs', 'generated_at', true],
    ['🧠 MKT_AI_Report_Runs', '🧾 Yearly Reports', 'generated_at', true],
    ['🧾 MKT_Commerce_Orders', '📋 All Orders', 'source_created_at', true],
    ['🧾 MKT_Report_Snapshots', '📋 All Report Snapshots', 'generated_at', true],
    ['🧾 MKT_Report_Snapshots', '🕘 Latest Snapshots', 'generated_at', true],
    ['🛍️ MKT_Commerce_Products', '📋 All Products', 'source_modified_at', true],
  ];
  const tables = new Map();
  for (const [tableName, viewName, fieldName, desc] of inventory) {
    if (!tables.has(tableName)) tables.set(tableName, []);
    tables.get(tableName).push({
      viewName,
      mutate: { sort: [{ fieldName, desc }] },
    });
  }
  return {
    summary: {
      tableCount: 32,
      viewCount: 110,
      fieldOrderAuditViews: 110,
      hiddenVerificationViews: 11,
      hiddenVerificationAssignments: 85,
      sortViews: 42,
      groupViews: 4,
      frozenColumnManualViews: 110,
    },
    tables: [...tables.entries()].map(([tableName, views]) => ({ tableName, views })),
  };
}

function fixtureManifest(manual) {
  return {
    ok: true,
    contractVersion: 'customer_base_view_manual_parity_manifest_v1',
    mode: 'local-read-only-id-redacted',
    scope: 'clone-source-only',
    tables: [{
      tableName: 'Orders',
      views: [{
        viewName: 'Active',
        viewType: 'grid',
        manual,
      }],
    }],
    summary: {
      tableCount: 1,
      viewCount: 1,
      featureCounts: {},
    },
  };
}
