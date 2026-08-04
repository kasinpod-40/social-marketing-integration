import { Buffer } from 'node:buffer';

const K3_CONTRACT_URL = new URL(
  '../../packages/config/src/meta-k3-exact-recovery-contract.js',
  import.meta.url,
).href;

const K2_CONTRACT_SUFFIX =
  '/packages/config/src/meta-k2-exact-recovery-contract.js';
const K2_FINALIZER_SUFFIX =
  '/scripts/meta-k2-partial-staging-preview-finalizer.mjs';
const K2_FINALIZER_HELPER_SUFFIX =
  '/scripts/lib/meta-k2-partial-staging-finalizer.js';
const K2_PREVIEW_HELPER_SUFFIX =
  '/scripts/lib/meta-k2-preview-recovery.js';
const K2_RECOVERY_HELPER_SUFFIX =
  '/scripts/lib/meta-d1-only-partial-staging-recovery.js';

const RETAINED_K3_OPERATION_HEAD =
  '6d82a50bc6d051cc39307254543619fcd29211b4';
const RETAINED_K2_OPERATION_HEAD =
  '340f461d4155e17d98781caef375a37620f08533';
const READINESS_IMPORT =
  "import { waitForMetaK3PreviewReadiness } from './lib/meta-k3-preview-readiness.js';\n";

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith(K2_CONTRACT_SUFFIX)) {
    return {
      url: K3_CONTRACT_URL,
      shortCircuit: true,
    };
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (loaded.format !== 'module' || loaded.source === null
    || loaded.source === undefined) {
    return loaded;
  }

  let source = sourceText(loaded.source);
  let transformed = false;

  if (url.endsWith(K2_FINALIZER_SUFFIX)) {
    source = `${READINESS_IMPORT}${source}`
      .replaceAll('MKT_META_K2_', 'MKT_META_K3_')
      .replaceAll(
        'meta-history-2026-chemistry_k2-summary.json',
        'meta-history-2026-chemistry_k3-summary.json',
      )
      .replace(
        "\n\n    currentStage = 'continue-d1';",
        [
          '',
          '',
          '    const previewReadiness = await waitForMetaK3PreviewReadiness({',
          '      url: recoveryUrl,',
          '      token: credentials.token,',
          '      attestation: credentials.attestation,',
          '      activeVersion: deployed.activeVersion,',
          '    });',
          '',
          "    currentStage = 'continue-d1';",
        ].join('\n'),
      )
      .replace(
        "    await evidence.write('continue-d1', {\n      invocationCount,",
        "    await evidence.write('continue-d1', {\n      previewReadiness,\n      invocationCount,",
      )
      .replace(
        "\n\n    currentStage = 'continue-lark';",
        [
          '',
          '',
          '    const previewReadiness = await waitForMetaK3PreviewReadiness({',
          '      url: recoveryUrl,',
          '      token: credentials.token,',
          '      attestation: credentials.attestation,',
          '      activeVersion: deployed.activeVersion,',
          '    });',
          '',
          "    currentStage = 'continue-lark';",
        ].join('\n'),
      )
      .replace(
        "    await evidence.write('continue-lark', {\n      invocationCount,",
        "    await evidence.write('continue-lark', {\n      previewReadiness,\n      invocationCount,",
      );
    assertFinalizerReadinessTransform(source);
    transformed = true;
  } else if (url.endsWith(K2_FINALIZER_HELPER_SUFFIX)) {
    source = source
      .replaceAll(RETAINED_K2_OPERATION_HEAD, RETAINED_K3_OPERATION_HEAD)
      .replaceAll(
        'CONFIRM_META_K2_PARTIAL_STAGING_RECOVERY',
        'CONFIRM_META_K3_PARTIAL_STAGING_RECOVERY',
      )
      .replaceAll(
        'RECOVER_AND_COMPLETE_EXACT_META_K2_PARTIAL_STAGING',
        'RECOVER_AND_COMPLETE_EXACT_META_K3_PARTIAL_STAGING',
      )
      .replaceAll(
        'meta_k2_partial_staging_finalizer_v1',
        'meta_k3_partial_staging_finalizer_v1',
      );
    transformed = true;
  } else if (url.endsWith(K2_PREVIEW_HELPER_SUFFIX)) {
    source = source
      .replaceAll(
        'apps/sync-worker/src/meta-k2-exact-recovery-preview-entry.js',
        'apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js',
      )
      .replaceAll('meta-k2-recovery', 'meta-k3-recovery')
      .replaceAll(
        'CONFIRM_META_K2_PREVIEW_RECOVERY',
        'CONFIRM_META_K3_PREVIEW_RECOVERY',
      )
      .replaceAll(
        'RUN_EXACT_META_K2_PREVIEW_RECOVERY',
        'RUN_EXACT_META_K3_PREVIEW_RECOVERY',
      );
    transformed = true;
  } else if (url.endsWith(K2_RECOVERY_HELPER_SUFFIX)) {
    // The helper is target-generic except for its imported exact identity.
    // resolve() above binds that import to the K3 contract.
    transformed = true;
  }

  if (!transformed) return loaded;
  return {
    ...loaded,
    source,
    shortCircuit: true,
  };
}

function assertFinalizerReadinessTransform(source) {
  const readinessCalls = source.match(/waitForMetaK3PreviewReadiness\(/gu) ?? [];
  const readinessEvidence = source.match(/previewReadiness,/gu) ?? [];
  if (readinessCalls.length !== 2 || readinessEvidence.length !== 2) {
    throw new Error(
      'K3 loader failed to inject both exact Preview readiness gates',
    );
  }
}

function sourceText(source) {
  if (typeof source === 'string') return source;
  if (source instanceof ArrayBuffer) {
    return Buffer.from(source).toString('utf8');
  }
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    ).toString('utf8');
  }
  return String(source);
}
