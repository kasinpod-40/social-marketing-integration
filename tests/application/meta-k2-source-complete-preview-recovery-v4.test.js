import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION,
  META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT,
  META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT,
  assertMetaK2SourceCompletePreviewV4Confirmation,
  finalizeMetaK2SourceCompleteV4ControllerTransform,
} from '../../scripts/lib/meta-k2-source-complete-preview-recovery-v4.js';
import {
  transformMetaK2SourceCompleteController,
} from '../../scripts/lib/meta-k2-source-complete-preview-recovery.js';
import {
  finalizeMetaK2SourceCompleteControllerTransform,
} from '../../scripts/lib/meta-k2-source-complete-preview-loader.mjs';

async function transformedSource(path) {
  const url = new URL(path, import.meta.url);
  const original = await readFile(url, 'utf8');
  const sourceComplete = transformMetaK2SourceCompleteController(url.href, original);
  assert.equal(sourceComplete.changed, true);
  const v3 = finalizeMetaK2SourceCompleteControllerTransform(sourceComplete);
  const v4 = finalizeMetaK2SourceCompleteV4ControllerTransform({
    fileName: sourceComplete.fileName,
    source: v3,
  });
  assert.equal(v4.changed, true);
  return { original, source: v4.source };
}

test('requires a new explicit v4 confirmation', () => {
  const expected = META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION;
  assert.equal(assertMetaK2SourceCompletePreviewV4Confirmation({
    [expected.envName]: expected.value,
  }), true);
  assert.throws(
    () => assertMetaK2SourceCompletePreviewV4Confirmation({}),
    (error) => error?.code
      === 'META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION_REQUIRED',
  );
});

test('prepares or reuses one verified D1 backup before any Preview mutation', async () => {
  const { original, source } = await transformedSource(
    '../../scripts/meta-k2-partial-staging-preview-recovery.mjs',
  );

  assert.match(source, new RegExp(META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT, 'u'));
  assert.match(source, new RegExp(META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT, 'u'));
  assert.match(
    source,
    /meta-k2-source-complete-preview-finalizer-bootstrap-v4\.mjs/u,
  );
  assert.match(source, /currentStage = 'backup-before-preview-window'/u);
  assert.match(source, /'--skip-confirmation'/u);
  assert.match(source, /MKT_META_K2_PREVIEW_BACKUP_PATH: previewBackup\.backupPath/u);
  assert.match(source, /reusedExistingBackup: true/u);
  assert.match(source, /META_K2_PREVIEW_BACKUP_REUSE_INVALID/u);
  assert.match(source, /summaryPath/u);
  assert.match(source, /previewSettingMutationCount: 0/u);
  assert.match(source, /workerVersionUploadCount: 0/u);

  const existingCheck = source.indexOf('const existing = await stat(backupRoot)');
  const existingReuse = source.indexOf('if (existing)');
  const exportCommand = source.indexOf("result = spawnSync('npx'");
  assert.ok(existingCheck >= 0);
  assert.ok(existingCheck < existingReuse);
  assert.ok(existingReuse < exportCommand);

  const backupStage = source.indexOf("currentStage = 'backup-before-preview-window'");
  const previewBaseline = source.indexOf("currentStage = 'preview-url-window-baseline'");
  const previewEnable = source.indexOf("currentStage = 'enable-preview-url-window'");
  const safeUpload = source.indexOf("currentStage = 'upload-safe-preview-bootstrap'");
  assert.ok(backupStage >= 0);
  assert.ok(backupStage < previewBaseline);
  assert.ok(backupStage < previewEnable);
  assert.ok(backupStage < safeUpload);

  assert.doesNotMatch(original, /backup-before-preview-window/u);
  assert.doesNotMatch(original, /MKT_META_K2_PREVIEW_BACKUP_PATH/u);
});

test('finalizer reuses the exact retained pre-Preview backup and cannot export again', async () => {
  const { original, source } = await transformedSource(
    '../../scripts/meta-k2-partial-staging-preview-finalizer.mjs',
  );

  assert.match(source, new RegExp(META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT, 'u'));
  assert.match(source, new RegExp(META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT, 'u'));
  assert.match(source, /prePreviewExportVerified: true/u);
  assert.match(source, /env\.MKT_META_K2_PREVIEW_BACKUP_PATH/u);
  assert.match(
    source,
    /requireExact\([\s\S]*backupPath,[\s\S]*expectedPath,[\s\S]*MKT_META_K2_PREVIEW_BACKUP_PATH/u,
  );
  assert.doesNotMatch(
    source,
    /async function backupD1\(env, configPath\)[\s\S]*?'d1', 'export'/u,
  );
  assert.match(
    original,
    /async function backupD1\(env, configPath\)[\s\S]*?'d1', 'export'/u,
  );
});

test('finalizer skips completed D1 and retains complete safe Lark preflight diagnostics', async () => {
  const { source } = await transformedSource(
    '../../scripts/meta-k2-partial-staging-preview-finalizer.mjs',
  );

  assert.match(source, /stability\.d1AlreadyComplete === true/u);
  assert.match(source, /currentStage = 'reuse-d1-complete'/u);
  assert.match(source, /validateMetaD1OnlySummaryForLark/u);
  assert.match(source, /invocationCount: 0/u);
  assert.match(source, /boundary: 'd1_complete_lark_pending'/u);
  assert.match(source, /async function waitForExactPreviewAlias/u);
  assert.match(source, /META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED/u);
  assert.match(source, /unauthorizedProbeOnly: true/u);
  assert.match(source, /directUseCaseInvocationCount: 0/u);
  assert.match(source, /const larkAliasReadiness = await waitForExactPreviewAlias/u);
  assert.match(source, /aliasReadiness: larkAliasReadiness/u);
  assert.match(source, /responseFieldName/u);
  assert.match(source, /responseIssueCount/u);
  assert.match(source, /responseTablesChecked/u);
  assert.match(source, /responseRowsChecked/u);
  assert.match(source, /responseFieldsChecked/u);
  assert.match(source, /responseIssues/u);
  assert.match(source, /responseIssuesTruncated/u);
  assert.match(source, /reasonCode/u);
  assert.match(source, /destinationType/u);
  assert.match(source, /incomingType/u);
  assert.match(source, /affectedRows/u);
  assert.match(source, /observedWorkerVersion/u);
  assert.match(source, /attestationMatched/u);

  const d1Reuse = source.indexOf("currentStage = 'reuse-d1-complete'");
  const larkPreflight = source.indexOf("currentStage = 'lark-preflight'");
  const larkDeploy = source.indexOf("currentStage = 'deploy-lark-continuation'");
  assert.ok(d1Reuse >= 0);
  assert.ok(d1Reuse < larkPreflight);
  assert.ok(larkPreflight < larkDeploy);
});

test('v4 wiring remains additive and delegates to the reviewed hash-pinned transforms', async () => {
  const paths = [
    '../../scripts/lib/meta-k2-source-complete-preview-recovery-v4.js',
    '../../scripts/lib/meta-k2-source-complete-preview-loader-v4.mjs',
    '../../scripts/meta-k2-source-complete-preview-finalizer-bootstrap-v4.mjs',
    '../../scripts/meta-k2-source-complete-preview-recovery-v4.mjs',
  ];
  const sources = await Promise.all(paths.map((path) => (
    readFile(new URL(path, import.meta.url), 'utf8')
  )));
  const [contract, loader, bootstrap, terminal] = sources;

  assert.match(loader, /transformMetaK2SourceCompleteController/u);
  assert.match(loader, /finalizeMetaK2SourceCompleteControllerTransform/u);
  assert.match(loader, /finalizeMetaK2SourceCompleteV4ControllerTransform/u);
  assert.match(bootstrap, /meta-k2-source-complete-preview-loader-v4\.mjs/u);
  assert.match(terminal, /meta-k2-source-complete-preview-loader-v4\.mjs/u);
  assert.match(contract, /META_K2_PREVIEW_BACKUP_REUSE_INVALID/u);
  assert.match(contract, /META_K2_PREVIEW_ALIAS_NOT_READY/u);
  assert.match(contract, /responseIssueCount/u);

  for (const source of [loader, bootstrap, terminal]) {
    assert.doesNotMatch(source, /queue\s*\.\s*send\s*\(/iu);
    assert.doesNotMatch(source, /['"`]\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
  }
});
