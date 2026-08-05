import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_FILENAME,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
  REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES,
  REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
  buildReportRuntimeFinalizerEnvironment,
  loadReportRuntimeFinalizerEnvironment,
  writeReportRuntimeFinalizerEnvironment,
} from '../../scripts/lib/report-runtime-finalizer-environment.js';

const HEAD = 'a'.repeat(40);
const DESTINATION_HASH = 'b'.repeat(64);

function mappings() {
  return Object.fromEntries(
    REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.map((envName, index) => [
      envName,
      `tbl_${index + 1}`,
    ]),
  );
}

function activeAuthority() {
  return {
    state: 'active',
    settingKeys: [1, 3, 7, 30].map(
      (days) => `integration_workspace:facebook:rolling:${days}d`,
    ),
    destinationKeyHash: DESTINATION_HASH,
    workerEnvironment: Object.fromEntries(
      REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES.map((envName, index) => [
        envName,
        `tbl_notification_${index + 1}`,
      ]),
    ),
  };
}

function summary(state = 'inactive', count = state === 'active' ? 4 : 0) {
  return {
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', head: HEAD, clean: true },
    settings: {
      notificationRuntimeState: state,
      preservedNotificationRuntimeSettingCount: count,
    },
    runtime: { notificationAdmissionEnabled: false },
  };
}

test('builds one exact private table environment for the finalizer Head', () => {
  const evidence = buildReportRuntimeFinalizerEnvironment({
    repositoryHead: HEAD,
    environmentUpdates: mappings(),
  });
  assert.equal(evidence.contractVersion, REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT);
  assert.equal(evidence.repositoryHead, HEAD);
  assert.equal(evidence.tableEnvironmentUpdateCount, REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.length);
  assert.deepEqual(Object.keys(evidence.tableEnvironment), REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES);
  assert.equal(evidence.notificationRuntime.state, 'inactive');
  assert.deepEqual(evidence.notificationRuntime.trueFlags, []);
  assert.equal(evidence.remoteMutationCount, 0);
});

test('writes and loads inactive private environment only when its summary Head and state match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-finalizer-env-'));
  const summaryPath = join(root, 'report-runtime-finalize-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary())}\n`, { mode: 0o600 });

  const written = await writeReportRuntimeFinalizerEnvironment({
    evidenceRoot: root,
    repositoryHead: HEAD,
    environmentUpdates: mappings(),
  });
  assert.equal(
    written.environmentPath,
    join(root, REPORT_RUNTIME_FINALIZER_ENVIRONMENT_FILENAME),
  );
  assert.equal(JSON.parse(await readFile(written.environmentPath, 'utf8')).repositoryHead, HEAD);

  const loaded = loadReportRuntimeFinalizerEnvironment({
    finalizerEvidencePath: summaryPath,
    expectedRepositoryHead: HEAD,
  });
  assert.equal(loaded.repositoryHead, HEAD);
  assert.deepEqual(loaded.tableEnvironment, mappings());
  assert.equal(loaded.notificationRuntime.state, 'inactive');

  assert.throws(
    () => loadReportRuntimeFinalizerEnvironment({
      finalizerEvidencePath: summaryPath,
      expectedRepositoryHead: 'b'.repeat(40),
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
  );
});

test('retains exact active Notification Runtime flags, mappings and fingerprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-finalizer-runtime-env-'));
  const summaryPath = join(root, 'report-runtime-finalize-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary('active', 4))}\n`, { mode: 0o600 });
  const written = await writeReportRuntimeFinalizerEnvironment({
    evidenceRoot: root,
    repositoryHead: HEAD,
    environmentUpdates: mappings(),
    notificationRuntimeAuthority: activeAuthority(),
  });
  assert.equal(written.evidence.notificationRuntime.state, 'active');
  assert.equal(written.evidence.notificationRuntime.mode, 'runtime');
  assert.deepEqual(
    written.evidence.notificationRuntime.trueFlags,
    REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
  );
  assert.equal(written.evidence.notificationRuntime.settingCount, 4);
  assert.equal(written.evidence.notificationRuntime.destinationKeyHash, DESTINATION_HASH);
  assert.match(written.evidence.notificationRuntime.settingKeyFingerprint, /^[0-9a-f]{64}$/u);

  const loaded = loadReportRuntimeFinalizerEnvironment({
    finalizerEvidencePath: summaryPath,
    expectedRepositoryHead: HEAD,
  });
  assert.equal(loaded.notificationRuntime.state, 'active');
  assert.deepEqual(loaded.notificationRuntime.trueFlags, REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS);
  assert.deepEqual(
    loaded.notificationRuntime.tableEnvironment,
    activeAuthority().workerEnvironment,
  );
});

test('rejects incomplete, placeholder or summary-mismatched private evidence', async () => {
  const incomplete = mappings();
  delete incomplete.LARK_TABLE_MKT_REPORT_TOP_ADS;
  assert.throws(
    () => buildReportRuntimeFinalizerEnvironment({
      repositoryHead: HEAD,
      environmentUpdates: incomplete,
    }),
    (error) => error.code === 'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
  );

  assert.throws(
    () => buildReportRuntimeFinalizerEnvironment({
      repositoryHead: HEAD,
      environmentUpdates: {
        ...mappings(),
        LARK_TABLE_MKT_REPORT_TOP_ADS: 'replace-with-table-id',
      },
    }),
    (error) => error.code === 'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
  );

  const root = await mkdtemp(join(tmpdir(), 'report-finalizer-env-mismatch-'));
  const summaryPath = join(root, 'report-runtime-finalize-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary('inactive', 0))}\n`, { mode: 0o600 });
  await writeReportRuntimeFinalizerEnvironment({
    evidenceRoot: root,
    repositoryHead: HEAD,
    environmentUpdates: mappings(),
    notificationRuntimeAuthority: activeAuthority(),
  });
  assert.throws(
    () => loadReportRuntimeFinalizerEnvironment({ finalizerEvidencePath: summaryPath }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
  );
});
