#!/usr/bin/env node

import { readFile, unlink, writeFile } from 'node:fs/promises';

const target = 'scripts/dev/apply-lark-dashboard-statistics-v3-3-patch.mjs';
const source = await readFile(target, 'utf8');

const oldBlock = `nextOperator = replaceExact(
  nextOperator,
  "      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\\n      slicerPatch: false,",
  "      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\\n      responseMetadataRemovalCount: rewrite.filterResponseMetadataRemovalCount,\\n      requestFilter: rewrite.patch.filter ?? null,\\n      slicerPatch: false,",
  'safe request evidence',
);`;

const newBlock = `nextOperator = replaceExact(
  nextOperator,
  "    await writePrivateJson(actionPath(attemptRoot, index, 'before'), {\\n      ...currentAction,\\n      beforeChecksum,\\n      targetChecksum,\\n      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\\n      slicerPatch: false,\\n    });",
  "    await writePrivateJson(actionPath(attemptRoot, index, 'before'), {\\n      ...currentAction,\\n      beforeChecksum,\\n      targetChecksum,\\n      changedTopLevelKeys: Object.keys(rewrite.patch).sort(),\\n      responseMetadataRemovalCount: rewrite.filterResponseMetadataRemovalCount,\\n      requestFilter: rewrite.patch.filter ?? null,\\n      slicerPatch: false,\\n    });",
  'Statistics safe request evidence',
);`;

const occurrences = source.split(oldBlock).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected one patch-script anchor block, found ${occurrences}`);
}

await writeFile(target, source.replace(oldBlock, newBlock));
await unlink(new URL(import.meta.url));

console.log(JSON.stringify({
  ok: true,
  decision: 'LARK_DASHBOARD_V3_3_SAFE_EVIDENCE_ANCHOR_FIXED',
  statisticsAnchor: 'actionPath',
  temporaryAnchorFixDeleted: true,
}, null, 2));
