import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const publicLauncher = 'scripts/meta-history-2026-one-command.mjs';
const childFinalizer = 'scripts/meta-history-2026-finalizer.mjs';

test('Meta history public launcher delegates to the guarded child and exact evidence closeout', async () => {
  const source = await readFile(publicLauncher, 'utf8');
  assert.match(source, /meta-history-2026-finalizer\.mjs/u);
  assert.match(source, /reconcileMetaHistory2026Evidence/u);
  assert.match(source, /isRecoverableMetaHistoryFinalSummaryFailure/u);
  assert.match(source, /ensureRemoteAllFalse/u);
  assert.match(source, /META_HISTORY_2026_DECISION/u);
  assert.match(source, /process\.stdout\.write\(`\$\{META_HISTORY_2026_DECISION\}/u);
  assert.doesNotMatch(source, /larkSummary\.data\.larkVerified/u);
});

test('Meta history implementation child is not documented as the public command', async () => {
  const currentTask = await readFile('docs/current-task.md', 'utf8');
  const task = await readFile('docs/tasks/meta-history-2026-one-command-v1.md', 'utf8');
  assert.match(currentTask, /node scripts\/meta-history-2026-one-command\.mjs --execute/u);
  assert.match(task, /node scripts\/meta-history-2026-one-command\.mjs --execute/u);
  assert.doesNotMatch(currentTask, new RegExp(`node ${childFinalizer.replaceAll('.', '\\.')} --execute`, 'u'));
});

test('Meta history public launcher blocks blind resend and restores safe flags', async () => {
  const source = await readFile(publicLauncher, 'utf8');
  assert.match(source, /META_HISTORY_2026_CHILD_FAILED/u);
  assert.match(source, /automatic-all-false-restore/u);
  assert.match(source, /assertWooCommerce2026RemoteSafeFlags/u);
  assert.match(source, /active_queue_operations/u);
});
