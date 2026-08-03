import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  OPERATOR_TERMINAL_EXIT_CODES,
} from '../../scripts/lib/operator-terminal-reliability.js';

const HEAD = 'd'.repeat(40);
const ACCEPTANCE_PATH = resolve('scripts/multichannel-report-live-closure-acceptance.mjs');
const CONFIG_PATH = resolve('wrangler.sync.jsonc');

function parseSingleJson(value) {
  return JSON.parse(String(value ?? '').trim());
}

function reviewedReadiness() {
  return {
    contractVersion: 'youtube_report_remote_readiness_reviewed_terminal_v1',
    ok: true,
    evidence: {
      target: {
        environment: 'development',
        customerProfile: 'integration_workspace',
        accountKey: 'chemistry_k',
        platformScope: 'youtube',
      },
      repository: { branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD },
      runtime: {
        allExecutionFlagsFalse: true,
        activeReportWorkCount: 0,
        activeReportLockCount: 0,
        openReportDlqCount: 0,
        openReportCriticalAlertCount: 0,
      },
      source: {
        contentCoverageStatus: 'completed',
        failureCount: 0,
        contentEntityCount: 837,
        watermarkDate: '2026-08-01',
        sourceWatermark: 'youtube-watermark-2026-08-01',
        reportingTimezone: 'Asia/Bangkok',
      },
    },
    assessment: {
      readyForLive: true,
      repositoryReady: true,
      sourceReady: true,
      windows: [1, 3, 7, 30].map((windowDays) => ({
        windowDays,
        action: 'create_materialization',
      })),
    },
  };
}

function reviewedHandoff() {
  return {
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    liveMaterializationAuthorized: true,
    repository: { branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD },
    metaRemoteLock: { released: true, auditHead: HEAD },
    youtubeIdentity: { accountId: 'UCAwEENovvqZWosKhJWTS5Kg' },
    youtubeReadiness: reviewedReadiness(),
    closeoutAuthority: {
      operator: 'scripts/report-runtime-closeout-operator.mjs',
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope: 'youtube',
      capability: 'organic',
    },
  };
}

function finalizerEvidence() {
  return {
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', clean: true, head: HEAD },
    gates: Array.from({ length: 6 }, (_, index) => ({
      command: `gate-${index + 1}`,
      status: 'pass',
    })),
    schema: { readbackActions: 0, conflicts: 0 },
    settings: {
      canonicalActive: REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
      activeLegacySettings: 0,
      readbackCreates: 0,
      readbackUpdates: 0,
    },
    runtime: {
      reportD1ReadEnabled: false,
      presetMaterializationEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
    },
  };
}

async function createFakeGit(directory, { branch = 'main', clean = true } = {}) {
  const path = join(directory, 'git');
  await writeFile(path, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args === 'branch --show-current') process.stdout.write(${JSON.stringify(`${branch}\n`)});
else if (args === 'rev-parse HEAD') process.stdout.write('${HEAD}\\n');
else if (args === 'status --porcelain --untracked-files=all') process.stdout.write(${JSON.stringify(clean ? '' : ' M changed-file\n')});
else process.exitCode = 1;
`, { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}

test('spawned acceptance passes once and writes private evidence with environment-only credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multichannel acceptance pass '));
  const handoffPath = join(directory, 'reviewed handoff.json');
  const finalizerPath = join(directory, 'finalizer evidence.json');
  const acceptanceEvidencePath = join(directory, 'acceptance output', 'summary.json');
  const closeoutRoot = join(directory, 'closeout output');
  try {
    await createFakeGit(directory);
    await writeFile(handoffPath, JSON.stringify(reviewedHandoff()), { mode: 0o600 });
    await chmod(handoffPath, 0o600);
    await writeFile(finalizerPath, JSON.stringify(finalizerEvidence()), { mode: 0o600 });
    await chmod(finalizerPath, 0o600);

    const result = spawnSync(process.execPath, [ACCEPTANCE_PATH], {
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG: CONFIG_PATH,
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
        MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerPath,
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_EVIDENCE: acceptanceEvidencePath,
        MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: closeoutRoot,
        DEV_VARS_FILE: join(directory, 'missing dev vars'),
        LARK_APP_ID: 'app-id-present',
        LARK_APP_SECRET: 'app-secret-present',
        LARK_APP_TOKEN: 'app-token-present',
      },
    });

    assert.equal(result.status, OPERATOR_TERMINAL_EXIT_CODES.success, result.stderr);
    const output = parseSingleJson(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.mode, 'LOCAL_ACCEPTANCE_ONLY');
    assert.equal(output.decision, 'READY_TO_RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE');
    assert.equal(output.blockers.length, 0);
    assert.equal(output.allBlockersReportedInSingleRun, true);
    assert.equal(output.liveCommand.shell, false);
    assert.equal(output.gates.find(({ name }) => name === 'terminal-plan-spawn').status, 'pass');
    assert.equal(output.gates.find(({ name }) => name === 'private-reviewed-handoff').status, 'pass');
    assert.equal(output.gates.find(({ name }) => name === 'private-finalizer-evidence').status, 'pass');
    assert.equal(output.gates.find(({ name }) => name === 'local-secret-source').status, 'pass');
    assert.equal(output.remoteReadCount, 0);
    assert.equal(output.remoteWriteCount, 0);
    assert.equal(output.queueActionCount, 0);
    assert.equal(output.workerDeploymentCount, 0);
    assert.equal(output.production, 'BLOCKED');

    const evidence = JSON.parse(await readFile(acceptanceEvidencePath, 'utf8'));
    assert.equal(evidence.ok, true);
    const file = await stat(acceptanceEvidencePath);
    assert.equal(file.mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('spawned acceptance reports all blockers once with exit 2 and zero Remote actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multichannel acceptance blocked '));
  const acceptanceEvidencePath = join(directory, 'blocked output', 'summary.json');
  try {
    await createFakeGit(directory, { branch: 'work/not-main', clean: false });
    const result = spawnSync(process.execPath, [ACCEPTANCE_PATH], {
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG: join(directory, 'missing config.jsonc'),
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: join(directory, 'missing handoff.json'),
        MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: join(directory, 'missing finalizer.json'),
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_EVIDENCE: acceptanceEvidencePath,
        MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: join(directory, 'closeout output'),
        DEV_VARS_FILE: join(directory, 'missing dev vars'),
        LARK_APP_ID: '',
        LARK_APP_SECRET: '',
        LARK_APP_TOKEN: '',
        LARK_BASE_APP_TOKEN: '',
      },
    });

    assert.equal(result.status, OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked, result.stderr);
    const output = parseSingleJson(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.decision, 'LOCAL_PRECHECK_BLOCKED');
    assert.equal(output.allBlockersReportedInSingleRun, true);
    assert.ok(output.blockers.length >= 5);
    assert.ok(output.blockers.some(({ gate }) => gate === 'repository-exact-main'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'private-reviewed-handoff'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'private-finalizer-evidence'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'wrangler-config-local-contract'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'local-secret-source'));
    assert.equal(output.gates.find(({ name }) => name === 'terminal-plan-spawn').status, 'pass');
    assert.equal(output.remoteReadCount, 0);
    assert.equal(output.remoteWriteCount, 0);
    assert.equal(output.providerRequestCount, 0);
    assert.equal(output.queueActionCount, 0);
    assert.equal(output.workerDeploymentCount, 0);
    assert.equal(output.scheduleEnabled, false);
    assert.equal(output.production, 'BLOCKED');

    const evidence = JSON.parse(await readFile(acceptanceEvidencePath, 'utf8'));
    assert.equal(evidence.ok, false);
    const file = await stat(acceptanceEvidencePath);
    assert.equal(file.mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('acceptance rejects non-private retained handoff before any Remote action', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multichannel acceptance mode '));
  const handoffPath = join(directory, 'handoff.json');
  const finalizerPath = join(directory, 'finalizer.json');
  try {
    await createFakeGit(directory);
    await writeFile(handoffPath, JSON.stringify(reviewedHandoff()), { mode: 0o644 });
    await chmod(handoffPath, 0o644);
    await writeFile(finalizerPath, JSON.stringify(finalizerEvidence()), { mode: 0o600 });
    await chmod(finalizerPath, 0o600);

    const result = spawnSync(process.execPath, [ACCEPTANCE_PATH], {
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG: CONFIG_PATH,
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: handoffPath,
        MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerPath,
        MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_ACCEPTANCE_EVIDENCE:
          join(directory, 'acceptance.json'),
        MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: join(directory, 'closeout'),
        LARK_APP_ID: 'app-id-present',
        LARK_APP_SECRET: 'app-secret-present',
        LARK_APP_TOKEN: 'app-token-present',
      },
    });

    assert.equal(result.status, OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked, result.stderr);
    const output = parseSingleJson(result.stdout);
    const blocker = output.blockers.find(({ gate }) => gate === 'private-reviewed-handoff');
    assert.equal(blocker.code, 'OPERATOR_TERMINAL_FILE_MODE_INVALID');
    assert.equal(output.remoteReadCount, 0);
    assert.equal(output.remoteWriteCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});