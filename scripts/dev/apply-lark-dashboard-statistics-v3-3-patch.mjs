#!/usr/bin/env node

import { readFile, unlink, writeFile } from 'node:fs/promises';

const files = {
  identity: 'scripts/lib/lark-dashboard-field-identity-recovery-v3.js',
  identityTest: 'tests/scripts/lark-dashboard-field-identity-recovery-v3.test.js',
  canonicalTest: 'tests/scripts/lark-dashboard-canonical-rebind-v1.test.js',
  operator: 'scripts/lark-dashboard-field-identity-recovery-v3.mjs',
  terminal: 'scripts/lark-dashboard-field-identity-recovery-terminal-v3.mjs',
};

const identity = await readFile(files.identity, 'utf8');
let nextIdentity = replaceExact(
  identity,
  "  'lark_dashboard_field_identity_recovery_v3_2';",
  "  'lark_dashboard_field_identity_recovery_v3_3';",
  'identity version',
);
nextIdentity = replaceExact(
  nextIdentity,
  "  'base:dashboard:read',\n  'base:block:read',\n  'base:block:update',",
  "  'base:dashboard:read',\n  'base:dashboard:update',",
  'Dashboard scope contract',
);
await writeFile(files.identity, nextIdentity);

const identityTest = await readFile(files.identityTest, 'utf8');
let nextIdentityTest = replaceExact(
  identityTest,
  "    'base:dashboard:read',\n    'base:block:read',\n    'base:block:update',",
  "    'base:dashboard:read',\n    'base:dashboard:update',",
  'scope test',
);
nextIdentityTest = replaceExact(
  nextIdentityTest,
  "    'lark_dashboard_field_identity_recovery_v3_2',",
  "    'lark_dashboard_field_identity_recovery_v3_3',",
  'version test',
);
nextIdentityTest = replaceExact(
  nextIdentityTest,
  "  assert.equal(\n    assertFieldIdentityScopeConfirmation(LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION),\n    true,\n  );",
  "  assert.equal(\n    assertFieldIdentityScopeConfirmation(LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION),\n    true,\n  );\n  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:update'), false);\n  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:read'), false);",
  'obsolete scope rejection test',
);
await writeFile(files.identityTest, nextIdentityTest);

const canonicalTest = await readFile(files.canonicalTest, 'utf8');
let nextCanonicalTest = replaceExact(
  canonicalTest,
  "  rewriteDashboardBlockDataConfig,\n} from '../../scripts/lib/lark-dashboard-canonical-rebind-v1.js';",
  "  rewriteDashboardBlockDataConfig,\n  sanitizeDashboardFilterForMutation,\n} from '../../scripts/lib/lark-dashboard-canonical-rebind-v1.js';",
  'canonical test import',
);
const canonicalRegression = `

test('strips response-only Dashboard filter metadata before PATCH', () => {
  const result = rewriteDashboardBlockDataConfig({
    dashboardName: ORGANIC_DASHBOARD_NAME,
    blockName: 'Baseline Coverage Rate',
    dataConfig: {
      table_name: '📊 MKT_Report_Metric_Values',
      filter: {
        type: 1,
        conjunction: 'and',
        condition_omitted: false,
        conditions: [
          {
            condition_id: 'legacy-condition',
            field_name: '__mkt_legacy_display_name_single_select_v2',
            field_type: 3,
            operator: 'is',
            value: 'Baseline coverage rate',
          },
          {
            condition_id: 'platform-condition',
            field_name: 'platform',
            field_type: 1,
            operator: 'is',
            value: 'tiktok',
          },
        ],
      },
    },
  });

  assert.equal(result.filterResponseMetadataRemovalCount, 6);
  assert.deepEqual(result.patch.filter, {
    conjunction: 'and',
    conditions: [
      { field_name: 'platform', operator: 'is', value: 'tiktok' },
      {
        field_name: 'metric_key',
        operator: 'is',
        value: 'tiktok:baseline_coverage_rate',
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(result.patch.filter),
    /condition_id|field_type|condition_omitted|"type"/u,
  );
});

test('filter sanitizer keeps business conditions and omits valueless response values', () => {
  const result = sanitizeDashboardFilterForMutation({
    conjunction: 'or',
    response_revision: 42,
    conditions: [
      {
        condition_id: 'empty-condition',
        fieldName: 'display_name',
        fieldType: 1,
        operator: 'isEmpty',
        value: ['response-only-placeholder'],
      },
      {
        condition_id: 'window-condition',
        field_name: 'window_days',
        field_type: 2,
        operator: 'is',
        value: [30],
      },
    ],
  });

  assert.deepEqual(result, {
    conjunction: 'or',
    conditions: [
      { field_name: 'display_name', operator: 'isEmpty' },
      { field_name: 'window_days', operator: 'is', value: [30] },
    ],
  });
});

test('filter sanitizer fails closed when a valued condition has no value', () => {
  assert.throws(
    () => sanitizeDashboardFilterForMutation({
      conjunction: 'and',
      conditions: [{ field_name: 'metric_key', operator: 'is' }],
    }),
    (error) => error.code === 'LARK_DASHBOARD_CANONICAL_REBIND_FILTER_VALUE_REQUIRED',
  );
});
`;
nextCanonicalTest = replaceExact(
  nextCanonicalTest,
  "\ntest('fixes Baseline Covered Content by stable key instead of ambiguous display label', () => {",
  `${canonicalRegression}\ntest('fixes Baseline Covered Content by stable key instead of ambiguous display label', () => {`,
  'canonical metadata regressions',
);
await writeFile(files.canonicalTest, nextCanonicalTest);

const operator = await readFile(files.operator, 'utf8');
let nextOperator = replaceExact(
  operator,
  "const execute = args.has('--execute');",
  "const execute = args.has('--execute');\nconst statisticsProbeOnly = args.has('--statistics-probe-only');\nconst STATISTICS_PROBE_BLOCK_NAME = 'Baseline Coverage Rate';",
  'operator probe args',
);
nextOperator = replaceExact(
  nextOperator,
  "  await writePrivateJson(join(attemptRoot, 'recovery-plan.json'), {\n    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n    dashboardPlan: safeDashboardPlan(dashboardPlan),\n    windowPlan,\n  });\n\n  const preview = Object.freeze({",
  "  await writePrivateJson(join(attemptRoot, 'recovery-plan.json'), {\n    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n    dashboardPlan: safeDashboardPlan(dashboardPlan),\n    windowPlan,\n  });\n  const statisticsRequestPlan = buildStatisticsRequestPlan(dashboardPlan.actions);\n  await writePrivateJson(\n    join(attemptRoot, 'statistics-request-plan.json'),\n    statisticsRequestPlan,\n  );\n\n  const preview = Object.freeze({",
  'statistics request evidence',
);
nextOperator = replaceExact(
  nextOperator,
  "    convergedStatisticsCount: dashboardPlan.convergedStatisticsCount,\n    preservedSlicerCount:",
  "    convergedStatisticsCount: dashboardPlan.convergedStatisticsCount,\n    statisticsRequestShapeViolationCount:\n      statisticsRequestPlan.requestShapeViolationCount,\n    statisticsResponseMetadataRemovalCount:\n      statisticsRequestPlan.responseMetadataRemovalCount,\n    statisticsProbeOnly,\n    preservedSlicerCount:",
  'preview request metrics',
);
nextOperator = replaceExact(
  nextOperator,
  "  currentStage = 'rebind-organic-statistics';\n  const blockCheckpoints = [];\n  for (let index = 0; index < dashboardPlan.actions.length; index += 1) {\n    const planned = dashboardPlan.actions[index];",
  "  currentStage = statisticsProbeOnly\n    ? 'probe-first-organic-statistics-request'\n    : 'rebind-organic-statistics';\n  const blockCheckpoints = [];\n  const statisticsActions = statisticsProbeOnly\n    ? dashboardPlan.actions.filter((action) => action.blockName === STATISTICS_PROBE_BLOCK_NAME)\n    : dashboardPlan.actions;\n  if (statisticsProbeOnly && statisticsActions.length !== 1) {\n    throw operatorError(\n      'Statistics request probe target is not unique',\n      'LARK_DASHBOARD_STATISTICS_PROBE_TARGET_INVALID',\n      { blockName: STATISTICS_PROBE_BLOCK_NAME, matchCount: statisticsActions.length },\n    );\n  }\n  for (let index = 0; index < statisticsActions.length; index += 1) {\n    const planned = statisticsActions[index];",
  'probe action limit',
);
nextOperator = replaceExact(
  nextOperator,
  "      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\n      slicerPatch: false,",
  "      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\n      responseMetadataRemovalCount: rewrite.filterResponseMetadataRemovalCount,\n      requestFilter: rewrite.patch.filter ?? null,\n      slicerPatch: false,",
  'safe request evidence',
);
nextOperator = replaceExact(
  nextOperator,
  "  await writePrivateJson(join(attemptRoot, 'statistics-checkpoints.json'), {\n    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n    checkpoints: blockCheckpoints,\n  });\n\n  currentStage = 'rebind-number-window-charts';",
  "  await writePrivateJson(join(attemptRoot, 'statistics-checkpoints.json'), {\n    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n    checkpoints: blockCheckpoints,\n  });\n\n  if (statisticsProbeOnly) {\n    const probeDashboards = await readDashboardState({ client: rawClient, baseToken });\n    const probePlan = buildDashboardPlan(probeDashboards, fieldStateBefore);\n    const probeAction = probePlan.actions.find(\n      (action) => action.blockName === STATISTICS_PROBE_BLOCK_NAME,\n    );\n    if (!probeAction || probeAction.changed) {\n      throw operatorError(\n        'Statistics request probe did not converge on readback',\n        'LARK_DASHBOARD_STATISTICS_PROBE_NOT_CONVERGED',\n        { blockName: STATISTICS_PROBE_BLOCK_NAME },\n      );\n    }\n    const probeSummary = Object.freeze({\n      ok: true,\n      contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n      decision: 'LARK_DASHBOARD_STATISTICS_REQUEST_PROBE_CONVERGED',\n      blockName: STATISTICS_PROBE_BLOCK_NAME,\n      confirmedStatisticsMutationCount: confirmedStatisticsMutations,\n      confirmedWindowChartMutationCount: 0,\n      confirmedRecordUpdateCount: 0,\n      confirmedFieldMutationCount: 0,\n      slicerPatchCount: 0,\n      production: 'BLOCKED',\n      evidenceRoot: attemptRoot,\n    });\n    await writePrivateJson(join(attemptRoot, 'statistics-probe-summary.json'), probeSummary);\n    process.stdout.write(`${JSON.stringify(probeSummary, null, 2)}\\n`);\n    process.exit(0);\n  }\n\n  currentStage = 'rebind-number-window-charts';",
  'probe stop boundary',
);
nextOperator = replaceExact(
  nextOperator,
  "          metricKey: rewrite.metricKey,\n          changed: rewrite.changed,",
  "          metricKey: rewrite.metricKey,\n          filterResponseMetadataRemovalCount: rewrite.filterResponseMetadataRemovalCount,\n          changed: rewrite.changed,",
  'action metadata count',
);
nextOperator = replaceExact(
  nextOperator,
  "        const rewrite = rewriteDashboardBlockDataConfig({\n          dashboardName: dashboard.name,\n          blockName: block.name,\n          dataConfig: block.dataConfig,\n        });\n        actions.push(Object.freeze({",
  "        const rewrite = rewriteDashboardBlockDataConfig({\n          dashboardName: dashboard.name,\n          blockName: block.name,\n          dataConfig: block.dataConfig,\n        });\n        if (rewrite.changed) {\n          assertStatisticsPatchRequestShape(rewrite.patch, {\n            dashboardName: dashboard.name,\n            blockName: block.name,\n          });\n        }\n        actions.push(Object.freeze({",
  'request shape assertion',
);
nextOperator = replaceExact(
  nextOperator,
  "function containsText(value, expected) {",
  `function buildStatisticsRequestPlan(actions) {
  const planned = actions.map((action, index) => Object.freeze({
    actionIndex: index + 1,
    dashboardId: action.dashboardId,
    dashboardName: action.dashboardName,
    blockId: action.blockId,
    blockName: action.blockName,
    blockType: action.blockType,
    metricKey: action.metricKey,
    changed: action.changed,
    responseMetadataRemovalCount: action.filterResponseMetadataRemovalCount,
    changedTopLevelKeys: Object.keys(action.patch).sort(),
    requestFilter: action.patch.filter ?? null,
  }));
  return Object.freeze({
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    actionCount: planned.length,
    requestShapeViolationCount: 0,
    responseMetadataRemovalCount: planned.reduce(
      (sum, action) => sum + Number(action.responseMetadataRemovalCount ?? 0),
      0,
    ),
    actions: Object.freeze(planned),
  });
}

function assertStatisticsPatchRequestShape(patch, details = {}) {
  const keys = Object.keys(patch).sort();
  if (keys.length !== 1 || keys[0] !== 'filter') {
    throw operatorError(
      'Statistics mutation must replace only the filter top-level key',
      'LARK_DASHBOARD_STATISTICS_REQUEST_SHAPE_INVALID',
      { ...details, changedTopLevelKeys: keys },
    );
  }
  const filter = patch.filter;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw operatorError(
      'Statistics mutation filter must be an object',
      'LARK_DASHBOARD_STATISTICS_REQUEST_SHAPE_INVALID',
      details,
    );
  }
  const filterKeys = Object.keys(filter).sort();
  if (filterKeys.length !== 2
    || filterKeys[0] !== 'conditions'
    || filterKeys[1] !== 'conjunction'
    || !Array.isArray(filter.conditions)) {
    throw operatorError(
      'Statistics mutation filter contains response-only metadata',
      'LARK_DASHBOARD_STATISTICS_REQUEST_SHAPE_INVALID',
      { ...details, filterKeys },
    );
  }
  for (const [index, condition] of filter.conditions.entries()) {
    const conditionKeys = Object.keys(condition).sort();
    const allowed = condition.value === undefined
      ? ['field_name', 'operator']
      : ['field_name', 'operator', 'value'];
    if (JSON.stringify(conditionKeys) !== JSON.stringify(allowed.sort())) {
      throw operatorError(
        'Statistics mutation condition contains response-only metadata',
        'LARK_DASHBOARD_STATISTICS_REQUEST_SHAPE_INVALID',
        { ...details, index, conditionKeys },
      );
    }
  }
  return true;
}

function containsText(value, expected) {`,
  'request-plan helpers',
);
await writeFile(files.operator, nextOperator);

const terminal = await readFile(files.terminal, 'utf8');
let nextTerminal = replaceExact(
  terminal,
  "const execute = args.has('--execute');",
  "const execute = args.has('--execute');\nconst statisticsProbeOnly = args.has('--statistics-probe-only');",
  'terminal probe arg',
);
nextTerminal = replaceExact(
  nextTerminal,
  "      [join(repositoryRoot, 'scripts', 'lark-dashboard-field-identity-recovery-v3.mjs'), '--execute'],",
  "      [\n        join(repositoryRoot, 'scripts', 'lark-dashboard-field-identity-recovery-v3.mjs'),\n        '--execute',\n        ...(statisticsProbeOnly ? ['--statistics-probe-only'] : []),\n      ],",
  'terminal probe forwarding',
);
await writeFile(files.terminal, nextTerminal);

await unlink(new URL(import.meta.url));
process.stdout.write(`${JSON.stringify({
  ok: true,
  decision: 'LARK_DASHBOARD_STATISTICS_REQUEST_CONTRACT_V3_3_PATCH_APPLIED',
  changedFiles: Object.values(files),
  temporaryPatchDeleted: true,
}, null, 2)}\n`);

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Non-unique patch anchor: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
