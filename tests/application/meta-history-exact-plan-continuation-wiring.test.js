import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const TERMINAL = new URL(
  '../../scripts/meta-history-2026-exact-plan-continuation-terminal.mjs',
  import.meta.url,
);
const SOURCE = new URL(
  '../../scripts/meta-history-2026-exact-plan-continuation.mjs',
  import.meta.url,
);
const LOCAL_VERIFIER = new URL(
  '../../scripts/verify-meta-history-exact-plan-continuation-local.mjs',
  import.meta.url,
);
const META_WORKFLOW = new URL(
  '../../.github/workflows/meta-end-to-end-verification.yml',
  import.meta.url,
);

test('exact-plan public Terminal supplies the retained private Safe config', async () => {
  const source = await readFile(TERMINAL, 'utf8');

  assert.match(source, /wrangler\.meta-history\.safe\.jsonc/u);
  assert.match(source, /MKT_META_D1_ONLY_WRANGLER_CONFIG:\s*retainedSafeConfig/u);
  assert.match(source, /MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG:\s*retainedSafeConfig/u);
  assert.match(source, /meta-history-2026-exact-plan-continuation\.mjs/u);
  assert.doesNotMatch(source, /meta-lark-parity-rollout-launcher\.mjs/u);
  assert.doesNotMatch(source, /meta-d1-only-rollout-launcher\.mjs/u);
});

test('exact-plan Terminal requires confirmation before any local D1 summary write', async () => {
  const source = await readFile(TERMINAL, 'utf8');
  const confirmation = source.indexOf(
    'assertMetaHistoryExactContinuationConfirmation(process.env)',
  );
  const materialization = source.indexOf('await ensureRetainedD1Summary()');
  const cloneExclude = source.indexOf('await ensureIsolatedCloneGitExclude()');
  const child = source.indexOf('const child = spawnSync(');

  assert.ok(confirmation >= 0);
  assert.ok(materialization > confirmation);
  assert.ok(cloneExclude > materialization);
  assert.ok(child > cloneExclude);
  assert.match(source, /stage = 'confirm-local-summary-materialization'/u);
  assert.match(source, /stage = 'prepare-isolated-clone-git-exclude'/u);
});

test('exact-plan Terminal materializes from a full or valid preflight-anchored local chain', async () => {
  const source = await readFile(TERMINAL, 'utf8');

  assert.match(source, /materializeRetainedMetaD1Summary/u);
  assert.match(source, /META_D1_ONLY_OPERATOR_PHASES\.slice\(0, -1\)/u);
  assert.match(source, /fullPhases\.slice\(1\)/u);
  assert.match(source, /planEvidencePresent/u);
  assert.match(source, /evidenceChainStartPhase/u);
  assert.match(source, /validateMetaD1OnlySummaryForLark/u);
  assert.match(source, /META_HISTORY_RETAINED_D1_SUMMARY_MATERIALIZED/u);
  assert.match(source, /remoteProviderRequestCount:\s*0/u);
  assert.match(source, /remoteQueueSendCount:\s*0/u);
  assert.match(source, /remoteD1MutationCount:\s*0/u);
  assert.match(source, /remoteLarkMutationCount:\s*0/u);
  assert.match(source, /workerDeploymentCount:\s*0/u);
  assert.doesNotMatch(source, /fetch\s*\(/u);
  assert.doesNotMatch(source, /'wrangler'/u);
  assert.doesNotMatch(source, /meta-d1-only-rollout-operator\.mjs/u);
  assert.doesNotMatch(source, /send-one-d1-only/u);
  assert.doesNotMatch(source, /resend-same-operation/u);
});

test('Meta verification preserves the PR merge base for diff hygiene', async () => {
  const source = await readFile(META_WORKFLOW, 'utf8');

  assert.match(source, /fetch-depth:\s*0/u);
  assert.match(
    source,
    /git fetch --no-tags --prune origin \+refs\/heads\/main:refs\/remotes\/origin\/main/u,
  );
  assert.match(source, /git merge-base origin\/main HEAD >\/dev\/null/u);
  assert.match(source, /git diff --check origin\/main\.\.\.HEAD/u);
  assert.doesNotMatch(source, /git fetch origin main --depth=1/u);
});

test('exact-plan continuation is guarded and does not replay Facebook Provider or D1 Queue', async () => {
  const source = await readFile(SOURCE, 'utf8');

  assert.match(source, /validateStableMetaHistoryFacebookBoundary/u);
  assert.match(source, /validateMetaD1OnlySummaryForLark/u);
  assert.match(source, /continue-facebook-lark-same-operation/u);
  assert.match(source, /meta-lark-parity-rollout-launcher\.mjs/u);
  assert.match(source, /MKT_META_HISTORY_LARK_LAUNCHER_PATH/u);
  assert.match(source, /verify-late-completion/u);
  assert.match(source, /readRestoredLarkEvidenceTarget/u);
  assert.match(source, /lark-preflight\.json/u);
  assert.match(source, /verify-late-completion\.target-drift/u);
  assert.match(source, /restoredLateEvidence\?\.expectedActiveVersion \?\? activeVersion/u);
  assert.match(source, /\[larkLauncherPath, `--phase=\$\{phase\}`, '--execute'\]/u);
  assert.match(source, /meta-history-2026-one-command\.mjs/u);
  assert.match(source, /providerReplayForFacebook:\s*false/u);
  assert.match(source, /d1QueueResendForFacebook:\s*false/u);
  assert.match(source, /automaticAllFalseRestore:\s*true/u);
  assert.match(source, /META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE/u);

  assert.doesNotMatch(source, /meta-read-only-validation-operator\.mjs/u);
  assert.doesNotMatch(source, /meta-d1-only-rollout-launcher\.mjs/u);
  assert.doesNotMatch(source, /send-one-d1-only/u);
});

test('exact-plan continuation completes Facebook Lark before resuming the retained plan', async () => {
  const source = await readFile(SOURCE, 'utf8');
  const lark = source.indexOf("stage = 'continue-facebook-lark-same-operation'");
  const resume = source.indexOf("stage = 'resume-retained-meta-plan'");
  const final = source.indexOf("stage = 'verify-final-safe-summary'");

  assert.ok(lark >= 0);
  assert.ok(resume > lark);
  assert.ok(final > resume);
  assert.match(source, /Queue acceptance is uncertain; blind resend is blocked/u);
  assert.match(source, /restore-all-false/u);
  assert.match(source, /verify-restore/u);
});

test('isolated retained-Head runtime injections use an exact child-only Git exclude', async () => {
  const [terminal, source] = await Promise.all([
    readFile(TERMINAL, 'utf8'),
    readFile(SOURCE, 'utf8'),
  ]);

  assert.match(source, /symlink\(originalOutputs, join\(cloneRoot, 'outputs'\), 'dir'\)/u);
  assert.match(source, /copyFile\(sourceConfigPath, join\(cloneRoot, 'wrangler\.sync\.jsonc'\)\)/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.match(terminal, /isolated-clone\.git-exclude/u);
  assert.match(terminal, /ISOLATED_CLONE_GIT_EXCLUDE_PATTERNS/u);
  assert.match(terminal, /'\/outputs'/u);
  assert.match(terminal, /'\/wrangler\.sync\.jsonc'/u);
  assert.match(terminal, /GIT_CONFIG_COUNT:\s*'1'/u);
  assert.match(terminal, /GIT_CONFIG_KEY_0:\s*'core\.excludesFile'/u);
  assert.match(terminal, /GIT_CONFIG_VALUE_0:\s*isolatedCloneGitExclude/u);
  assert.match(terminal, /META_HISTORY_EXACT_CONTINUATION_GIT_CONFIG_ENV_INVALID/u);
  assert.match(terminal, /observed !== expected/u);
  assert.doesNotMatch(source, /status\.showUntrackedFiles/u);
  assert.doesNotMatch(source, /--untracked-files=no/u);
  assert.doesNotMatch(terminal, /core\.excludesFile.*\.gitignore/u);
});

test('local verifier runs repository-only gates and no Live continuation command', async () => {
  const source = await readFile(LOCAL_VERIFIER, 'utf8');

  assert.match(source, /EXPECTED_META_CONTINUATION_HEAD/u);
  assert.match(source, /npm', \['ci'\]/u);
  assert.match(source, /npm', \['run', 'check'\]/u);
  assert.match(source, /npm', \['test'\]/u);
  assert.match(source, /test:report-reliability/u);
  assert.match(source, /audit-level=high|--audit-level=high/u);
  assert.match(source, /deploy:dry-run/u);
  assert.match(source, /remoteProviderRequestCount:\s*0/u);
  assert.match(source, /remoteQueueSendCount:\s*0/u);
  assert.match(source, /remoteD1MutationCount:\s*0/u);
  assert.match(source, /remoteLarkMutationCount:\s*0/u);
  assert.match(source, /workerDeploymentCount:\s*0/u);

  assert.doesNotMatch(source, /meta-history-2026-exact-plan-continuation-terminal\.mjs/u);
  assert.doesNotMatch(source, /CONFIRM_META_HISTORY_EXACT_CONTINUATION/u);
  assert.doesNotMatch(source, /wrangler', 'd1', 'execute/u);
  assert.doesNotMatch(source, /--remote/u);
});
