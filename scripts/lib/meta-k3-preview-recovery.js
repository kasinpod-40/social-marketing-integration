import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  WORKER_VERSION_METADATA_BINDING,
} from '../../packages/shared/src/cloudflare/worker-version.js';
import {
  META_K3_EXACT_RECOVERY_PATH,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  parseWooCommerceDiagnosticsPreviewUpload,
} from './woocommerce-diagnostics-preview-upload.js';

export const META_K3_PREVIEW_ENTRYPOINT =
  'apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js';
export const META_K3_PREVIEW_WORKER_NAME = 'social-mkt-sync-worker';

const EXECUTION_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_TOP_LEVEL_KEYS = Object.freeze([
  'route',
  'routes',
  'triggers',
  'assets',
]);

export function buildMetaK3PreviewRuntimeConfig(sourceText, input = {}) {
  const repositoryRoot = requireText(input.repositoryRoot, 'repositoryRoot');
  const source = parseJsoncObject(requireText(sourceText, 'sourceText'));
  if (source.name !== META_K3_PREVIEW_WORKER_NAME) {
    throw previewError(
      'Meta K3 Preview config requires the exact Worker name',
      'META_K3_PREVIEW_CONFIG_INVALID',
      { fieldName: 'name' },
    );
  }
  const previewEntrypoint = resolve(repositoryRoot, META_K3_PREVIEW_ENTRYPOINT);
  const output = structuredClone(source);
  output.main = previewEntrypoint;
  output.workers_dev = false;
  output.preview_urls = true;
  output.version_metadata = { binding: WORKER_VERSION_METADATA_BINDING };
  delete output.env;
  for (const key of FORBIDDEN_TOP_LEVEL_KEYS) delete output[key];

  const text = `${JSON.stringify(output, null, 2)}\n`;
  const parsed = parseJsoncObject(text);
  const forbidden = FORBIDDEN_TOP_LEVEL_KEYS.filter((key) => parsed[key] !== undefined);
  if (forbidden.length > 0
    || parsed.main !== previewEntrypoint
    || parsed.workers_dev !== false
    || parsed.preview_urls !== true
    || parsed.version_metadata?.binding !== WORKER_VERSION_METADATA_BINDING) {
    throw previewError(
      'Meta K3 generated Preview config is not isolated',
      'META_K3_PREVIEW_CONFIG_INVALID',
      { forbidden },
    );
  }

  return Object.freeze({
    text,
    sha256: sha256(text),
    workerName: parsed.name,
    previewEntrypoint,
    trueFlags: Object.freeze(readTrueFlags(parsed.vars)),
    d1BindingCount: Array.isArray(parsed.d1_databases)
      ? parsed.d1_databases.length
      : 0,
    queueProducerCount: Array.isArray(parsed.queues?.producers)
      ? parsed.queues.producers.length
      : 0,
    queueConsumerCount: Array.isArray(parsed.queues?.consumers)
      ? parsed.queues.consumers.length
      : 0,
    routesCopied: 0,
    scheduleTriggersCopied: 0,
    workersDevEnabled: false,
    previewUrlsEnabled: true,
    secretValuesCopied: 0,
  });
}

export function parseMetaK3PreviewUpload(outputText, stdoutText, input = {}) {
  const parsed = parseWooCommerceDiagnosticsPreviewUpload(
    outputText,
    stdoutText,
    {
      previewAlias: requireText(input.previewAlias, 'previewAlias'),
      workerName: META_K3_PREVIEW_WORKER_NAME,
      accountWorkersDevSubdomain: requireText(
        input.accountWorkersDevSubdomain,
        'accountWorkersDevSubdomain',
      ),
    },
  );
  const recoveryUrl = new URL(
    META_K3_EXACT_RECOVERY_PATH,
    `${parsed.previewOrigin}/`,
  ).toString();
  return Object.freeze({
    versionId: parsed.versionId,
    previewOrigin: parsed.previewOrigin,
    recoveryUrl,
    previewOriginFingerprint: parsed.previewOriginFingerprint,
    wranglerPreviewUrlCrossCheckCount: parsed.wranglerPreviewUrlCrossCheckCount,
    aliasedPreviewUrlCount: parsed.aliasedPreviewUrlCount,
    versionedPreviewUrlCount: parsed.versionedPreviewUrlCount,
  });
}

export function validateMetaK3PreviewTransport(input = {}) {
  const baselineVersion = requireVersion(
    input.productionBaselineVersion,
    'productionBaselineVersion',
  );
  const currentVersion = requireVersion(
    input.productionCurrentVersion,
    'productionCurrentVersion',
  );
  const previewVersion = requireVersion(input.previewVersion, 'previewVersion');
  if (currentVersion !== baselineVersion || previewVersion === baselineVersion) {
    throw previewError(
      'Meta K3 Preview transport changed or reused Production version',
      'META_K3_PREVIEW_PRODUCTION_VERSION_DRIFT',
      {
        productionVersionUnchanged: currentVersion === baselineVersion,
        previewVersionDistinct: previewVersion !== baselineVersion,
      },
    );
  }
  return Object.freeze({
    accepted: true,
    executionTransport: 'preview_version_upload',
    productionBaselineVersion: baselineVersion,
    productionCurrentVersion: currentVersion,
    previewVersion,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    workerDeploymentCount: 0,
    workerVersionUploadCount: 1,
  });
}

function readTrueFlags(varsInput) {
  if (!varsInput || typeof varsInput !== 'object' || Array.isArray(varsInput)) {
    throw previewError(
      'Meta K3 Preview config requires a vars object',
      'META_K3_PREVIEW_CONFIG_INVALID',
      { fieldName: 'vars' },
    );
  }
  return Object.entries(varsInput)
    .filter(([name, value]) => EXECUTION_FLAG_PATTERN.test(name) && booleanLike(value))
    .map(([name]) => name)
    .sort();
}

function booleanLike(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return false;
}

function requireVersion(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!VERSION_ID.test(text)) {
    throw previewError(
      `${fieldName} must be a Worker version UUID`,
      'META_K3_PREVIEW_VERSION_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw previewError(
      `${fieldName} is required`,
      'META_K3_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function previewError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
