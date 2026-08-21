import { createHash } from 'node:crypto';

export const LARK_BASE_JS_SDK_VERSION = '1.0.2';
export const LARK_BASE_JS_SDK_CDN_ROOT = `https://cdn.jsdelivr.net/npm/@lark-base-open/js-sdk@${LARK_BASE_JS_SDK_VERSION}/dist/`;
export const LARK_BASE_JS_SDK_ENTRY_URL = `${LARK_BASE_JS_SDK_CDN_ROOT}index.mjs`;
export const LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH = '/lark-base-js-sdk.mjs';
export const LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX = '/lark-base-js-sdk/';

const MAX_MODULES = 256;
const MAX_TOTAL_BYTES = 4_000_000;
const MIN_TOTAL_BYTES = 100_000;

export async function loadPinnedLarkBaseJsSdkMirror({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_FETCH_UNAVAILABLE', 'A fetch implementation is required to mirror the pinned Base JS SDK');
  }

  const queue = [LARK_BASE_JS_SDK_ENTRY_URL];
  const seen = new Set();
  const modules = new Map();
  let totalBytes = 0;
  let containsBitable = false;

  while (queue.length > 0) {
    const requestedUrl = queue.shift();
    if (seen.has(requestedUrl)) continue;
    if (seen.size >= MAX_MODULES) {
      throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_TOO_LARGE', 'Pinned Base JS SDK module graph exceeds the fail-closed module limit', {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        maxModules: MAX_MODULES,
      });
    }
    seen.add(requestedUrl);

    let response;
    try {
      response = await fetchImpl(requestedUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: 'text/javascript, application/javascript;q=0.9, */*;q=0.1',
          'User-Agent': 'social-marketing-integration/customer-base-view-ui-parity',
        },
      });
    } catch (error) {
      throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_FETCH_FAILED', 'Unable to fetch the pinned Base JS SDK module graph before starting the local runner', {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        requestedUrl,
        cause: error?.message ?? String(error),
      });
    }

    if (!response?.ok) {
      throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_FETCH_FAILED', 'Pinned Base JS SDK module fetch returned a non-success response', {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        requestedUrl,
        status: response?.status ?? null,
      });
    }

    const resolvedUrl = response.url || requestedUrl;
    assertPinnedCdnUrl(resolvedUrl);
    const originalBody = await response.text();
    const originalBytes = Buffer.byteLength(originalBody, 'utf8');
    totalBytes += originalBytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_TOO_LARGE', 'Pinned Base JS SDK module graph exceeds the fail-closed byte limit', {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        maxBytes: MAX_TOTAL_BYTES,
        actualBytes: totalBytes,
      });
    }
    if (originalBody.includes('bitable')) containsBitable = true;

    const specifiers = extractModuleSpecifiers(originalBody);
    const replacements = new Map();
    for (const specifier of specifiers) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_EXTERNAL_IMPORT', 'Pinned Base JS SDK contains a non-relative module import outside the mirrored package graph', {
          sdkVersion: LARK_BASE_JS_SDK_VERSION,
          moduleUrl: resolvedUrl,
          specifier,
        });
      }
      const childUrl = new URL(specifier, resolvedUrl).href;
      assertPinnedCdnUrl(childUrl);
      const localPath = localPathForPinnedModule(childUrl);
      replacements.set(specifier, localPath);
      if (!seen.has(childUrl)) queue.push(childUrl);
    }

    const localPath = resolvedUrl === LARK_BASE_JS_SDK_ENTRY_URL
      ? LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH
      : localPathForPinnedModule(resolvedUrl);
    modules.set(localPath, rewriteModuleSpecifiers(originalBody, replacements));
  }

  const entryBody = modules.get(LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH);
  if (!entryBody) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_ENTRY_MISSING', 'Pinned Base JS SDK entry module was not mirrored');
  }
  if (totalBytes < MIN_TOTAL_BYTES || !containsBitable) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_INVALID', 'Pinned Base JS SDK mirrored graph failed the local integrity shape check', {
      sdkVersion: LARK_BASE_JS_SDK_VERSION,
      minimumBytes: MIN_TOTAL_BYTES,
      actualBytes: totalBytes,
      containsBitable,
    });
  }

  const graphFingerprint = createHash('sha256');
  for (const [path, body] of [...modules.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    graphFingerprint.update(path);
    graphFingerprint.update('\0');
    graphFingerprint.update(createHash('sha256').update(body).digest('hex'));
    graphFingerprint.update('\n');
  }

  return Object.freeze({
    version: LARK_BASE_JS_SDK_VERSION,
    deliveryMode: 'same-origin-pinned-jsdelivr-module-graph',
    entryBody,
    modules,
    moduleCount: modules.size,
    bytes: totalBytes,
    sha256: graphFingerprint.digest('hex'),
  });
}

export function localPathForPinnedModule(urlValue) {
  const url = new URL(urlValue);
  assertPinnedCdnUrl(url.href);
  const root = new URL(LARK_BASE_JS_SDK_CDN_ROOT);
  const relativePath = url.pathname.slice(root.pathname.length);
  if (!relativePath || relativePath.includes('..')) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_PATH_INVALID', 'Pinned Base JS SDK module path is outside the approved dist root', {
      sdkVersion: LARK_BASE_JS_SDK_VERSION,
      url: url.href,
    });
  }
  return `${LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX}${relativePath}`;
}

export function extractModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

export function rewriteModuleSpecifiers(source, replacements) {
  let result = source;
  for (const [specifier, replacement] of replacements.entries()) {
    result = result
      .replaceAll(`'${specifier}'`, `'${replacement}'`)
      .replaceAll(`"${specifier}"`, `"${replacement}"`);
  }
  return result;
}

function assertPinnedCdnUrl(urlValue) {
  const url = new URL(urlValue);
  const root = new URL(LARK_BASE_JS_SDK_CDN_ROOT);
  if (url.protocol !== 'https:' || url.hostname !== root.hostname || !url.pathname.startsWith(root.pathname)) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_SDK_ORIGIN_MISMATCH', 'Pinned Base JS SDK module graph attempted to leave the exact versioned jsDelivr dist root', {
      sdkVersion: LARK_BASE_JS_SDK_VERSION,
      url: url.href,
    });
  }
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
