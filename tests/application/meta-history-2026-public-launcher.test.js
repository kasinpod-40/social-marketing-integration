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

test('Meta history Terminal materializes Shared required false flags before spawning the child', async () => {
  const terminal = await readFile(terminalEntrypoint, 'utf8');
  const start = terminal.indexOf('export function buildMetaHistorySafeEnvironment');
  const end = terminal.indexOf('export async function loadOrCreateIsoPlan');
  assert.ok(start >= 0 && end > start);
  const safeEnvironment = terminal.slice(start, end);
  assert.match(terminal, /META_D1_ONLY_REQUIRED_FALSE_FLAGS/u);
  assert.match(terminal, /const childEnvironment = buildMetaHistorySafeEnvironment\(process\.env\)/u);
  assert.match(terminal, /env: childEnvironment/u);
  assert.doesNotMatch(terminal, /env: process\.env/u);
  assert.match(safeEnvironment, /for \(const key of META_D1_ONLY_REQUIRED_FALSE_FLAGS\)/u);
  assert.match(safeEnvironment, /result\[key\] = 'false'/u);
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

test('Meta history Cloudflare readiness resolves stable account authority before optional whoami', async () => {
  const source = await readFile(finalizerChild, 'utf8');
  const start = source.indexOf('async function resolveCloudflareContext');
  const end = source.indexOf('async function assertRemoteSafe');
  assert.ok(start >= 0 && end > start);
  const context = source.slice(start, end);
  const staticResolution = context.indexOf('whoamiOutput: null');
  const whoamiFallback = context.indexOf("runText('npx', ['wrangler', 'whoami', '--json'], env)");
  assert.ok(staticResolution >= 0);
  assert.ok(whoamiFallback > staticResolution);
  assert.match(context, /const accountInput = \{[\s\S]+explicitAccountId: env\.CLOUDFLARE_ACCOUNT_ID[\s\S]+configText/u);
  assert.match(context, /error\?\.code !== 'WOOCOMMERCE_FINAL_WHOAMI_JSON_INVALID'/u);
  assert.equal((context.match(/wrangler', 'whoami'/gu) ?? []).length, 1);
  assert.doesNotMatch(context, /const whoami = runText/u);
});

test('Meta history finalizer proves pinned continuity without legacy local artifacts', async () => {
  const source = await readFile(finalizerChild, 'utf8');
  assert.match(source, /verify-pinned-facebook-continuity/u);
  assert.match(source, /createMetaHistoryPinnedContinuity/u);
  assert.match(source, /pinned-facebook-continuity\.json/u);
  assert.match(source, /readMetaLarkSummaryCompletion/u);
  assert.doesNotMatch(source, /resolvePinnedMetaFiles/u);
  assert.doesNotMatch(source, /resumePinnedFinalizer/u);
  assert.doesNotMatch(source, /MKT_META_FINALIZE_CLONE/u);
  assert.doesNotMatch(source, /MKT_META_FINALIZE_SESSION_FILE/u);
  assert.doesNotMatch(source, /MKT_META_FINALIZE_OVERLAY/u);
  assert.doesNotMatch(source, /MKT_META_FINALIZER_FILE/u);
  assert.doesNotMatch(source, /\.data\?\.larkVerified/u);
});
