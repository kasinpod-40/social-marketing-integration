import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const terminalEntrypoint = 'scripts/meta-history-2026-terminal.mjs';
const exactContinuationTerminal =
  'scripts/meta-history-2026-exact-plan-continuation-terminal.mjs';
const closeoutChild = 'scripts/meta-history-2026-one-command.mjs';
const finalizerChild = 'scripts/meta-history-2026-finalizer.mjs';
const d1Launcher = 'scripts/meta-d1-only-rollout-launcher.mjs';
const larkLauncher = 'scripts/meta-lark-parity-rollout-launcher.mjs';
const runtimeAuthority = 'scripts/lib/meta-history-runtime-authority.js';
const historicalTask = 'docs/tasks/meta-history-2026-one-command-v1.md';
const exactContinuationTask = 'docs/tasks/meta-history-exact-plan-continuation-v1.md';

test('Meta history closeout child delegates to the guarded finalizer and exact evidence closeout', async () => {
  const source = await readFile(closeoutChild, 'utf8');
  assert.match(source, /meta-history-2026-finalizer\.mjs/u);
  assert.match(source, /reconcileMetaHistory2026Evidence/u);
  assert.match(source, /isRecoverableMetaHistoryFinalSummaryFailure/u);
  assert.match(source, /ensureRemoteAllFalse/u);
  assert.match(source, /META_HISTORY_2026_DECISION/u);
  assert.match(source, /process\.stdout\.write\(`\$\{META_HISTORY_2026_DECISION\}/u);
  const cloudflareContext = source.slice(
    source.indexOf('async function resolveCloudflareContext'),
    source.indexOf('async function loadPrivateEnvironment'),
  );
  assert.match(cloudflareContext, /const explicitAccountId = optionalText\(env\.CLOUDFLARE_ACCOUNT_ID\)/u);
  assert.match(cloudflareContext, /whoamiOutput: explicitAccountId[\s\S]+\? null[\s\S]+wrangler', 'whoami'/u);
  assert.doesNotMatch(cloudflareContext, /const whoami = runText/u);
  assert.doesNotMatch(source, /larkSummary\.data\.larkVerified/u);
});

test('Meta history recovery task exposes only the exact-plan Terminal authority', async () => {
  const recoveryTask = await readFile(exactContinuationTask, 'utf8');
  const historical = await readFile(historicalTask, 'utf8');
  const terminal = await readFile(terminalEntrypoint, 'utf8');
  const exactTerminal = await readFile(exactContinuationTerminal, 'utf8');

  const exactTerminalPath =
    /scripts\/meta-history-2026-exact-plan-continuation-terminal\.mjs/u;
  const ordinaryTerminalCommand =
    /node scripts\/meta-history-2026-terminal\.mjs --execute/u;

  assert.match(recoveryTask, exactTerminalPath);
  assert.match(historical, ordinaryTerminalCommand);
  assert.match(terminal, /meta-history-2026-one-command\.mjs/u);
  assert.match(exactTerminal, /meta-history-2026-exact-plan-continuation\.mjs/u);

  assert.doesNotMatch(recoveryTask, ordinaryTerminalCommand);
  assert.doesNotMatch(
    recoveryTask,
    new RegExp(`node ${closeoutChild.replaceAll('.', '\\.')} --execute`, 'u'),
  );
  assert.doesNotMatch(
    recoveryTask,
    new RegExp(`node ${finalizerChild.replaceAll('.', '\\.')} --execute`, 'u'),
  );
});

test('Meta history Terminal materializes Shared required false flags and customer runtime authority before spawning the child', async () => {
  const terminal = await readFile(terminalEntrypoint, 'utf8');
  const executeStart = terminal.indexOf('async function executeTerminalEntry');
  const safeStart = terminal.indexOf('export function buildMetaHistorySafeEnvironment');
  const safeEnd = terminal.indexOf('export async function loadOrCreateIsoPlan');
  assert.ok(executeStart >= 0 && safeStart > executeStart && safeEnd > safeStart);
  const childExecution = terminal.slice(executeStart, safeStart);
  const safeEnvironment = terminal.slice(safeStart, safeEnd);
  assert.match(terminal, /META_D1_ONLY_REQUIRED_FALSE_FLAGS/u);
  assert.match(terminal, /applyMetaHistoryCustomerRuntimeEnvironment/u);
  assert.match(childExecution, /const childEnvironment = buildMetaHistorySafeEnvironment\(process\.env\)/u);
  assert.match(childExecution, /env: childEnvironment/u);
  assert.doesNotMatch(childExecution, /env: process\.env/u);
  assert.match(safeEnvironment, /applyMetaHistoryCustomerRuntimeEnvironment\(env\)/u);
  assert.match(safeEnvironment, /for \(const key of META_D1_ONLY_REQUIRED_FALSE_FLAGS\)/u);
  assert.match(safeEnvironment, /result\[key\] = 'false'/u);
});

test('Targeted Meta finalizer materializes the same all-false runtime authority before read-only preflight', async () => {
  const finalizer = await readFile(finalizerChild, 'utf8');
  assert.match(finalizer, /applyMetaHistoryCustomerRuntimeEnvironment/u);
  assert.match(
    finalizer,
    /closeExecutionFlags\(applyMetaHistoryCustomerRuntimeEnvironment\(\{/u,
  );
  assert.match(finalizer, /fresh-read-only-validation/u);
});

test('Meta runtime authority materializes customer mappings and the complete Shared safe-config set', async () => {
  const source = await readFile(runtimeAuthority, 'utf8');
  assert.match(source, /META_D1_ONLY_REQUIRED_FALSE_FLAGS/u);
  assert.match(source, /META_HISTORY_REQUIRED_FALSE_CONFIG_ENV/u);
  assert.match(source, /META_HISTORY_RUNTIME_CONFIG_ENV/u);
  assert.match(source, /Object\.entries\(META_HISTORY_RUNTIME_CONFIG_ENV\)/u);
  assert.match(source, /values\.length !== stringValues\.length/u);
  assert.match(source, /\|true\|false\)/u);
  assert.doesNotMatch(source, /MKT_WOOCOMMERCE_D1_WRITE_ENABLED:\s*'false'/u);
});

test('Meta D1 and Lark launchers materialize purpose-specific private reviewed runtime configs', async () => {
  const [d1, lark] = await Promise.all([
    readFile(d1Launcher, 'utf8'),
    readFile(larkLauncher, 'utf8'),
  ]);
  for (const source of [d1, lark]) {
    assert.match(source, /applyMetaHistoryCustomerRuntimeEnvironment\(process\.env\)/u);
    assert.match(source, /join\(dirname\(originalConfig\), 'wrangler\.meta-history\.runtime\.jsonc'\)/u);
    assert.match(source, /chmod\(runtimeConfig, 0o600\)/u);
    assert.match(source, /MKT_META_D1_ONLY_COMPAT_ORIGINAL_CONFIG: runtimeConfig/u);
    assert.doesNotMatch(source, /join\(tempDirectory, 'wrangler\.meta-history\.runtime/u);
  }
  assert.match(d1, /materializeMetaHistoryCustomerRuntimeConfig/u);
  assert.match(d1, /materializeMetaHistoryCustomerRuntimeConfig\(sourceText\)/u);
  assert.match(lark, /materializeMetaHistoryLarkRuntimeConfig/u);
  assert.match(
    lark,
    /materializeMetaHistoryLarkRuntimeConfig\(sourceText, runtimeEnvironment\)/u,
  );
  assert.match(d1, /MKT_META_D1_ONLY_WRANGLER_CONFIG: runtimeConfig/u);
  assert.match(d1, /MKT_META_D1_ONLY_OPERATOR_PATH/u);
  assert.match(lark, /MKT_META_LARK_WRANGLER_CONFIG: runtimeConfig/u);
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
