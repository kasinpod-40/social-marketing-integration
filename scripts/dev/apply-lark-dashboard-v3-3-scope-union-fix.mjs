#!/usr/bin/env node

import { readFile, unlink, writeFile } from 'node:fs/promises';

const files = {
  identity: 'scripts/lib/lark-dashboard-field-identity-recovery-v3.js',
  identityTest: 'tests/scripts/lark-dashboard-field-identity-recovery-v3.test.js',
  task: 'docs/tasks/lark-dashboard-statistics-request-contract-v3-3.md',
  brain: 'docs/project-brain/report-metric-value-field-migration.md',
};

await replaceFile(files.identity, [
  [
    "  'base:dashboard:read',\n  'base:dashboard:update',\n  'base:field:read',",
    "  'base:dashboard:read',\n  'base:dashboard:update',\n  'base:block:read',\n  'base:block:update',\n  'base:field:read',",
    'runtime scope union',
  ],
]);

await replaceFile(files.identityTest, [
  [
    "    'base:dashboard:read',\n    'base:dashboard:update',\n    'base:field:read',",
    "    'base:dashboard:read',\n    'base:dashboard:update',\n    'base:block:read',\n    'base:block:update',\n    'base:field:read',",
    'scope test union',
  ],
  [
    "  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:update'), false);\n  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:read'), false);",
    "  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:update'), true);\n  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:read'), true);",
    'scope-preservation assertions',
  ],
]);

await replaceFile(files.task, [
  [
    "The required scope contract also named `base:block:update`; Dashboard chart Block mutation belongs to the Dashboard update authority and must declare `base:dashboard:update`.",
    "The required scope contract named the component authorities but omitted `base:dashboard:update`. Official Lark scope metadata still lists `base:block:read` and `base:block:update`, so v3.3 adds the Dashboard authority while retaining the component scopes until the bounded Live probe confirms endpoint enforcement.",
    'task scope diagnosis',
  ],
  [
    "- Replace obsolete Block scopes with:\n  - `base:dashboard:read`;\n  - `base:dashboard:update`.",
    "- Declare the fail-closed union required by the reviewed request path:\n  - `base:dashboard:read`;\n  - `base:dashboard:update`;\n  - `base:block:read`;\n  - `base:block:update`.",
    'task scope contract',
  ],
]);

await replaceFile(files.brain, [
  [
    "`condition_id`, `field_type`, `condition_omitted` and response `type`. It declares `base:dashboard:update`, emits\na private `statistics-request-plan.json`, and provides a bounded one-Block probe for `Baseline Coverage Rate`.",
    "`condition_id`, `field_type`, `condition_omitted` and response `type`. It adds `base:dashboard:update` while\nretaining `base:block:read/update`, emits a private `statistics-request-plan.json`, and provides a bounded\none-Block probe for `Baseline Coverage Rate`.",
    'project-brain scope contract',
  ],
]);

await unlink(new URL(import.meta.url));

process.stdout.write(`${JSON.stringify({
  ok: true,
  decision: 'LARK_DASHBOARD_V3_3_SCOPE_UNION_FIX_APPLIED',
  changedFiles: Object.values(files),
  temporaryPatchDeleted: true,
}, null, 2)}\n`);

async function replaceFile(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [before, after, label] of replacements) {
    source = replaceExact(source, before, after, label);
  }
  await writeFile(path, source);
}

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Non-unique patch anchor: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
