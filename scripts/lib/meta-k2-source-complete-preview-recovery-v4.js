import { createHash } from 'node:crypto';

import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE_ENV =
  'MKT_META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE';
export const META_K2_SOURCE_COMPLETE_PREVIEW_V4_MODE =
  'SOURCE_COMPLETE_PRE_D1_FAILED_V4';
export const META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_K2_SOURCE_COMPLETE_PREVIEW_RECOVERY_V4',
  value: 'RECOVER_AND_COMPLETE_EXACT_META_K2_SOURCE_COMPLETE_PRE_D1_V4',
});
export const META_K2_SOURCE_COMPLETE_RECOVERY_V3_ROOT =
  'exact-source-complete-pre-d1-recovery-v3';
export const META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT =
  'exact-source-complete-pre-d1-recovery-v4';
export const META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT =
  'exact-source-complete-pre-d1-recovery-v4-backup';
export const META_K2_SOURCE_COMPLETE_RECOVERY_V4_CONTRACT_VERSION =
  'meta_k2_source_complete_preview_recovery_v4';

const OUTER_FILE = 'meta-k2-partial-staging-preview-recovery.mjs';
const FINALIZER_FILE = 'meta-k2-partial-staging-preview-finalizer.mjs';
const V3_FINALIZER_BOOTSTRAP =
  'meta-k2-source-complete-preview-finalizer-bootstrap.mjs';
const V4_FINALIZER_BOOTSTRAP =
  'meta-k2-source-complete-preview-finalizer-bootstrap-v4.mjs';

export function assertMetaK2SourceCompletePreviewV4Confirmation(env = {}) {
  const expected = META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw v4Error(
      `Meta K2 source-complete Preview v4 requires ${expected.envName}=${expected.value}`,
      'META_K2_SOURCE_COMPLETE_PREVIEW_V4_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function finalizeMetaK2SourceCompleteV4ControllerTransform(input = {}) {
  const fileName = requireText(input.fileName, 'fileName');
  let source = requireText(input.source, 'source');

  if (![OUTER_FILE, FINALIZER_FILE].includes(fileName)) {
    return Object.freeze({ changed: false, fileName, source });
  }

  source = replaceExactlyOnce(
    source,
    META_K2_SOURCE_COMPLETE_RECOVERY_V3_ROOT,
    META_K2_SOURCE_COMPLETE_RECOVERY_V4_ROOT,
    'v4 recovery root',
  );

  if (fileName === OUTER_FILE) {
    source = transformOuter(source);
  } else {
    source = transformFinalizer(source);
  }

  return Object.freeze({
    changed: true,
    fileName,
    transformedSha256: sha256(source),
    source,
  });
}

function transformOuter(sourceInput) {
  let source = sourceInput;

  source = replaceExactlyOnce(
    source,
    V3_FINALIZER_BOOTSTRAP,
    V4_FINALIZER_BOOTSTRAP,
    'v4 finalizer bootstrap',
  );

  source = replaceExactlyOnce(
    source,
    "  currentStage = 'preview-url-window-baseline';",
    [
      "  currentStage = 'backup-before-preview-window';",
      '  const previewBackup = await exportD1BackupBeforePreview();',
      '  process.stdout.write(`${JSON.stringify({',
      '    ok: true,',
      "    stage: 'backup-before-preview-window',",
      '    backupFile: previewBackup.backupFile,',
      '    backupBytes: previewBackup.backupBytes,',
      '    backupSha256: previewBackup.backupSha256,',
      '    reusedExistingBackup: previewBackup.reusedExistingBackup === true,',
      '    remoteReadCount: previewBackup.reusedExistingBackup === true ? 0 : 1,',
      '    remoteMutationCount: 0,',
      '    previewSettingMutationCount: 0,',
      '    workerVersionUploadCount: 0,',
      '    workerDeploymentCount: 0,',
      '    productionTrafficChange: false,',
      '    queueMessageCount: 0,',
      '    lifecycleSqlRepairCount: 0,',
      '    scheduleEnabled: false,',
      "    production: 'BLOCKED',",
      '  }, null, 2)}\\n`);',
      '',
      "  currentStage = 'preview-url-window-baseline';",
    ].join('\n'),
    'backup before Preview window',
  );

  source = replaceExactlyOnce(
    source,
    '      MKT_META_K2_PRODUCTION_BASELINE_VERSION: productionBaselineVersion,',
    [
      '      MKT_META_K2_PRODUCTION_BASELINE_VERSION: productionBaselineVersion,',
      '      MKT_META_K2_PREVIEW_BACKUP_PATH: previewBackup.backupPath,',
    ].join('\n'),
    'pass retained pre-Preview backup to finalizer',
  );

  source = replaceExactlyOnce(
    source,
    'async function uploadPreviewVersion(input) {',
    `${buildOuterBackupFunction()}\n\nasync function uploadPreviewVersion(input) {`,
    'pre-Preview backup function',
  );

  return source;
}

function buildOuterBackupFunction() {
  return [
    'async function exportD1BackupBeforePreview() {',
    '  const backupRoot = join(',
    '    dirname(exactRecoveryRoot),',
    `    '${META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT}',`,
    '  );',
    "  const backupPath = join(backupRoot, 'meta-k2-before-recovery.sql');",
    "  const summaryPath = join(backupRoot, 'summary.json');",
    '  const temporaryPath = `${backupPath}.${process.pid}.${Date.now()}.tmp`;',
    '  const existing = await stat(backupRoot).catch((error) => {',
    "    if (error?.code === 'ENOENT') return null;",
    '    throw error;',
    '  });',
    '  if (existing) {',
    '    if (!existing.isDirectory()) {',
    '      throw launcherError(',
    "        'Meta K2 v4 backup root is not a directory',",
    "        'META_K2_PREVIEW_BACKUP_REUSE_INVALID',",
    '      );',
    '    }',
    '    const [summary, bytes] = await Promise.all([',
    '      readJson(summaryPath),',
    '      readFile(backupPath),',
    '    ]);',
    "    const observedSha256 = createHash('sha256').update(bytes).digest('hex');",
    '    const accepted = summary?.ok === true',
    "      && summary?.stage === 'backup-before-preview-window'",
    '      && summary?.backupFile === relative(repositoryRoot, backupPath)',
    '      && Number(summary?.backupBytes) === bytes.length',
    '      && bytes.length > 0',
    '      && summary?.backupSha256 === observedSha256',
    '      && Number(summary?.remoteMutationCount) === 0',
    '      && Number(summary?.previewSettingMutationCount) === 0',
    '      && Number(summary?.workerVersionUploadCount) === 0',
    '      && Number(summary?.workerDeploymentCount) === 0',
    '      && summary?.productionTrafficChange === false',
    '      && Number(summary?.queueMessageCount) === 0',
    '      && Number(summary?.lifecycleSqlRepairCount) === 0',
    '      && summary?.scheduleEnabled === false;',
    '    if (!accepted) {',
    '      throw launcherError(',
    "        'Meta K2 existing pre-Preview backup does not match its retained summary',",
    "        'META_K2_PREVIEW_BACKUP_REUSE_INVALID',",
    '      );',
    '    }',
    '    return {',
    '      ...summary,',
    '      backupPath,',
    '      reusedExistingBackup: true,',
    '    };',
    '  }',
    '  await mkdir(backupRoot, { recursive: true, mode: 0o700 });',
    '',
    '  let result = null;',
    '  try {',
    "    result = spawnSync('npx', [",
    "      'wrangler', 'd1', 'export', databaseBinding, '--remote',",
    "      '--skip-confirmation', '--config', runtimeConfigPath,",
    "      '--output', temporaryPath,",
    '    ], {',
    '      cwd: repositoryRoot,',
    '      env: { ...process.env, ...target.env },',
    "      encoding: 'utf8',",
    '      maxBuffer: 64 * 1024 * 1024,',
    '    });',
    "    const stdout = String(result.stdout ?? '');",
    "    const stderr = String(result.stderr ?? '');",
    "    await writePrivateText(join(backupRoot, 'wrangler.stdout.log'), stdout);",
    "    await writePrivateText(join(backupRoot, 'wrangler.stderr.log'), stderr);",
    '',
    '    if (result.error || result.status !== 0) {',
    '      const outputCreated = await stat(temporaryPath)',
    '        .then((value) => value.isFile())',
    '        .catch(() => false);',
    '      const failure = {',
    '        ok: false,',
    "        stage: 'backup-before-preview-window',",
    "        code: 'META_K2_PREVIEW_BACKUP_EXPORT_FAILED',",
    "        command: 'npx',",
    '        exitCode: result.status,',
    '        signal: result.signal ?? null,',
    "        stdoutSha256: createHash('sha256').update(stdout).digest('hex'),",
    "        stderrSha256: createHash('sha256').update(stderr).digest('hex'),",
    '        outputCreated,',
    '        previewSettingMutationCount: 0,',
    '        workerVersionUploadCount: 0,',
    '        workerDeploymentCount: 0,',
    '        productionTrafficChange: false,',
    '        queueMessageCount: 0,',
    '        lifecycleSqlRepairCount: 0,',
    '        scheduleEnabled: false,',
    "        production: 'BLOCKED',",
    '      };',
    '      await writePrivateText(',
    "        join(backupRoot, 'failure.json'),",
    '        `${JSON.stringify(failure, null, 2)}\\n`,',
    '      );',
    '      throw launcherError(',
    "        'Meta K2 D1 backup export failed before the Preview URL window opened',",
    "        'META_K2_PREVIEW_BACKUP_EXPORT_FAILED',",
    '        {',
    "          command: 'npx',",
    '          exitCode: result.status,',
    '          signal: result.signal ?? null,',
    '          stdoutSha256: failure.stdoutSha256,',
    '          stderrSha256: failure.stderrSha256,',
    '          outputCreated,',
    '          backupRoot: relative(repositoryRoot, backupRoot),',
    '        },',
    '      );',
    '    }',
    '',
    '    const bytes = await readFile(temporaryPath);',
    '    if (bytes.length === 0) {',
    '      throw launcherError(',
    "        'Meta K2 D1 backup is empty before the Preview URL window opened',",
    "        'META_K2_PREVIEW_BACKUP_EMPTY',",
    '      );',
    '    }',
    '    await rename(temporaryPath, backupPath);',
    '    await chmod(backupPath, 0o600);',
    '    const summary = {',
    '      ok: true,',
    "      stage: 'backup-before-preview-window',",
    '      backupFile: relative(repositoryRoot, backupPath),',
    '      backupBytes: bytes.length,',
    "      backupSha256: createHash('sha256').update(bytes).digest('hex'),",
    '      reusedExistingBackup: false,',
    '      remoteReadCount: 1,',
    '      remoteMutationCount: 0,',
    '      previewSettingMutationCount: 0,',
    '      workerVersionUploadCount: 0,',
    '      workerDeploymentCount: 0,',
    '      productionTrafficChange: false,',
    '      queueMessageCount: 0,',
    '      lifecycleSqlRepairCount: 0,',
    '      scheduleEnabled: false,',
    "      production: 'BLOCKED',",
    '    };',
    '    await writePrivateText(',
    '      summaryPath,',
    '      `${JSON.stringify(summary, null, 2)}\\n`,',
    '    );',
    '    return { ...summary, backupPath };',
    '  } finally {',
    '    await rm(temporaryPath, { force: true });',
    '  }',
    '}',
  ].join('\n');
}

function transformFinalizer(sourceInput) {
  let source = replaceRegexExactlyOnce(
    sourceInput,
    /async function backupD1\(env, configPath\) \{[\s\S]*?\n\}\n\nasync function uploadPreviewVersion/u,
    [
      'async function backupD1(env, _configPath) {',
      '  const backupPath = await resolveRepositoryFile(',
      '    env.MKT_META_K2_PREVIEW_BACKUP_PATH,',
      "    'MKT_META_K2_PREVIEW_BACKUP_PATH',",
      '  );',
      '  const expectedPath = join(',
      '    dirname(recoveryRoot),',
      `    '${META_K2_SOURCE_COMPLETE_RECOVERY_V4_BACKUP_ROOT}',`,
      "    'meta-k2-before-recovery.sql',",
      '  );',
      '  requireExact(',
      '    backupPath,',
      '    expectedPath,',
      "    'MKT_META_K2_PREVIEW_BACKUP_PATH',",
      '  );',
      '  const bytes = await readFile(backupPath);',
      '  if (bytes.length === 0) {',
      '    throw finalizerFailure(',
      "      'Meta K2 retained pre-Preview D1 backup is empty',",
      "      'META_K2_PARTIAL_STAGING_BACKUP_EMPTY',",
      '    );',
      '  }',
      '  return {',
      '    backupFile: relative(repositoryRoot, backupPath),',
      '    backupBytes: bytes.length,',
      "    backupSha256: sha256(bytes),",
      '    prePreviewExportVerified: true,',
      '    remoteMutationCount: 0,',
      '  };',
      '}',
      '',
      'async function uploadPreviewVersion',
    ].join('\n'),
    'reuse pre-Preview D1 backup',
  );

  source = replaceExactlyOnce(
    source,
    [
      'import {',
      '  buildMetaLarkSnapshotSql,',
      '  classifyMetaLarkCompletion,',
      '  expectedLarkContracts,',
      '  normalizeMetaLarkSnapshot,',
      "} from './lib/meta-lark-parity-rollout-operator.js';",
    ].join('\n'),
    [
      'import {',
      '  buildMetaLarkSnapshotSql,',
      '  classifyMetaLarkCompletion,',
      '  expectedLarkContracts,',
      '  normalizeMetaLarkSnapshot,',
      '  validateMetaD1OnlySummaryForLark,',
      "} from './lib/meta-lark-parity-rollout-operator.js';",
    ].join('\n'),
    'D1-complete Lark summary validator import',
  );

  source = replaceExactlyOnce(
    source,
    [
      '  const d1Window = await runD1Window({',
      '    baseEnv,',
      '    configPath,',
      '    safeConfigText,',
      '    recoveryUrl: previewRecoveryUrl,',
      '    target,',
      '    evidence,',
      '    snapshotBefore: stability.snapshot,',
      '  });',
      '',
      '  const d1Chain = validateMetaK2RecoveryEvidenceSequence(',
      '    evidence.items,',
      '    retained.retainedEvidenceSha256,',
      '  );',
      '  const d1Summary = createMetaK2CanonicalD1Summary({',
      '    target,',
      '    recovery: d1Chain,',
      '  });',
      "  await writePrivateJson(join(d1Root, 'summary.json'), d1Summary);",
    ].join('\n'),
    [
      '  let d1Window = null;',
      '  if (stability.d1AlreadyComplete === true) {',
      "    currentStage = 'reuse-d1-complete';",
      "    const retainedD1Summary = await readJson(join(d1Root, 'summary.json'));",
      '    const validatedD1Summary = validateMetaD1OnlySummaryForLark(',
      '      retainedD1Summary,',
      '      target,',
      '    );',
      "    await evidence.write('verify-d1', {",
      "      boundary: 'd1_complete_lark_pending',",
      '      reusedD1Complete: true,',
      '      validatedD1Summary,',
      '      snapshotAfter: stability.snapshot,',
      '      queueMessageCount: 0,',
      '      remoteMutationCount: 0,',
      '    });',
      '    d1Window = {',
      '      invocationCount: 0,',
      '      finalSnapshot: stability.snapshot,',
      '      reusedD1Complete: true,',
      '    };',
      '  } else {',
      '    d1Window = await runD1Window({',
      '      baseEnv,',
      '      configPath,',
      '      safeConfigText,',
      '      recoveryUrl: previewRecoveryUrl,',
      '      target,',
      '      evidence,',
      '      snapshotBefore: stability.snapshot,',
      '    });',
      '',
      '    const d1Chain = validateMetaK2RecoveryEvidenceSequence(',
      '      evidence.items,',
      '      retained.retainedEvidenceSha256,',
      '    );',
      '    const d1Summary = createMetaK2CanonicalD1Summary({',
      '      target,',
      '      recovery: d1Chain,',
      '    });',
      "    await writePrivateJson(join(d1Root, 'summary.json'), d1Summary);",
      '  }',
    ].join('\n'),
    'skip completed D1 and resume exact Lark pending boundary',
  );

  source = replaceExactlyOnce(
    source,
    [
      "    currentStage = 'verify-d1-continuation';",
      '    await verifyVersionFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);',
      "    await evidence.write('verify-d1-continuation', {",
    ].join('\n'),
    [
      "    currentStage = 'verify-d1-continuation';",
      '    await verifyVersionFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);',
      '    const d1AliasReadiness = await waitForExactPreviewAlias({',
      '      url: recoveryUrl,',
      '      activeVersion: deployed.activeVersion,',
      '      attestation: credentials.attestation,',
      "      phase: 'd1',",
      '    });',
      "    await evidence.write('verify-d1-continuation', {",
      '      aliasReadiness: d1AliasReadiness,',
    ].join('\n'),
    'wait for D1 Preview alias activation',
  );

  source = replaceExactlyOnce(
    source,
    [
      "    currentStage = 'verify-lark-continuation';",
      '    await verifyVersionFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);',
      "    await evidence.write('verify-lark-continuation', {",
    ].join('\n'),
    [
      "    currentStage = 'verify-lark-continuation';",
      '    await verifyVersionFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);',
      '    const larkAliasReadiness = await waitForExactPreviewAlias({',
      '      url: recoveryUrl,',
      '      activeVersion: deployed.activeVersion,',
      '      attestation: credentials.attestation,',
      "      phase: 'lark',",
      '    });',
      "    await evidence.write('verify-lark-continuation', {",
      '      aliasReadiness: larkAliasReadiness,',
    ].join('\n'),
    'wait for Lark Preview alias activation',
  );

  source = replaceExactlyOnce(
    source,
    [
      '          responseCode: typeof value?.code === \'string\' ? value.code : null,',
      '          responseStage: typeof value?.stage === \'string\' ? value.stage : null,',
    ].join('\n'),
    [
      '          responseCode: typeof value?.code === \'string\' ? value.code : null,',
      '          responseStage: typeof value?.stage === \'string\' ? value.stage : null,',
      '          responseFieldName:',
      "            typeof value?.details?.fieldName === 'string'",
      '              ? value.details.fieldName',
      '              : null,',
      '          responseIssueCount: Number.isSafeInteger(value?.details?.issueCount)',
      '            ? value.details.issueCount',
      '            : 0,',
      '          responseTablesChecked: Number.isSafeInteger(value?.details?.tablesChecked)',
      '            ? value.details.tablesChecked',
      '            : 0,',
      '          responseRowsChecked: Number.isSafeInteger(value?.details?.rowsChecked)',
      '            ? value.details.rowsChecked',
      '            : 0,',
      '          responseFieldsChecked: Number.isSafeInteger(value?.details?.fieldsChecked)',
      '            ? value.details.fieldsChecked',
      '            : 0,',
      '          responseIssues: Array.isArray(value?.details?.issues)',
      '            ? value.details.issues.map((issue) => ({',
      "              tableKey: typeof issue?.tableKey === 'string' ? issue.tableKey : null,",
      "              fieldName: typeof issue?.fieldName === 'string' ? issue.fieldName : null,",
      "              reasonCode: typeof issue?.reasonCode === 'string' ? issue.reasonCode : null,",
      '              destinationType: Number.isInteger(issue?.destinationType)',
      '                ? issue.destinationType',
      '                : null,',
      "              incomingType: typeof issue?.incomingType === 'string'",
      '                ? issue.incomingType',
      '                : null,',
      '              affectedRows: Number.isSafeInteger(issue?.affectedRows)',
      '                ? issue.affectedRows',
      '                : 0,',
      '            }))',
      '            : [],',
      '          responseIssuesTruncated: value?.details?.issuesTruncated === true,',
      "          observedWorkerVersion: response.headers.get('x-mkt-worker-version-id'),",
      '          attestationMatched:',
      '            response.headers.get(META_K2_EXACT_RECOVERY_ATTESTATION_HEADER)',
      '              === input.attestation,',
    ].join('\n'),
    'retain complete safe HTTP failure diagnostics and version evidence',
  );

  source = replaceExactlyOnce(
    source,
    'async function invokeExactContinuation(input) {',
    `${buildPreviewAliasReadinessFunction()}\n\nasync function invokeExactContinuation(input) {`,
    'Preview alias readiness helper',
  );

  return source;
}

function buildPreviewAliasReadinessFunction() {
  return [
    'async function waitForExactPreviewAlias(input) {',
    '  const maxAttempts = 30;',
    '  let last = null;',
    '  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {',
    "    const probeToken = `meta-k2-readiness-${input.phase}-${randomBytes(32).toString('base64url')}`;",
    '    const response = await fetch(input.url, {',
    "      method: 'POST',",
    '      headers: {',
    '        authorization: `Bearer ${probeToken}`,',
    "        'content-type': 'application/json',",
    "        'cache-control': 'no-store',",
    '      },',
    "      body: '{}',",
    "      redirect: 'manual',",
    '    });',
    '    const value = await response.json().catch(() => null);',
    "    const observedWorkerVersion = response.headers.get('x-mkt-worker-version-id');",
    '    const observedAttestation = response.headers.get(',
    '      META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,',
    '    );',
    '    const ready = response.status === 401',
    "      && value?.code === 'META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED'",
    '      && observedWorkerVersion === input.activeVersion',
    '      && observedAttestation === input.attestation;',
    '    if (ready) {',
    '      return {',
    '        accepted: true,',
    '        phase: input.phase,',
    '        attemptCount: attempt,',
    '        expectedStatus: 401,',
    '        unauthorizedProbeOnly: true,',
    '        directUseCaseInvocationCount: 0,',
    '        queueMessageCount: 0,',
    '      };',
    '    }',
    '    last = {',
    '      status: response.status,',
    "      code: typeof value?.code === 'string' ? value.code : null,",
    '      fieldName:',
    "        typeof value?.details?.fieldName === 'string'",
    '          ? value.details.fieldName',
    '          : null,',
    '      workerVersionMatched: observedWorkerVersion === input.activeVersion,',
    '      attestationMatched: observedAttestation === input.attestation,',
    '    };',
    '    if (attempt < maxAttempts) await sleep(1_000);',
    '  }',
    '  throw finalizerFailure(',
    "    'Meta exact Preview alias did not activate the reviewed continuation version',",
    "    'META_K2_PREVIEW_ALIAS_NOT_READY',",
    '    {',
    '      phase: input.phase,',
    '      attemptCount: maxAttempts,',
    '      lastStatus: last?.status ?? null,',
    '      lastCode: last?.code ?? null,',
    '      lastFieldName: last?.fieldName ?? null,',
    '      workerVersionMatched: last?.workerVersionMatched === true,',
    '      attestationMatched: last?.attestationMatched === true,',
    '    },',
    '  );',
    '}',
  ].join('\n');
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const last = source.lastIndexOf(search);
  if (first < 0 || first !== last) {
    throw v4Error(
      `Meta K2 source-complete v4 anchor is invalid: ${label}`,
      'META_K2_SOURCE_COMPLETE_PREVIEW_V4_ANCHOR_INVALID',
      { label, occurrenceCount: first < 0 ? 0 : 2 },
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function replaceRegexExactlyOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const matches = [...source.matchAll(globalPattern)];
  if (matches.length !== 1) {
    throw v4Error(
      `Meta K2 source-complete v4 regex anchor is invalid: ${label}`,
      'META_K2_SOURCE_COMPLETE_PREVIEW_V4_ANCHOR_INVALID',
      { label, occurrenceCount: matches.length },
    );
  }
  return source.replace(pattern, replacement);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw v4Error(
      `${fieldName} is required`,
      'META_K2_SOURCE_COMPLETE_PREVIEW_V4_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function v4Error(message, code, details = {}) {
  return permanentError(message, { code, details });
}
