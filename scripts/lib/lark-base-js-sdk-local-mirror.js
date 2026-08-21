import { createHash } from 'node:crypto';

export const LARK_BASE_JS_SDK_VERSION = '1.0.2';
export const LARK_BASE_JS_SDK_CDN_ROOT = `https://cdn.jsdelivr.net/npm/@lark-base-open/js-sdk@${LARK_BASE_JS_SDK_VERSION}/dist/`;
export const LARK_BASE_JS_SDK_ENTRY_URL = `${LARK_BASE_JS_SDK_CDN_ROOT}index.mjs`;
export const LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH = '/lark-base-js-sdk.mjs';
export const LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX = '/lark-base-js-sdk/';
export const LARK_BASE_JS_SDK_ESBUILD_VERSION = '0.28.1';

const VIRTUAL_ENTRY_PATH = `${LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX}index.mjs`;
const SDK_NAMESPACE = 'customer-base-lark-sdk';
const MAX_MODULES = 256;
const MAX_TOTAL_SOURCE_BYTES = 4_000_000;
const MIN_TOTAL_SOURCE_BYTES = 100_000;
const MIN_BUNDLE_BYTES = 100_000;

export async function loadPinnedLarkBaseJsSdkMirror({
  fetchImpl = globalThis.fetch,
  esbuildImpl = null,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_FETCH_UNAVAILABLE',
      'A fetch implementation is required to bundle the pinned Base JS SDK',
    );
  }

  const esbuild = esbuildImpl ?? await loadLockedEsbuild();
  if (typeof esbuild?.build !== 'function') {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLER_UNAVAILABLE',
      'The locked esbuild implementation is unavailable',
      { expectedEsbuildVersion: LARK_BASE_JS_SDK_ESBUILD_VERSION },
    );
  }
  if (typeof esbuild.version === 'string' && esbuild.version !== LARK_BASE_JS_SDK_ESBUILD_VERSION) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLER_VERSION_MISMATCH',
      'The installed esbuild version does not match the repository lock authority',
      {
        expectedEsbuildVersion: LARK_BASE_JS_SDK_ESBUILD_VERSION,
        actualEsbuildVersion: esbuild.version,
      },
    );
  }

  const sourceByVirtualPath = new Map();
  let totalSourceBytes = 0;
  let containsBitable = false;

  const plugin = {
    name: 'customer-base-pinned-lark-sdk',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return { path: VIRTUAL_ENTRY_PATH, namespace: SDK_NAMESPACE };
        }

        let targetPath = null;
        if (args.path.startsWith('./') || args.path.startsWith('../')) {
          const importerUrl = upstreamUrlForVirtualPath(args.importer);
          const targetUrl = new URL(args.path, importerUrl).href;
          assertPinnedCdnUrl(targetUrl);
          targetPath = virtualPathForPinnedModule(targetUrl);
        } else if (args.path.startsWith(LARK_BASE_JS_SDK_CDN_ROOT)) {
          assertPinnedCdnUrl(args.path);
          targetPath = virtualPathForPinnedModule(args.path);
        } else if (args.path.startsWith(LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX)) {
          targetPath = args.path;
        } else {
          throw codedError(
            'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_EXTERNAL_IMPORT',
            'Pinned Base JS SDK contains an import outside the exact versioned package graph',
            {
              sdkVersion: LARK_BASE_JS_SDK_VERSION,
              importer: args.importer,
              specifier: args.path,
            },
          );
        }

        return { path: targetPath, namespace: SDK_NAMESPACE };
      });

      build.onLoad({ filter: /.*/, namespace: SDK_NAMESPACE }, async (args) => {
        if (sourceByVirtualPath.has(args.path)) {
          return { contents: sourceByVirtualPath.get(args.path), loader: 'js' };
        }
        if (sourceByVirtualPath.size >= MAX_MODULES) {
          throw codedError(
            'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_TOO_LARGE',
            'Pinned Base JS SDK exceeds the fail-closed module limit',
            { sdkVersion: LARK_BASE_JS_SDK_VERSION, maxModules: MAX_MODULES },
          );
        }

        const requestedUrl = upstreamUrlForVirtualPath(args.path);
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
          throw codedError(
            'CUSTOMER_BASE_VIEW_UI_SDK_FETCH_FAILED',
            'Unable to fetch the pinned Base JS SDK while producing the local single bundle',
            {
              sdkVersion: LARK_BASE_JS_SDK_VERSION,
              requestedUrl,
              cause: error?.message ?? String(error),
            },
          );
        }

        if (!response?.ok) {
          throw codedError(
            'CUSTOMER_BASE_VIEW_UI_SDK_FETCH_FAILED',
            'Pinned Base JS SDK module fetch returned a non-success response',
            {
              sdkVersion: LARK_BASE_JS_SDK_VERSION,
              requestedUrl,
              status: response?.status ?? null,
            },
          );
        }

        const resolvedUrl = response.url || requestedUrl;
        assertPinnedCdnUrl(resolvedUrl);
        assertRedirectCompatibility(requestedUrl, resolvedUrl);

        const source = await response.text();
        const sourceBytes = Buffer.byteLength(source, 'utf8');
        totalSourceBytes += sourceBytes;
        if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
          throw codedError(
            'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_TOO_LARGE',
            'Pinned Base JS SDK exceeds the fail-closed source byte limit',
            {
              sdkVersion: LARK_BASE_JS_SDK_VERSION,
              maxBytes: MAX_TOTAL_SOURCE_BYTES,
              actualBytes: totalSourceBytes,
            },
          );
        }
        if (source.includes('bitable')) containsBitable = true;
        sourceByVirtualPath.set(args.path, source);
        return { contents: source, loader: 'js' };
      });
    },
  };

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [VIRTUAL_ENTRY_PATH],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      write: false,
      sourcemap: false,
      minify: false,
      treeShaking: false,
      legalComments: 'none',
      metafile: true,
      logLevel: 'silent',
      plugins: [plugin],
    });
  } catch (error) {
    const codedDetail = error?.errors?.find((item) => item?.detail?.code)?.detail;
    if (codedDetail?.code) throw codedDetail;
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLE_FAILED',
      'Unable to bundle the exact pinned Base JS SDK into one browser module',
      {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        expectedEsbuildVersion: LARK_BASE_JS_SDK_ESBUILD_VERSION,
        cause: error?.message ?? String(error),
      },
    );
  }

  if (totalSourceBytes < MIN_TOTAL_SOURCE_BYTES || !containsBitable) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_INVALID',
      'Pinned Base JS SDK source graph failed the integrity shape check',
      {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        minimumBytes: MIN_TOTAL_SOURCE_BYTES,
        actualBytes: totalSourceBytes,
        containsBitable,
      },
    );
  }

  const outputFiles = Array.isArray(result?.outputFiles) ? result.outputFiles : [];
  if (outputFiles.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLE_NOT_SINGLE_FILE',
      'Pinned Base JS SDK bundler did not produce exactly one browser module',
      { sdkVersion: LARK_BASE_JS_SDK_VERSION, outputFileCount: outputFiles.length },
    );
  }

  const remainingImports = Object.values(result?.metafile?.outputs ?? {})
    .flatMap((output) => output?.imports ?? []);
  if (remainingImports.length !== 0) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLE_NOT_STANDALONE',
      'Pinned Base JS SDK single bundle still contains runtime module imports',
      {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        remainingImportCount: remainingImports.length,
        remainingImports: remainingImports.slice(0, 10).map((item) => item.path),
      },
    );
  }

  const entryBody = outputFiles[0].text;
  const bundleBytes = Buffer.byteLength(entryBody, 'utf8');
  if (bundleBytes < MIN_BUNDLE_BYTES || !entryBody.includes('bitable')) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLE_INVALID',
      'Pinned Base JS SDK single bundle failed the output integrity shape check',
      {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        minimumBytes: MIN_BUNDLE_BYTES,
        actualBytes: bundleBytes,
        containsBitable: entryBody.includes('bitable'),
      },
    );
  }

  return Object.freeze({
    version: LARK_BASE_JS_SDK_VERSION,
    deliveryMode: 'same-origin-pinned-esbuild-single-bundle',
    entryBody,
    modules: new Map(),
    moduleCount: sourceByVirtualPath.size,
    bytes: bundleBytes,
    sourceBytes: totalSourceBytes,
    sha256: createHash('sha256').update(entryBody).digest('hex'),
    esbuildVersion: esbuild.version ?? LARK_BASE_JS_SDK_ESBUILD_VERSION,
  });
}

export function localPathForPinnedModule(urlValue) {
  const url = new URL(urlValue);
  assertPinnedCdnUrl(url.href);
  const root = new URL(LARK_BASE_JS_SDK_CDN_ROOT);
  const relativePath = url.pathname.slice(root.pathname.length);
  if (!relativePath || relativePath.includes('..')) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_PATH_INVALID',
      'Pinned Base JS SDK module path is outside the approved dist root',
      { sdkVersion: LARK_BASE_JS_SDK_VERSION, url: url.href },
    );
  }
  return `${LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX}${relativePath}`;
}

function virtualPathForPinnedModule(urlValue) {
  return localPathForPinnedModule(urlValue);
}

function upstreamUrlForVirtualPath(virtualPath) {
  if (virtualPath === VIRTUAL_ENTRY_PATH) return LARK_BASE_JS_SDK_ENTRY_URL;
  if (!virtualPath.startsWith(LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX)) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_PATH_INVALID',
      'Virtual Base JS SDK module path is outside the approved local namespace',
      { sdkVersion: LARK_BASE_JS_SDK_VERSION, virtualPath },
    );
  }
  const relativePath = virtualPath.slice(LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX.length);
  if (!relativePath || relativePath.includes('..')) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_PATH_INVALID',
      'Virtual Base JS SDK module path is invalid',
      { sdkVersion: LARK_BASE_JS_SDK_VERSION, virtualPath },
    );
  }
  const url = `${LARK_BASE_JS_SDK_CDN_ROOT}${relativePath}`;
  assertPinnedCdnUrl(url);
  return url;
}

function assertRedirectCompatibility(requestedUrl, resolvedUrl) {
  const requested = new URL(requestedUrl);
  const resolved = new URL(resolvedUrl);
  if (requested.pathname !== resolved.pathname) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_REDIRECT_PATH_CHANGED',
      'Pinned Base JS SDK CDN redirected a module to a different package path',
      {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        requestedUrl,
        resolvedUrl,
      },
    );
  }
}

function assertPinnedCdnUrl(urlValue) {
  const url = new URL(urlValue);
  const root = new URL(LARK_BASE_JS_SDK_CDN_ROOT);
  if (url.protocol !== 'https:' || url.hostname !== root.hostname || !url.pathname.startsWith(root.pathname)) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_ORIGIN_MISMATCH',
      'Pinned Base JS SDK attempted to leave the exact versioned jsDelivr dist root',
      { sdkVersion: LARK_BASE_JS_SDK_VERSION, url: url.href },
    );
  }
}

async function loadLockedEsbuild() {
  try {
    const module = await import('esbuild');
    return {
      build: module.build ?? module.default?.build,
      version: module.version ?? module.default?.version,
    };
  } catch (error) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLER_UNAVAILABLE',
      'Repository-locked esbuild could not be loaded',
      {
        expectedEsbuildVersion: LARK_BASE_JS_SDK_ESBUILD_VERSION,
        cause: error?.message ?? String(error),
      },
    );
  }
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
