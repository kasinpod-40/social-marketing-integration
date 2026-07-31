#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(selfPath), '..', '..');
const expectedBranch = 'hotfix/lark-dashboard-window-chart-rebind-v3-2';
const branch = execFileSync('git', ['branch', '--show-current'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (branch !== expectedBranch) {
  throw new Error(`Expected branch ${expectedBranch}; got ${branch || '(detached)'}`);
}

const operatorPath = resolve(root, 'scripts/lark-dashboard-field-identity-recovery-v3.mjs');
let source = readFileSync(operatorPath, 'utf8');

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  "import {\n  EXECUTIVE_NUMBER_WINDOW_CHART_NAMES,\n  hasNumberWindowReference,",
  "import {\n  EXECUTIVE_DASHBOARD_NAME,\n  EXECUTIVE_NUMBER_WINDOW_CHART_NAMES,\n  assertReviewedExecutiveWindowChartSet,\n  hasNumberWindowReference,",
  'import exact Executive chart-set contract',
);

replaceOnce(
  "  let alreadyPreservedWindowChartCount = 0;\n  let numberWindowChartCount = 0;",
  "  let alreadyPreservedWindowChartCount = 0;\n  let numberWindowChartCount = 0;\n  const executiveWindowChartNames = [];",
  'collect Executive window chart identities',
);

replaceOnce(
  "      } else if (type === 'column') {\n        if (hasWindowLegacy || (hasCanonicalWindow && canonicalWindowTargetsPreserved)) {",
  "      } else if (type === 'column') {\n        if (dashboard.name === EXECUTIVE_DASHBOARD_NAME) {\n          executiveWindowChartNames.push(block.name);\n        }\n        if (hasWindowLegacy || (hasCanonicalWindow && canonicalWindowTargetsPreserved)) {",
  'collect every Executive window-bound Column in initial and resumed states',
);

replaceOnce(
  "  const preservedWindowChartCount = alreadyPreservedWindowChartCount + numberWindowChartCount;\n  const pendingNames = windowChartActions.map((action) => action.blockName);",
  "  const reviewedExecutiveWindowChartNames =\n    assertReviewedExecutiveWindowChartSet(executiveWindowChartNames);\n  const preservedWindowChartCount = alreadyPreservedWindowChartCount + numberWindowChartCount;\n  const pendingNames = windowChartActions.map((action) => action.blockName);",
  'assert exact Executive chart set before plan authorization',
);

replaceOnce(
  "    convergedWindowChartCount: preservedWindowChartCount - windowChartActions.length,\n    legacyReferenceCount,",
  "    convergedWindowChartCount: preservedWindowChartCount - windowChartActions.length,\n    reviewedExecutiveWindowChartCount: reviewedExecutiveWindowChartNames.length,\n    reviewedExecutiveWindowChartNames,\n    legacyReferenceCount,",
  'expose reviewed Executive chart-set evidence',
);

replaceOnce(
  "    convergedWindowChartCount: plan.convergedWindowChartCount,\n    legacyReferenceCount: plan.legacyReferenceCount,",
  "    convergedWindowChartCount: plan.convergedWindowChartCount,\n    reviewedExecutiveWindowChartCount: plan.reviewedExecutiveWindowChartCount,\n    reviewedExecutiveWindowChartNames: plan.reviewedExecutiveWindowChartNames,\n    legacyReferenceCount: plan.legacyReferenceCount,",
  'retain reviewed Executive chart-set evidence in safe plans',
);

writeFileSync(operatorPath, source, 'utf8');
unlinkSync(selfPath);
process.stdout.write('Applied reviewed Executive window-chart set enforcement and removed temporary patch.\n');
