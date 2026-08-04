import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_FILENAME,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
  buildReportRuntimeFinalizerEnvironment,
  loadReportRuntimeFinalizerEnvironment,
  writeReportRuntimeFinalizerEnvironment,
} from '../../scripts/lib/report-runtime-finalizer-environment.js';

const HEAD = 'a'.repeat(40);

function mappings() {
  return Object.fromEntries(
    REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.map((envName, index) => [
      envName,
      `tbl_${index + 1}`,
    ]),
  );
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
  assert.equal(evidence.remoteMutationCount, 0);
});

test('writes and loads the private environment only when its summary Head matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-finalizer-env-'));
  const summaryPath = join(root, 'report-runtime-finalize-summary.json');
  await writeFile(summaryPath, `${JSON.stringify({
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', head: HEAD, clean: true },
  })}\n`, { mode: 0o600 });

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

  await assert.rejects(
    async () => loadReportRuntimeFinalizerEnvironment({
      finalizerEvidencePath: summaryPath,
      expectedRepositoryHead: 'b'.repeat(40),
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
  );
});

test('rejects incomplete or placeholder table mappings', () => {
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
});
