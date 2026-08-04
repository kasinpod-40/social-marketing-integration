import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(process.cwd());
const launcherPath = resolve(
  repositoryRoot,
  'scripts/meta-k3-partial-staging-one-command.mjs',
);
const readinessHook = resolve(
  repositoryRoot,
  'scripts/meta-k3-preview-alias-readiness-hook.mjs',
);

test('K3 one-command plan is exact and mutation-free', () => {
  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.target, 'chemistry_k3');
  assert.equal(
    plan.operationId,
    'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9',
  );
  assert.equal(
    plan.branch,
    'integration/all-meta-end-to-end-completion-v1',
  );
  assert.equal(plan.approvedHeadEnv, 'MKT_META_K3_APPROVED_HEAD');
  assert.deepEqual(plan.confirmation, {
    envName: 'CONFIRM_META_K3_ONE_COMMAND',
    value: 'RUN_EXACT_META_K3_ONE_COMMAND',
  });
  assert.equal(
    plan.previewWindow,
    'same_proven_k2_enable_probe_finalize_restore_sequence',
  );
  assert.equal(plan.safePreviewBootstrapRequired, true);
  assert.equal(plan.safeRouteProbeRequiredBeforeFinalizer, true);
  assert.equal(plan.readinessPreloadOwnedByLauncher, true);
  assert.equal(plan.readinessPreloadAbsolute, true);
  assert.equal(plan.userNodeOptionsRequired, false);
  assert.equal(plan.dedicatedFinalizer, true);
  assert.equal(plan.loaderUsed, false);
  assert.equal(plan.queueMessageCount, 0);
  assert.equal(plan.lifecycleSqlRepairCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('K3 one-command delegates to the proven Preview window before finalizer', () => {
  const source = readFileSync(launcherPath, 'utf8');

  assert.match(source, /MKT_META_K3_APPROVED_HEAD/u);
  assert.match(source, /CONFIRM_META_K3_ONE_COMMAND/u);
  assert.match(source, /RUN_EXACT_META_K3_ONE_COMMAND/u);
  assert.match(source, /meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9/u);
  assert.match(source, /meta-k3-partial-staging-preview-recovery\.mjs/u);
  assert.match(source, /meta-k3-preview-alias-readiness-hook\.mjs/u);
  assert.match(source, /pathToFileURL\(readinessHook\)\.href/u);
  assert.match(source, /NODE_OPTIONS:\s*readinessNodeOptions/u);
  assert.match(source, /MKT_META_K3_PREVIEW_ALIAS_READINESS/u);
  assert.match(source, /WAIT_FOR_ATTESTED_ACTIVE_PREVIEW/u);
  assert.match(source, /CONFIRM_META_K3_PREVIEW_RECOVERY/u);
  assert.match(source, /RUN_EXACT_META_K3_PREVIEW_RECOVERY/u);
  assert.match(source, /readAccountWorkersDevSubdomain/u);
  assert.match(source, /verify-restore\.json/u);
  assert.match(source, /safeRouteProbeRequiredBeforeFinalizer: true/u);
  assert.match(source, /readinessPreloadOwnedByLauncher: true/u);
  assert.match(source, /readinessPreloadAbsolute: true/u);
  assert.match(source, /userNodeOptionsRequired: false/u);
  assert.match(source, /dedicatedFinalizer: true/u);
  assert.match(source, /loaderUsed: false/u);
  assert.match(source, /queueMessageCount:\s*0/u);
  assert.match(source, /lifecycleSqlRepairCount:\s*0/u);
  assert.match(source, /workerDeploymentCount:\s*0/u);
  assert.doesNotMatch(source, /meta-k3-partial-staging-preview-finalizer\.mjs/u);
  assert.doesNotMatch(source, /MKT_META_K3_EXACT_RECOVERY_URL/u);
  assert.doesNotMatch(source, /experimental-loader/u);
  assert.doesNotMatch(source, /meta-k3-exact-recovery-loader/u);
  assert.doesNotMatch(
    source,
    /meta-chemistry-k2-history-20260701-20260731-f741090d1d8a/u,
  );
  assert.doesNotMatch(source, /queue\.send\(/u);
  assert.doesNotMatch(source, /wrangler\s+deploy/u);
});

test('K3 readiness preload resolves from a nested package working directory', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'meta-k3-readiness-'));
  const nested = resolve(root, 'node_modules', 'workerd');
  mkdirSync(nested, { recursive: true });
  try {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: nested,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(readinessHook).href}`,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      result.stderr,
      /node_modules\/workerd\/scripts\/meta-k3-preview-alias-readiness-hook\.mjs/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
