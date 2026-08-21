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

    const requestedLocalPath = requestedUrl === LARK_BASE_JS_SDK_ENTRY_URL
      ? LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH
      : localPathForPinnedModule(requestedUrl);
    modules.set(requestedLocalPath, rewriteModuleSpecifiers(originalBody, replacements));
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

  assertMirroredGraphClosure(modules);

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
  return [...new Set(scanModuleSpecifierRecords(source).map((record) => record.specifier))];
}

export function rewriteModuleSpecifiers(source, replacements) {
  const records = scanModuleSpecifierRecords(source)
    .filter((record) => replacements.has(record.specifier));
  if (records.length === 0) return source;

  let cursor = 0;
  let result = '';
  for (const record of records) {
    result += source.slice(cursor, record.start);
    result += replacements.get(record.specifier);
    cursor = record.end;
  }
  return result + source.slice(cursor);
}

export function assertMirroredGraphClosure(modules) {
  for (const [modulePath, body] of modules.entries()) {
    for (const specifier of extractModuleSpecifiers(body)) {
      if (!specifier.startsWith(LARK_BASE_JS_SDK_MODULE_LOCAL_PREFIX)) {
        throw codedError(
          'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_NOT_CLOSED',
          'Mirrored Base JS SDK still contains a module import outside the same-origin module graph',
          { sdkVersion: LARK_BASE_JS_SDK_VERSION, modulePath, specifier },
        );
      }
      if (!modules.has(specifier)) {
        throw codedError(
          'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_NOT_CLOSED',
          'Mirrored Base JS SDK references a same-origin module that is absent from the local graph',
          { sdkVersion: LARK_BASE_JS_SDK_VERSION, modulePath, missingLocalPath: specifier },
        );
      }
    }
  }
}

function scanModuleSpecifierRecords(source) {
  const records = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (char === '\'' || char === '"') {
      index = skipQuotedLiteral(source, index);
      continue;
    }
    if (char === '`') {
      index = skipTemplateLiteral(source, index);
      continue;
    }
    if (!isIdentifierStart(char)) {
      index += 1;
      continue;
    }

    const token = readIdentifier(source, index);
    if (token.value === 'import') {
      const record = parseImportSpecifier(source, token.end);
      if (record) records.push(record);
    } else if (token.value === 'export') {
      const record = parseExportSpecifier(source, token.end);
      if (record) records.push(record);
    }
    index = token.end;
  }

  return records.sort((left, right) => left.start - right.start);
}

function parseImportSpecifier(source, afterKeyword) {
  let cursor = skipTrivia(source, afterKeyword);
  if (source[cursor] === '.') return null;
  if (source[cursor] === '\'' || source[cursor] === '"') return readModuleString(source, cursor);

  if (source[cursor] === '(') {
    cursor = skipTrivia(source, cursor + 1);
    if (source[cursor] !== '\'' && source[cursor] !== '"') {
      throw codedError(
        'CUSTOMER_BASE_VIEW_UI_SDK_DYNAMIC_IMPORT_UNSUPPORTED',
        'Pinned Base JS SDK contains a non-literal dynamic import that cannot be mirrored fail-closed',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION },
      );
    }
    return readModuleString(source, cursor);
  }

  return findFromModuleSpecifier(source, cursor);
}

function parseExportSpecifier(source, afterKeyword) {
  const cursor = skipTrivia(source, afterKeyword);
  if (source[cursor] !== '*' && source[cursor] !== '{') return null;
  return findFromModuleSpecifier(source, cursor);
}

function findFromModuleSpecifier(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === ';') return null;
    if (char === '/' && source[cursor + 1] === '/') {
      cursor = skipLineComment(source, cursor + 2);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      cursor = skipBlockComment(source, cursor + 2);
      continue;
    }
    if (char === '\'' || char === '"') {
      cursor = skipQuotedLiteral(source, cursor);
      continue;
    }
    if (char === '`') {
      cursor = skipTemplateLiteral(source, cursor);
      continue;
    }
    if (!isIdentifierStart(char)) {
      cursor += 1;
      continue;
    }

    const token = readIdentifier(source, cursor);
    if (token.value === 'from') {
      const quoteIndex = skipTrivia(source, token.end);
      if (source[quoteIndex] !== '\'' && source[quoteIndex] !== '"') return null;
      return readModuleString(source, quoteIndex);
    }
    cursor = token.end;
  }
  return null;
}

function readModuleString(source, quoteIndex) {
  const quote = source[quoteIndex];
  let cursor = quoteIndex + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      throw codedError(
        'CUSTOMER_BASE_VIEW_UI_SDK_SPECIFIER_ESCAPE_UNSUPPORTED',
        'Pinned Base JS SDK module specifier contains an escape sequence and is not mirrored by textual guesswork',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION },
      );
    }
    if (char === quote) {
      return Object.freeze({
        specifier: source.slice(quoteIndex + 1, cursor),
        start: quoteIndex + 1,
        end: cursor,
      });
    }
    if (char === '\n' || char === '\r') break;
    cursor += 1;
  }
  throw codedError(
    'CUSTOMER_BASE_VIEW_UI_SDK_SPECIFIER_INVALID',
    'Pinned Base JS SDK contains an unterminated module specifier',
    { sdkVersion: LARK_BASE_JS_SDK_VERSION },
  );
}

function skipTrivia(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    if (isWhitespace(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '/') {
      cursor = skipLineComment(source, cursor + 2);
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      cursor = skipBlockComment(source, cursor + 2);
      continue;
    }
    break;
  }
  return cursor;
}

function skipQuotedLiteral(source, quoteIndex) {
  const quote = source[quoteIndex];
  let cursor = quoteIndex + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipTemplateLiteral(source, tickIndex) {
  let cursor = tickIndex + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === '`') return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function skipLineComment(source, start) {
  let cursor = start;
  while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') cursor += 1;
  return cursor;
}

function skipBlockComment(source, start) {
  const end = source.indexOf('*/', start);
  return end === -1 ? source.length : end + 2;
}

function readIdentifier(source, start) {
  let end = start + 1;
  while (end < source.length && isIdentifierPart(source[end])) end += 1;
  return { value: source.slice(start, end), end };
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function isIdentifierStart(char) {
  return typeof char === 'string' && /[A-Za-z_$]/u.test(char);
}

function isIdentifierPart(char) {
  return typeof char === 'string' && /[A-Za-z0-9_$]/u.test(char);
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
