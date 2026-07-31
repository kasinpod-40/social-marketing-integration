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

test('Meta history closeout child blocks blind resend and restores safe flags', async () => {
  const source = await readFile(closeoutChild, 'utf8');
  assert.match(source, /META_HISTORY_2026_CHILD_FAILED/u);
  assert.match(source, /automatic-all-false-restore/u);
  assert.match(source, /assertWooCommerce2026RemoteSafeFlags/u);
  assert.match(source, /active_queue_operations/u);
});
