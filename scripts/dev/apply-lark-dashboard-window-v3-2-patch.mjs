#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(selfPath), '..', '..');
const expectedBranch = 'hotfix/lark-dashboard-window-chart-rebind-v3-2';
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
if (branch !== expectedBranch) throw new Error(`Expected branch ${expectedBranch}; got ${branch || '(detached)'}`);

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}
function write(path, content) {
  writeFileSync(resolve(root, path), content, 'utf8');
}
function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return text.replace(before, after);
}
function replaceRegexOnce(text, pattern, replacement, label) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: expected one regex match, found ${matches?.length ?? 0}`);
  }
  return text.replace(pattern, replacement);
}

const helperPath = 'scripts/lib/lark-dashboard-field-identity-recovery-v3.js';
let helper = read(helperPath);
helper = replaceOnce(
  helper,
  "  'lark_dashboard_field_identity_recovery_v3_1';",
  "  'lark_dashboard_field_identity_recovery_v3_2';",
  'bump recovery contract version',
);
write(helperPath, helper);

const chartHelperPath = 'scripts/lib/lark-dashboard-window-chart-rebind-v3-2.js';
let chartHelper = read(chartHelperPath);
chartHelper = replaceOnce(
  chartHelper,
  "  ) || containsExact(\n    value,\n    REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.canonicalName,\n  ) || containsExact(\n    value,\n    REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.fieldId,\n  );",
  "  ) || containsExact(\n    value,\n    REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.fieldId,\n  );",
  'keep preserved-reference check unambiguous before promotion',
);
write(chartHelperPath, chartHelper);

const existingTestPath = 'tests/scripts/lark-dashboard-field-identity-recovery-v3.test.js';
let existingTest = read(existingTestPath);
existingTest = replaceOnce(
  existingTest,
  "    'lark_dashboard_field_identity_recovery_v3_1',",
  "    'lark_dashboard_field_identity_recovery_v3_2',",
  'update existing version regression',
);
write(existingTestPath, existingTest);

const operatorPath = 'scripts/lark-dashboard-field-identity-recovery-v3.mjs';
let operator = read(operatorPath);
operator = replaceOnce(
  operator,
  "} from './lib/lark-dashboard-field-identity-recovery-v3.js';\n\nconst execFileAsync",
  `} from './lib/lark-dashboard-field-identity-recovery-v3.js';\nimport {\n  EXECUTIVE_NUMBER_WINDOW_CHART_NAMES,\n  hasNumberWindowReference,\n  hasPreservedWindowReference,\n  rewriteNumberWindowChartToPreservedSelect,\n} from './lib/lark-dashboard-window-chart-rebind-v3-2.js';\n\nconst execFileAsync`,
  'import window-chart recovery helpers',
);
operator = replaceOnce(
  operator,
  "let confirmedBlockMutations = 0;\nlet confirmedRecordUpdates = 0;",
  "let confirmedBlockMutations = 0;\nlet confirmedStatisticsMutations = 0;\nlet confirmedWindowChartMutations = 0;\nlet confirmedRecordUpdates = 0;",
  'add separated block mutation counters',
);
operator = replaceOnce(
  operator,
  '  const dashboardPlan = buildDashboardPlan(dashboardsBefore);',
  '  const dashboardPlan = buildDashboardPlan(dashboardsBefore, fieldStateBefore);',
  'pass initial field state into dashboard planning',
);
operator = replaceOnce(
  operator,
  "    preservedWindowChartCount: dashboardPlan.preservedWindowChartCount,\n    legacyReferenceCount:",
  "    preservedWindowChartCount: dashboardPlan.preservedWindowChartCount,\n    alreadyPreservedWindowChartCount: dashboardPlan.alreadyPreservedWindowChartCount,\n    numberWindowChartCount: dashboardPlan.numberWindowChartCount,\n    pendingWindowChartRebindCount: dashboardPlan.pendingWindowChartRebindCount,\n    convergedWindowChartCount: dashboardPlan.convergedWindowChartCount,\n    legacyReferenceCount:",
  'add preview window-chart plan counts',
);
operator = replaceOnce(
  operator,
  "    confirmedBlockMutations += 1;\n    blockCheckpoints.push(checkpoint);",
  "    confirmedBlockMutations += 1;\n    confirmedStatisticsMutations += 1;\n    blockCheckpoints.push(checkpoint);",
  'count Statistics mutations separately',
);

const insertAfterStatistics = `  await writePrivateJson(join(attemptRoot, 'statistics-checkpoints.json'), {\n    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n    checkpoints: blockCheckpoints,\n  });\n`;
const windowChartExecution = `${insertAfterStatistics}\n  currentStage = 'rebind-number-window-charts';\n  const windowChartCheckpoints = [];\n  for (let index = 0; index < dashboardPlan.windowChartActions.length; index += 1) {\n    const planned = dashboardPlan.windowChartActions[index];\n    currentAction = safeWindowActionIdentity(planned, index);\n    const liveBlock = await getDashboardBlock({\n      client: rawClient,\n      baseToken,\n      dashboardId: planned.dashboardId,\n      blockId: planned.blockId,\n    });\n\n    if (!hasNumberWindowReference(liveBlock.dataConfig)) {\n      if (!hasPreservedWindowReference(liveBlock.dataConfig)) {\n        throw operatorError(\n          'Executive window chart no longer references either reviewed window field',\n          'LARK_DASHBOARD_WINDOW_CHART_STATE_DRIFT',\n          currentAction,\n        );\n      }\n      const checkpoint = {\n        ...currentAction,\n        outcome: 'already_converged',\n        patchAttempted: false,\n      };\n      windowChartCheckpoints.push(checkpoint);\n      await writePrivateJson(windowActionPath(attemptRoot, index, 'converged'), checkpoint);\n      continue;\n    }\n\n    const rewrite = rewriteNumberWindowChartToPreservedSelect({\n      dashboardName: planned.dashboardName,\n      blockName: planned.blockName,\n      blockType: liveBlock.type,\n      dataConfig: liveBlock.dataConfig,\n    });\n    const beforeChecksum = checksum(liveBlock.dataConfig);\n    const targetChecksum = checksum(rewrite.dataConfig);\n    await writePrivateJson(windowActionPath(attemptRoot, index, 'before'), {\n      ...currentAction,\n      beforeChecksum,\n      targetChecksum,\n      sourceReferenceCount: rewrite.sourceReferenceCount,\n      numericPresetConversionCount: rewrite.numericPresetConversionCount,\n      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\n      slicerPatch: false,\n    });\n\n    let patchError = null;\n    try {\n      await rawClient.requestBitableJson(\n        blockPath(baseToken, planned.dashboardId, planned.blockId),\n        {\n          method: 'PATCH',\n          retryMode: 'none',\n          body: { data_config: rewrite.patch },\n        },\n      );\n    } catch (error) {\n      patchError = error;\n    }\n\n    const readback = await getDashboardBlock({\n      client: rawClient,\n      baseToken,\n      dashboardId: planned.dashboardId,\n      blockId: planned.blockId,\n    });\n    const outcome = classifyConfig({\n      before: liveBlock.dataConfig,\n      target: rewrite.dataConfig,\n      after: readback.dataConfig,\n    });\n    const checkpoint = {\n      ...currentAction,\n      outcome,\n      patchAttempted: true,\n      patchReturnedError: patchError !== null,\n      patchErrorCode: patchError?.code ?? null,\n      patchLarkCode: patchError?.details?.larkCode ?? null,\n      beforeChecksum,\n      targetChecksum,\n      afterChecksum: checksum(readback.dataConfig),\n    };\n    await writePrivateJson(windowActionPath(attemptRoot, index, 'after'), checkpoint);\n\n    if (outcome !== 'target_converged') {\n      throw operatorError(\n        outcome === 'rejected_unchanged'\n          ? 'Lark rejected a reviewed Executive Column window-field update without changing the Block'\n          : 'Executive window chart drifted to an unreviewed configuration',\n        outcome === 'rejected_unchanged'\n          ? 'LARK_DASHBOARD_WINDOW_CHART_PATCH_REJECTED'\n          : 'LARK_DASHBOARD_WINDOW_CHART_STATE_DRIFT',\n        {\n          ...currentAction,\n          patchErrorCode: patchError?.code ?? null,\n          patchErrorMessage: patchError instanceof Error ? patchError.message : null,\n          larkCode: patchError?.details?.larkCode ?? null,\n          currentBlockMayHaveWritten: outcome !== 'rejected_unchanged',\n          confirmedBlockMutations,\n        },\n      );\n    }\n    if (hasNumberWindowReference(readback.dataConfig)\n      || !hasPreservedWindowReference(readback.dataConfig)) {\n      throw operatorError(\n        'Executive window chart readback did not retain the preserved Select identity',\n        'LARK_DASHBOARD_WINDOW_CHART_READBACK_INVALID',\n        currentAction,\n      );\n    }\n    confirmedBlockMutations += 1;\n    confirmedWindowChartMutations += 1;\n    windowChartCheckpoints.push(checkpoint);\n  }\n  currentAction = null;\n  await writePrivateJson(join(attemptRoot, 'window-chart-checkpoints.json'), {\n    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,\n    checkpoints: windowChartCheckpoints,\n  });\n\n  const dashboardsAfterWindowChartRebind = await readDashboardState({\n    client: rawClient,\n    baseToken,\n  });\n  const windowChartRebindPlan = buildDashboardPlan(\n    dashboardsAfterWindowChartRebind,\n    fieldStateBefore,\n  );\n  if (windowChartRebindPlan.pendingWindowChartRebindCount !== 0\n    || windowChartRebindPlan.numberWindowChartCount !== 0\n    || windowChartRebindPlan.alreadyPreservedWindowChartCount !== 7) {\n    throw operatorError(\n      'Executive Number-window charts did not converge before Record or Field mutation',\n      'LARK_DASHBOARD_WINDOW_CHART_REBIND_NOT_CONVERGED',\n      safeDashboardPlan(windowChartRebindPlan),\n    );\n  }\n  await writePrivateJson(\n    join(attemptRoot, 'window-chart-rebind-verification.json'),\n    safeDashboardPlan(windowChartRebindPlan),\n  );\n`;
operator = replaceOnce(
  operator,
  insertAfterStatistics,
  windowChartExecution,
  'insert Number-window chart rebind stage',
);
operator = replaceOnce(
  operator,
  '  const reboundPlan = buildDashboardPlan(reboundDashboards);',
  '  const reboundPlan = buildDashboardPlan(reboundDashboards, fieldState);',
  'pass promoted field state into dashboard verification',
);
operator = replaceOnce(
  operator,
  "  if (reboundPlan.pendingStatisticsUpdateCount !== 0\n    || reboundPlan.legacyReferenceCount !== 0) {",
  "  if (reboundPlan.pendingStatisticsUpdateCount !== 0\n    || reboundPlan.pendingWindowChartRebindCount !== 0\n    || reboundPlan.numberWindowChartCount !== 0\n    || reboundPlan.legacyReferenceCount !== 0) {",
  'verify zero pending window chart actions after promotion',
);
operator = replaceOnce(
  operator,
  "        pendingStatisticsUpdateCount: reboundPlan.pendingStatisticsUpdateCount,\n        legacyReferenceCount:",
  "        pendingStatisticsUpdateCount: reboundPlan.pendingStatisticsUpdateCount,\n        pendingWindowChartRebindCount: reboundPlan.pendingWindowChartRebindCount,\n        numberWindowChartCount: reboundPlan.numberWindowChartCount,\n        legacyReferenceCount:",
  'include window chart verification details',
);
operator = replaceOnce(
  operator,
  '  const finalDashboardPlan = buildDashboardPlan(finalDashboards);',
  '  const finalDashboardPlan = buildDashboardPlan(finalDashboards, finalFieldState);',
  'pass final field state into dashboard planning',
);
operator = replaceOnce(
  operator,
  "  if (finalDashboardPlan.pendingStatisticsUpdateCount !== 0\n    || finalDashboardPlan.legacyReferenceCount !== 0) {",
  "  if (finalDashboardPlan.pendingStatisticsUpdateCount !== 0\n    || finalDashboardPlan.pendingWindowChartRebindCount !== 0\n    || finalDashboardPlan.numberWindowChartCount !== 0\n    || finalDashboardPlan.legacyReferenceCount !== 0) {",
  'verify final window chart convergence',
);
operator = replaceOnce(
  operator,
  "    confirmedStatisticsMutationCount: confirmedBlockMutations,",
  "    confirmedStatisticsMutationCount: confirmedStatisticsMutations,\n    confirmedWindowChartMutationCount: confirmedWindowChartMutations,\n    confirmedBlockMutationCount: confirmedBlockMutations,",
  'report separated block mutation counts',
);
operator = replaceOnce(
  operator,
  "    preservedWindowChartCount: finalDashboardPlan.preservedWindowChartCount,",
  "    preservedWindowChartCount: finalDashboardPlan.preservedWindowChartCount,\n    pendingWindowChartRebindCount: finalDashboardPlan.pendingWindowChartRebindCount,\n    numberWindowChartCount: finalDashboardPlan.numberWindowChartCount,",
  'report final window chart counts',
);
operator = replaceOnce(
  operator,
  "      confirmedBlockMutations,\n      confirmedRecordUpdates,",
  "      confirmedBlockMutations,\n      confirmedStatisticsMutations,\n      confirmedWindowChartMutations,\n      confirmedRecordUpdates,",
  'report separated counters on failure',
);

const dashboardPlanFunction = `function buildDashboardPlan(dashboards, fieldState) {\n  const organic = uniqueByName(dashboards, ORGANIC_DASHBOARD_NAME, 'Organic dashboard');\n  assertOrganicMetricBlockNames(organic.blocks.map((block) => block.name));\n  if (!fieldState?.preservedWindow) {\n    throw operatorError(\n      'Dashboard planning requires the current Report Metric field state',\n      'LARK_DASHBOARD_FIELD_IDENTITY_FIELD_STATE_REQUIRED',\n    );\n  }\n\n  const canonicalWindowTargetsPreserved = fieldState.preservedWindow.fieldName === 'window_days';\n  const canonicalWindowTargetsNumber = fieldState.numberWindow?.fieldName === 'window_days';\n  const actions = [];\n  const windowChartActions = [];\n  let legacyReferenceCount = 0;\n  let preservedSlicerCount = 0;\n  let alreadyPreservedWindowChartCount = 0;\n  let numberWindowChartCount = 0;\n\n  for (const dashboard of dashboards) {\n    for (const block of dashboard.blocks) {\n      const legacyReferences = collectLegacyFieldReferences(block.dataConfig);\n      legacyReferenceCount += legacyReferences.length;\n      const isOrganicMetric = dashboard.name === ORGANIC_DASHBOARD_NAME\n        && Object.hasOwn(ORGANIC_METRIC_BINDINGS, block.name);\n      const hasDisplayLegacy = legacyReferences.some((name) => name.includes('display_name'));\n      const hasWindowLegacy = legacyReferences.some((name) => name.includes('window_days'));\n      const hasCanonicalWindow = containsText(block.dataConfig, 'window_days');\n\n      if (isOrganicMetric) {\n        assertSupportedOrganicMetricBlockType(block.type, {\n          dashboardName: dashboard.name,\n          blockName: block.name,\n        });\n        const rewrite = rewriteDashboardBlockDataConfig({\n          dashboardName: dashboard.name,\n          blockName: block.name,\n          dataConfig: block.dataConfig,\n        });\n        actions.push(Object.freeze({\n          dashboardId: dashboard.dashboardId,\n          dashboardName: dashboard.name,\n          blockId: block.blockId,\n          blockName: block.name,\n          blockType: block.type,\n          metricKey: rewrite.metricKey,\n          changed: rewrite.changed,\n          patch: rewrite.patch,\n          dataConfig: rewrite.dataConfig,\n        }));\n        continue;\n      }\n\n      if (hasDisplayLegacy) {\n        throw operatorError(\n          'A non-Organic-Statistics block references Legacy display fields',\n          'LARK_DASHBOARD_FIELD_IDENTITY_DISPLAY_REFERENCE_UNSUPPORTED',\n          { dashboardName: dashboard.name, blockName: block.name, blockType: block.type },\n        );\n      }\n      if (!hasWindowLegacy && !hasCanonicalWindow) continue;\n      if (hasWindowLegacy && hasCanonicalWindow) {\n        throw operatorError(\n          'A Dashboard block references both Legacy and canonical window fields',\n          'LARK_DASHBOARD_WINDOW_CHART_REFERENCE_AMBIGUOUS',\n          { dashboardName: dashboard.name, blockName: block.name, blockType: block.type },\n        );\n      }\n\n      const type = String(block.type).trim().toLowerCase();\n      if (type === 'slicer') {\n        if (hasCanonicalWindow && canonicalWindowTargetsNumber) {\n          throw operatorError(\n            'A Slicer is bound to the retiring Number window field',\n            'LARK_DASHBOARD_WINDOW_NUMBER_SLICER_UNSUPPORTED',\n            { dashboardName: dashboard.name, blockName: block.name },\n          );\n        }\n        if (hasWindowLegacy || (hasCanonicalWindow && canonicalWindowTargetsPreserved)) {\n          preservedSlicerCount += 1;\n          continue;\n        }\n      } else if (type === 'column') {\n        if (hasWindowLegacy || (hasCanonicalWindow && canonicalWindowTargetsPreserved)) {\n          alreadyPreservedWindowChartCount += 1;\n          continue;\n        }\n        if (hasCanonicalWindow && canonicalWindowTargetsNumber) {\n          const rewrite = rewriteNumberWindowChartToPreservedSelect({\n            dashboardName: dashboard.name,\n            blockName: block.name,\n            blockType: block.type,\n            dataConfig: block.dataConfig,\n          });\n          numberWindowChartCount += 1;\n          windowChartActions.push(Object.freeze({\n            dashboardId: dashboard.dashboardId,\n            dashboardName: dashboard.name,\n            blockId: block.blockId,\n            blockName: block.name,\n            blockType: block.type,\n            changed: rewrite.changed,\n            patch: rewrite.patch,\n            dataConfig: rewrite.dataConfig,\n          }));\n          continue;\n        }\n      }\n\n      throw operatorError(\n        'Window binding exists on an unreviewed block or field state',\n        'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_REFERENCE_UNSUPPORTED',\n        { dashboardName: dashboard.name, blockName: block.name, blockType: block.type },\n      );\n    }\n  }\n\n  const preservedWindowChartCount = alreadyPreservedWindowChartCount + numberWindowChartCount;\n  const pendingNames = windowChartActions.map((action) => action.blockName);\n  const unexpectedPendingNames = pendingNames.filter(\n    (name) => !EXECUTIVE_NUMBER_WINDOW_CHART_NAMES.includes(name),\n  );\n  const duplicatePendingCount = pendingNames.length - new Set(pendingNames).size;\n  if (actions.length !== 17\n    || preservedSlicerCount !== 5\n    || preservedWindowChartCount !== 7\n    || unexpectedPendingNames.length > 0\n    || duplicatePendingCount !== 0) {\n    throw operatorError(\n      'Dashboard field-identity plan does not match the reviewed 17/5/7 block contract',\n      'LARK_DASHBOARD_FIELD_IDENTITY_PLAN_SCOPE_MISMATCH',\n      {\n        organicMetricBlockCount: actions.length,\n        preservedSlicerCount,\n        preservedWindowChartCount,\n        alreadyPreservedWindowChartCount,\n        numberWindowChartCount,\n        pendingNames,\n        unexpectedPendingNames,\n        duplicatePendingCount,\n      },\n    );\n  }\n\n  return Object.freeze({\n    actions: Object.freeze(actions),\n    windowChartActions: Object.freeze(windowChartActions),\n    organicMetricBlockCount: actions.length,\n    pendingStatisticsUpdateCount: actions.filter((action) => action.changed).length,\n    convergedStatisticsCount: actions.filter((action) => !action.changed).length,\n    preservedSlicerCount,\n    preservedWindowChartCount,\n    alreadyPreservedWindowChartCount,\n    numberWindowChartCount,\n    pendingWindowChartRebindCount: windowChartActions.length,\n    convergedWindowChartCount: preservedWindowChartCount - windowChartActions.length,\n    legacyReferenceCount,\n  });\n}\n\n`;
operator = replaceRegexOnce(
  operator,
  /function buildDashboardPlan\(dashboards\) \{[\s\S]*?\n\}\n\n(?=function containsText)/,
  dashboardPlanFunction,
  'replace Dashboard planning with 17/5/7 field-aware contract',
);

operator = replaceOnce(
  operator,
  "function safeActionIdentity(action, index) {\n  return Object.freeze({",
  "function safeActionIdentity(action, index) {\n  return Object.freeze({",
  'confirm safe action anchor',
);
operator = replaceOnce(
  operator,
  "function actionPath(root, index, suffix) {\n  return join(root, `statistics-${String(index + 1).padStart(2, '0')}-${suffix}.json`);\n}",
  `function safeWindowActionIdentity(action, index) {\n  return Object.freeze({\n    actionIndex: index + 1,\n    dashboardId: action.dashboardId,\n    dashboardName: action.dashboardName,\n    blockId: action.blockId,\n    blockName: action.blockName,\n    blockType: action.blockType,\n  });\n}\nfunction actionPath(root, index, suffix) {\n  return join(root, \`statistics-\${String(index + 1).padStart(2, '0')}-\${suffix}.json\`);\n}\nfunction windowActionPath(root, index, suffix) {\n  return join(root, \`window-chart-\${String(index + 1).padStart(2, '0')}-\${suffix}.json\`);\n}`,
  'add window-chart evidence helpers',
);

const safePlanFunction = `function safeDashboardPlan(plan) {\n  return Object.freeze({\n    organicMetricBlockCount: plan.organicMetricBlockCount,\n    pendingStatisticsUpdateCount: plan.pendingStatisticsUpdateCount,\n    convergedStatisticsCount: plan.convergedStatisticsCount,\n    preservedSlicerCount: plan.preservedSlicerCount,\n    preservedWindowChartCount: plan.preservedWindowChartCount,\n    alreadyPreservedWindowChartCount: plan.alreadyPreservedWindowChartCount,\n    numberWindowChartCount: plan.numberWindowChartCount,\n    pendingWindowChartRebindCount: plan.pendingWindowChartRebindCount,\n    convergedWindowChartCount: plan.convergedWindowChartCount,\n    legacyReferenceCount: plan.legacyReferenceCount,\n    actions: plan.actions.map((action, index) => safeActionIdentity(action, index)),\n    windowChartActions: plan.windowChartActions.map(\n      (action, index) => safeWindowActionIdentity(action, index),\n    ),\n  });\n}\n`;
operator = replaceRegexOnce(
  operator,
  /function safeDashboardPlan\(plan\) \{[\s\S]*?\n\}\n(?=function readNamedField)/,
  safePlanFunction,
  'extend safe Dashboard plan evidence',
);
write(operatorPath, operator);

const projectBrainPath = 'docs/project-brain/report-metric-value-field-migration.md';
let projectBrain = read(projectBrainPath);
if (!projectBrain.includes('## v3.2 seven-window-chart correction')) {
  projectBrain += `\n## v3.2 seven-window-chart correction\n\nThe exported Integration Workspace Base revision 140 contains seven window charts, not four. Four Commerce/Chatwoot\ncolumns and all five Slicers already bind the preserved Select identity \`fldMlTUP3Z\`. Three Executive columns\n(\`Net Sales by Window\`, \`Ad Spend by Window\`, \`Organic Views by Window\`) bind Number \`fldbPCldTL\` and\nmust be PATCHed to the preserved Select before Number retirement. Recovery v3.2 requires the exact 17/5/7 inventory,\nupdates only those three reviewed \`column\` Blocks with immediate readback, keeps \`slicerPatchCount=0\`, and blocks\nRecord/Field mutation until no Number-window chart remains. Detailed contract:\n\n\`docs/tasks/lark-dashboard-window-chart-rebind-v3-2.md\`.\n`;
}
write(projectBrainPath, projectBrain);

const oldTaskPath = 'docs/tasks/lark-dashboard-field-identity-recovery-v3.md';
let oldTask = read(oldTaskPath);
if (!oldTask.includes('## v3.2 continuation')) {
  oldTask += `\n## v3.2 continuation\n\nThe v3.1 preview discovered seven window charts: four already bound to the preserved Select and three Executive\ncolumns bound to the retiring Number field. The field-identity recovery now continues under\n\`docs/tasks/lark-dashboard-window-chart-rebind-v3-2.md\`; no Slicer PATCH is introduced.\n`;
}
write(oldTaskPath, oldTask);

unlinkSync(selfPath);
console.log(JSON.stringify({
  ok: true,
  decision: 'LARK_DASHBOARD_WINDOW_CHART_V3_2_PATCH_APPLIED',
  branch,
  filesChanged: [
    helperPath,
    chartHelperPath,
    existingTestPath,
    operatorPath,
    projectBrainPath,
    oldTaskPath,
    'docs/tasks/lark-dashboard-window-chart-rebind-v3-2.md',
    'tests/scripts/lark-dashboard-window-chart-rebind-v3-2.test.js',
  ],
  temporaryPatchFileRemoved: true,
  remoteMutationCount: 0,
  production: 'BLOCKED',
}, null, 2));
