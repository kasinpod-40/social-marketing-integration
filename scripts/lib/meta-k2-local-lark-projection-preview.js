import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  META_K2_LOCAL_LARK_PROJECTION_MODE,
  META_K2_LOCAL_LARK_PROJECTION_PATH,
} from '../../packages/config/src/meta-k2-local-lark-projection-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  buildMetaK2PreviewRuntimeConfig,
  META_K2_PREVIEW_WORKER_NAME,
} from './meta-k2-preview-recovery.js';
import { buildWooCommerceDiagnosticsPreviewOrigin } from './woocommerce-diagnostics-preview-upload.js';

export const META_K2_LOCAL_LARK_PROJECTION_PREVIEW_ENTRYPOINT =
  'apps/sync-worker/src/meta-k2-local-lark-projection-preview-entry.js';

/** Isolated Preview config for one exact Customer K2 Work; it has no traffic, cron, or Queue ingress. */
export function buildMetaK2LocalLarkProjectionPreviewConfig(sourceText, input = {}) {
  const repositoryRoot = requireText(input.repositoryRoot, 'repositoryRoot');
  const base = buildMetaK2PreviewRuntimeConfig(sourceText, {
    repositoryRoot,
    previewEntrypoint: META_K2_LOCAL_LARK_PROJECTION_PREVIEW_ENTRYPOINT,
  });
  const output = parseJsoncObject(base.text);
  const operationId = requireText(input.operationId, 'operationId');
  const workKey = requireText(input.workKey, 'workKey');
  const generation = requireGeneration(input.generation, 'generation');
  const tokenSha256 = requireSha256(input.tokenSha256, 'tokenSha256');
  output.vars = {
    ...output.vars,
    MKT_META_K2_LOCAL_LARK_PROJECTION_MODE: META_K2_LOCAL_LARK_PROJECTION_MODE,
    MKT_META_K2_LOCAL_LARK_PROJECTION_OPERATION_ID: operationId,
    MKT_META_K2_LOCAL_LARK_PROJECTION_WORK_KEY: workKey,
    MKT_META_K2_LOCAL_LARK_PROJECTION_GENERATION: String(generation),
    MKT_META_K2_LOCAL_LARK_PROJECTION_TOKEN_SHA256: tokenSha256,
  };
  delete output.queues;
  const text = `${JSON.stringify(output, null, 2)}\n`;
  const parsed = parseJsoncObject(text);
  if (parsed.main !== resolve(repositoryRoot, META_K2_LOCAL_LARK_PROJECTION_PREVIEW_ENTRYPOINT)
    || parsed.workers_dev !== false || parsed.preview_urls !== true
    || parsed.queues !== undefined || parsed.routes !== undefined || parsed.triggers !== undefined) {
    throw previewError('Meta K2 local Lark Projection Preview config is not isolated', 'META_K2_LOCAL_LARK_PROJECTION_PREVIEW_CONFIG_INVALID');
  }
  return Object.freeze({
    text,
    sha256: sha256(text),
    workerName: parsed.name,
    previewEntrypoint: parsed.main,
    operationId,
    workKey,
    generation,
    queueProducerCount: 0,
    queueConsumerCount: 0,
    routesCopied: 0,
    scheduleTriggersCopied: 0,
    secretValuesCopied: 0,
  });
}

export function buildMetaK2LocalLarkProjectionUrl(input = {}) {
  const origin = buildWooCommerceDiagnosticsPreviewOrigin({
    previewAlias: requireText(input.previewAlias, 'previewAlias'),
    workerName: META_K2_PREVIEW_WORKER_NAME,
    accountWorkersDevSubdomain: requireText(input.accountWorkersDevSubdomain, 'accountWorkersDevSubdomain'),
  });
  return new URL(META_K2_LOCAL_LARK_PROJECTION_PATH, `${origin}/`).toString();
}

function requireGeneration(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw previewError(`${fieldName} must be a timestamp`, 'META_K2_LOCAL_LARK_PROJECTION_PREVIEW_INPUT_INVALID');
  }
  return number;
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw previewError(`${fieldName} must be SHA-256`, 'META_K2_LOCAL_LARK_PROJECTION_PREVIEW_INPUT_INVALID');
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw previewError(`${fieldName} is required`, 'META_K2_LOCAL_LARK_PROJECTION_PREVIEW_INPUT_INVALID');
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function previewError(message, code) {
  return permanentError(message, { code });
}
