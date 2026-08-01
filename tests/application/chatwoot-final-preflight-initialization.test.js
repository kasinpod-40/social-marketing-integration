import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operatorUrl = new URL(
  '../../scripts/chatwoot-final-30d-daily-uat.mjs',
  import.meta.url,
);

test('Final operator keeps the preflight function callable without TDZ shadowing', async () => {
  const source = await readFile(operatorUrl, 'utf8');

  assert.match(source, /async function preflight\(target\)/u);
  assert.match(source, /const preflightResult = await preflight\(target\)/u);
  assert.doesNotMatch(source, /const preflight = await preflight\(target\)/u);
  assert.match(source, /evidence\(target, 'read-only-preflight', preflightResult\)/u);
  assert.match(source, /baselineVersion: preflightResult\.activeVersion/u);
});

test('new runs preserve preflight ordering while resume owns Safe restore before preflight', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  const resumeRestoreIndex = source.indexOf('if (resume) {\n    // The interrupted controller');
  const preflightIndex = source.indexOf('const preflightResult = await preflight(target)');
  const evidenceIndex = source.indexOf("await evidence(target, 'read-only-preflight', preflightResult)");
  const backupIndex = source.indexOf('const backup = await d1Backup(target)');
  const deployIndex = source.indexOf('const activeVersion = resume');
  const restoreIndex = source.indexOf('if (!resume) {\n    safeRestore = { target, baselineVersion: preflightResult.activeVersion, activeVersion }');

  assert.ok(resumeRestoreIndex >= 0);
  assert.ok(resumeRestoreIndex < preflightIndex);
  assert.ok(preflightIndex >= 0);
  assert.ok(evidenceIndex > preflightIndex);
  assert.ok(backupIndex > evidenceIndex);
  assert.ok(deployIndex > backupIndex);
  assert.ok(restoreIndex > deployIndex);
});
