import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const terminalEntrypoint = 'scripts/meta-history-2026-terminal.mjs';
const closeoutChild = 'scripts/meta-history-2026-one-command.mjs';
const finalizerChild = 'scripts/meta-history-2026-finalizer.mjs';

test('Meta history closeout child delegates to the guarded finalizer and exact evidence closeout', async () => {
  const source = await readFile(closeoutChild, 'utf8');
  assert.match(source, /meta-history-2026-finalizer\.mjs/u);
  assert.match(source, /reconcileMetaHistory2026Evidence/u);
  assert.match(source, /isRecoverableMetaHistoryFinalSummaryFailure/u);
  assert.match(source, /ensureRemoteAllFalse/u);
  assert.match(source, /META_HISTORY_2026_DECISION/u);
  assert.match(source, /process\.stdout\.write\(`\$\{META_HISTORY_2026_DECISION\}/u);
  assert.doesNotMatch(source, /larkSummary\.data\.larkVerified/u);
});

test('Meta history docs expose only the ISO-plan Terminal entrypoint', async () => {
  const currentTask = await readFile('docs/current-task.md', 'utf8');
  const task = await readFile('docs/tasks/meta-history-2026-one-command-v1.md', 'utf8');
  const terminal = await readFile(terminalEntrypoint, 'utf8');
  assert.match(currentTask, /node scripts\/meta-history-2026-terminal\.mjs --execute/u);
  assert.match(task, /node scripts\/meta-history-2026-terminal\.mjs --execute/u);
  assert.match(terminal, /meta-history-2026-one-command\.mjs/u);
  assert.doesNotMatch(
    currentTask,
    new RegExp(`node ${closeoutChild.replaceAll('.', '\\.')} --execute`, 'u'),
  );
  assert.doesNotMatch(
    currentTask,
    new RegExp(`node ${finalizerChild.replaceAll('.', '\\.')} --execute`, 'u'),
  );
});

test('Meta history closeout restores only proven active Worker flags and uses active Work queue state', async () => {
  const source = await readFile(closeoutChild, 'utf8');
  const finalizer = await readFile(finalizerChild, 'utf8');
  assert.match(source, /META_HISTORY_2026_CHILD_FAILED/u);
  assert.match(source, /automatic-all-false-restore/u);
  assert.match(source, /error\?\.code !== 'WOOCOMMERCE_2026_COMPLETION_REMOTE_FLAGS_ACTIVE'/u);
  assert.match(source, /inspectWorkerSafe/u);
  assert.match(source, /inspectReliabilityIdle/u);
  assert.match(source, /queue_operation_attempts q[\s\S]+JOIN sync_work_runs w[\s\S]+w\.lifecycle_status = 'active'/u);
  assert.doesNotMatch(source, /sync_runs WHERE status IN \('queued', 'running'\)/u);
  assert.match(finalizer, /queue_operation_attempts q[\s\S]+JOIN sync_work_runs w[\s\S]+w\.lifecycle_status = 'active'/u);
  assert.doesNotMatch(finalizer, /sync_runs WHERE status IN \('queued', 'running'\)/u);
});

test('Meta history source config may be readable while generated execution config stays private', async () => {
  const source = await readFile(finalizerChild, 'utf8');
  assert.match(source, /readRegularSourceText\(sourceConfigPath, 'Meta Wrangler config'\)/u);
  assert.match(source, /injectMetaHistoryConfig\(sourceConfigText, undefined, \{[\s\S]+baseDirectory: repositoryRoot/u);
  assert.match(source, /writePrivateText\(safeConfigPath, safeConfigText\)/u);
  assert.doesNotMatch(source, /assertPrivateRegularFile\(sourceConfigPath, 'Meta Wrangler config'\)/u);
});
