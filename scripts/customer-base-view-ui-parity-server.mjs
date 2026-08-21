import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { buildLarkBaseViewManualParityManifest } from './lib/lark-base-view-manual-parity-manifest.js';
import { loadPinnedLarkBaseJsSdkMirror } from './lib/lark-base-js-sdk-local-mirror.js';
import {
  assessLarkBaseViewUiPlanAuthority,
  assessLarkBaseViewUiRefreshSourceAuthority,
  buildLarkBaseViewJsSdkParityPlan,
} from './lib/lark-base-view-js-sdk-parity.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const LARK_BASE_JS_SDK_VERSION = '1.0.2';
const LARK_BASE_JS_SDK_ENTRY_URL = `https://esm.sh/@lark-base-open/js-sdk@${LARK_BASE_JS_SDK_VERSION}?standalone&target=es2022`;
const LARK_BASE_JS_SDK_MIN_BYTES = 20_000;
const LARK_BASE_JS_SDK_MAX_MODULE_HOPS = 3;
const BASELINE_SOURCE_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const CHECKPOINT_SHA256 = '7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053';
const DEFAULT_CHECKPOINT_FILE = join(homedir(), 'Downloads', 'customer-base-controlled-apply-checkpoint.json');
const SOURCE_NAME_PATTERN = /^Social MKT Data Hub.*\.base$/u;
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';

try {
  const checkpointFile = process.env.CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_FILE
    ?? DEFAULT_CHECKPOINT_FILE;
  const checkpoint = await readVerifiedCheckpoint(checkpointFile);
  const sourceAuthority = await resolveSourceAuthority({ checkpoint });
  const { sourceFile, inspection, plan } = sourceAuthority;
  const host = resolveHost(process.env.CUSTOMER_BASE_VIEW_UI_HOST);
  const publicHost = resolveHost(process.env.CUSTOMER_BASE_VIEW_UI_PUBLIC_HOST ?? host);
  const port = resolvePort(process.env.CUSTOMER_BASE_VIEW_UI_PORT);
  const publicUrl = `http://${formatUrlHost(publicHost)}:${port}`;

  const sdkBundle = await loadPinnedLarkBaseJsSdkMirror();
  const browserScript = await readFile(
    fileURLToPath(new URL('./customer-base-view-ui-parity.browser.js', import.meta.url)),
    'utf8',
  );
  const html = renderHtml({
    sourceSha256: inspection.file.sha256,
    sourceFileName: basename(sourceFile),
    sourceSelectionMode: sourceAuthority.selectionMode,
    sourcePlanAuthorityMode: sourceAuthority.planAuthorityMode,
    plan,
  });

  const server = createServer((request, response) => {
    setCrossOriginHeaders(request, response);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? '/', publicUrl);
    const path = requestUrl.pathname;
    console.log(`[view-ui-local] ${request.method ?? 'GET'} ${path}${requestUrl.search} origin=${request.headers.origin ?? '-'}`);

    if (path === '/' || path === '/index.html') {
      send(response, 200, 'text/html; charset=utf-8', html, request.method);
      return;
    }
    if (path === '/app.js') {
      send(response, 200, 'text/javascript; charset=utf-8', browserScript, request.method);
      return;
    }
    if (path === '/lark-base-js-sdk.mjs') {
      send(response, 200, 'text/javascript; charset=utf-8', sdkBundle.entryBody, request.method);
      return;
    }
    if (path.startsWith('/lark-base-js-sdk/')) {
      const sdkModule = sdkBundle.modules.get(path);
      if (!sdkModule) {
        send(response, 404, 'text/plain; charset=utf-8', 'Pinned SDK module not found\n', request.method);
        return;
      }
      send(response, 200, 'text/javascript; charset=utf-8', sdkModule, request.method);
      return;
    }
    if (path === '/client-event') {
      send(response, 204, 'text/plain; charset=utf-8', '', request.method);
      return;
    }
    if (path === '/plan.json') {
      send(response, 200, 'application/json; charset=utf-8', `${JSON.stringify(plan)}\n`, request.method);
      return;
    }
    if (path === '/health') {
      send(response, 200, 'application/json; charset=utf-8', `${JSON.stringify({
        ok: true,
        service: 'customer-base-view-ui-parity',
        mode: 'local-refresh-compatible-source-plan-plus-base-js-sdk-ui',
        bindHost: host,
        publicUrl,
        sdkDeliveryMode: sdkBundle.deliveryMode,
        sdkVersion: sdkBundle.version,
        sdkSha256: sdkBundle.sha256,
        sdkBytes: sdkBundle.bytes,
        sdkModuleCount: sdkBundle.moduleCount,
        sourceFileName: basename(sourceFile),
        sourceSha256: inspection.file.sha256,
        sourceSelectionMode: sourceAuthority.selectionMode,
        sourcePlanAuthorityMode: sourceAuthority.planAuthorityMode,
        tables: plan.summary.tableCount,
        views: plan.summary.viewCount,
      })}\n`, request.method);
      return;
    }
    send(response, 404, 'text/plain; charset=utf-8', 'Not found\n', request.method);
  });

  server.listen(port, host, () => {
    console.log('\n=== COPY THIS SUMMARY JSON ===');
    console.log(JSON.stringify({
      ok: true,
      stage: 'customer-base-view-ui-parity-server',
      status: 'READY',
      bindHost: host,
      url: publicUrl,
      sdkDeliveryMode: sdkBundle.deliveryMode,
      sdkVersion: sdkBundle.version,
      sdkSha256: sdkBundle.sha256,
      sdkBytes: sdkBundle.bytes,
      sdkModuleCount: sdkBundle.moduleCount,
      sourceFileName: basename(sourceFile),
      sourceSha256: inspection.file.sha256,
      sourceSelectionMode: sourceAuthority.selectionMode,
      sourcePlanAuthorityMode: sourceAuthority.planAuthorityMode,
      sourceRecords: inspection.counts.records,
      tables: plan.summary.tableCount,
      views: plan.summary.viewCount,
      sortViews: plan.summary.sortViews,
      baseJsSdkMutations: plan.ownership.baseJsSdkMutations,
      remainingManual: plan.ownership.remainingManual,
      sourceMutationCount: 0,
      remoteMutationCount: 0,
    }, null, 2));
  });
} catch (error) {
  console.error('\n=== COPY THIS SUMMARY JSON ===');
  console.error(JSON.stringify({
    ok: false,
    stage: 'customer-base-view-ui-parity-server',
    status: 'ERROR',
    code: error?.code ?? 'CUSTOMER_BASE_VIEW_UI_PARITY_SERVER_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    sourceMutationCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 1;
}

async function loadPinnedLarkBaseJsSdk() {
  let currentUrl = LARK_BASE_JS_SDK_ENTRY_URL;
  let body = '';
  let resolvedUrl = null;

  for (let hop = 0; hop <= LARK_BASE_JS_SDK_MAX_MODULE_HOPS; hop += 1) {
    let response;
    try {
      response = await fetch(currentUrl, {
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
        'Unable to fetch the pinned Base JS SDK before starting the local runner',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION, cause: error?.message ?? String(error) },
      );
    }

    if (!response.ok) {
      throw codedError(
        'CUSTOMER_BASE_VIEW_UI_SDK_FETCH_FAILED',
        'Pinned Base JS SDK fetch returned a non-success response',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION, status: response.status },
      );
    }

    resolvedUrl = response.url;
    body = await response.text();
    const moduleSpecifiers = extractModuleSpecifiers(body);
    const rootRelative = [...new Set(moduleSpecifiers.filter((specifier) => specifier.startsWith('/')))];

    if (rootRelative.length === 0) break;
    if (rootRelative.length !== 1) {
      throw codedError(
        'CUSTOMER_BASE_VIEW_UI_SDK_NOT_STANDALONE',
        'Pinned Base JS SDK resolver returned multiple unresolved module paths',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION, unresolvedModuleCount: rootRelative.length },
      );
    }
    if (hop === LARK_BASE_JS_SDK_MAX_MODULE_HOPS) {
      throw codedError(
        'CUSTOMER_BASE_VIEW_UI_SDK_NOT_STANDALONE',
        'Pinned Base JS SDK did not resolve to a standalone browser module',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION },
      );
    }

    const nextUrl = new URL(rootRelative[0], resolvedUrl);
    if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'esm.sh') {
      throw codedError(
        'CUSTOMER_BASE_VIEW_UI_SDK_ORIGIN_MISMATCH',
        'Pinned Base JS SDK resolver attempted to leave the approved esm.sh origin',
        { sdkVersion: LARK_BASE_JS_SDK_VERSION, hostname: nextUrl.hostname },
      );
    }
    currentUrl = nextUrl.href;
  }

  const unresolved = extractModuleSpecifiers(body);
  if (unresolved.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_NOT_STANDALONE',
      'Pinned Base JS SDK still contains browser module dependencies after standalone resolution',
      { sdkVersion: LARK_BASE_JS_SDK_VERSION, unresolvedModuleCount: unresolved.length },
    );
  }
  if (Buffer.byteLength(body, 'utf8') < LARK_BASE_JS_SDK_MIN_BYTES || !body.includes('bitable')) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLE_INVALID',
      'Pinned Base JS SDK bundle failed the local integrity shape check',
      {
        sdkVersion: LARK_BASE_JS_SDK_VERSION,
        minimumBytes: LARK_BASE_JS_SDK_MIN_BYTES,
        actualBytes: Buffer.byteLength(body, 'utf8'),
      },
    );
  }

  return Object.freeze({
    version: LARK_BASE_JS_SDK_VERSION,
    body,
    bytes: Buffer.byteLength(body, 'utf8'),
    sha256: fingerprint(body),
    resolvedUrl,
  });
}

function extractModuleSpecifiers(source) {
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

async function resolveSourceAuthority({ checkpoint }) {
  const configured = optionalText(process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE);
  const candidatePaths = configured ? [configured] : await discoverSourceCandidates();
  const checked = [];
  const compatible = [];
  const expectedTableNames = requireExpectedTableNames(checkpoint?.expectedTableNames);

  for (const sourceFile of [...new Set(candidatePaths)]) {
    let inspection = null;
    try {
      inspection = await inspectLarkBaseExport(sourceFile);
      assertStructuralAuthority(inspection);
      const sourceClient = await createLarkBaseExportSourceClient(sourceFile, {
        excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
      });
      const manifest = await buildLarkBaseViewManualParityManifest({ sourceClient });
      const plan = buildLarkBaseViewJsSdkParityPlan(manifest);
      const planAuthority = assertPlan(plan, inspection.file.sha256);
      assertCloneScope(plan, expectedTableNames);
      const metadata = await stat(sourceFile);
      compatible.push(Object.freeze({
        sourceFile,
        inspection,
        plan,
        planAuthorityMode: planAuthority.authorityMode,
        planFingerprintSha256: fingerprint(JSON.stringify(plan)),
        mtimeMs: Number(metadata.mtimeMs),
      }));
      checked.push(Object.freeze({
        fileName: basename(sourceFile),
        status: 'compatible',
        sha256: inspection.file.sha256,
        records: inspection.counts.records,
        planAuthorityMode: planAuthority.authorityMode,
      }));
    } catch (error) {
      checked.push(Object.freeze({
        fileName: basename(sourceFile),
        status: 'rejected',
        sha256: inspection?.file?.sha256 ?? null,
        code: error?.code ?? 'SOURCE_REJECTED',
        details: error?.details ?? {},
      }));
    }
  }

  if (compatible.length === 0) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SOURCE_AUTHORITY_NOT_FOUND',
      'No Desktop/Downloads Source export is refresh-compatible and clone-scope compatible with the retained checkpoint',
      { checked },
    );
  }

  const layoutFingerprints = new Set(compatible.map((item) => item.planFingerprintSha256));
  if (layoutFingerprints.size > 1) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SOURCE_LAYOUT_AMBIGUOUS',
      'Multiple compatible Source exports contain different View UI layouts; selection is blocked before Lark mutation',
      {
        candidates: compatible.map((item) => ({
          fileName: basename(item.sourceFile),
          sha256: item.inspection.file.sha256,
          records: item.inspection.counts.records,
          planAuthorityMode: item.planAuthorityMode,
          planFingerprintSha256: item.planFingerprintSha256,
        })),
      },
    );
  }

  compatible.sort((left, right) => right.mtimeMs - left.mtimeMs || left.sourceFile.localeCompare(right.sourceFile));
  return freezeSelection(
    compatible[0],
    compatible.length === 1 ? 'single-compatible-source' : 'same-layout-newest-source',
  );
}

async function discoverSourceCandidates() {
  const result = [];
  for (const directory of [join(homedir(), 'Desktop'), join(homedir(), 'Downloads')]) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && SOURCE_NAME_PATTERN.test(entry.name)) result.push(join(directory, entry.name));
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return result;
}

async function readVerifiedCheckpoint(filePath) {
  const bytes = await readFile(filePath);
  const actualSha256 = fingerprint(bytes);
  if (actualSha256 !== CHECKPOINT_SHA256) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_SHA_MISMATCH', 'Original controlled-Apply checkpoint changed', {
      expectedSha256: CHECKPOINT_SHA256,
      actualSha256,
    });
  }
  const checkpoint = JSON.parse(bytes.toString('utf8'));
  if (checkpoint?.sourceAuthoritySha256 !== BASELINE_SOURCE_SHA256) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_BASELINE_MISMATCH', 'Checkpoint no longer belongs to the approved Source baseline');
  }
  return checkpoint;
}

function assertStructuralAuthority(inspection) {
  const assessment = assessLarkBaseViewUiRefreshSourceAuthority(inspection);
  if (assessment.ok) return;
  throw codedError(
    'CUSTOMER_BASE_VIEW_UI_SOURCE_STRUCTURE_MISMATCH',
    'View UI runner Source export is not refresh-compatible with the approved controlled-Apply structure',
    { mismatches: assessment.mismatches },
  );
}

function assertCloneScope(plan, expectedTableNames) {
  const actualTableNames = plan?.tables?.map((table) => optionalText(table?.tableName)) ?? [];
  if (!sameUniqueNameSet(actualTableNames, expectedTableNames)) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SOURCE_SCOPE_MISMATCH',
      'View UI Source clone-scope Table names differ from the retained checkpoint',
      { expectedCount: expectedTableNames.length, actualCount: actualTableNames.length },
    );
  }
}

function requireExpectedTableNames(value) {
  if (!Array.isArray(value) || value.length !== 32 || value.some((item) => !optionalText(item))) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_SCOPE_INVALID', 'Checkpoint must retain exactly 32 clone-scope Table names');
  }
  if (new Set(value).size !== value.length) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_CHECKPOINT_SCOPE_INVALID', 'Checkpoint clone-scope Table names must be unique');
  }
  return value.map((item) => item.trim());
}

function assertPlan(plan, sourceSha256) {
  const assessment = assessLarkBaseViewUiPlanAuthority(plan, { sourceSha256 });
  if (assessment.ok) return assessment;
  throw codedError(
    'CUSTOMER_BASE_VIEW_UI_PLAN_AUTHORITY_MISMATCH',
    'Generated View UI plan is outside the retained or exact evidence-backed refresh layout authority',
    {
      sourceSha256,
      mismatches: assessment.mismatches,
      sortInventoryFingerprintSha256: assessment.sortInventoryFingerprintSha256,
    },
  );
}

function freezeSelection(item, selectionMode) {
  return Object.freeze({
    sourceFile: item.sourceFile,
    inspection: item.inspection,
    plan: item.plan,
    planAuthorityMode: item.planAuthorityMode,
    selectionMode,
  });
}

function sameUniqueNameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftValues = left.map(optionalText);
  const rightValues = right.map(optionalText);
  if (leftValues.some((item) => item === null) || rightValues.some((item) => item === null)) return false;
  const leftSet = new Set(leftValues);
  const rightSet = new Set(rightValues);
  if (leftSet.size !== leftValues.length || rightSet.size !== rightValues.length) return false;
  for (const value of leftSet) if (!rightSet.has(value)) return false;
  return true;
}

function renderHtml({ sourceSha256, sourceFileName, sourceSelectionMode, sourcePlanAuthorityMode, plan }) {
  const summary = JSON.stringify({
    sourceFileName,
    sourceSha256,
    sourceSelectionMode,
    sourcePlanAuthorityMode,
    tables: plan.summary.tableCount,
    views: plan.summary.viewCount,
    sdk: {
      sortViews: plan.summary.sortViews,
      groupViews: plan.summary.groupViews,
      columnWidthAssignments: plan.summary.columnWidthAssignments,
      rowHeightViews: plan.summary.rowHeightViews,
    },
    manualAfterSdk: {
      fieldOrderViews: plan.summary.fieldOrderAuditViews,
      frozenColumnViews: plan.summary.frozenColumnManualViews,
    },
  }, null, 2);
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Customer Base View UI Parity</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; color: #1f2329; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { line-height: 1.5; }
    .card { border: 1px solid #dee0e3; border-radius: 10px; padding: 16px; margin: 12px 0; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; margin-right: 8px; cursor: pointer; font-weight: 600; }
    #apply { background: #1456f0; color: white; }
    #inspect { background: #f2f3f5; color: #1f2329; }
    button:disabled { opacity: .5; cursor: default; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f7f8fa; padding: 12px; border-radius: 8px; max-height: 420px; overflow: auto; }
    .warn { color: #8f4e00; }
  </style>
</head>
<body>
  <h1>Social MKT Data Hub — View UI parity</h1>
  <p id="status">พร้อมตรวจ Target Base ปัจจุบัน</p>
  <div class="card">
    <strong>สิ่งที่กดครั้งเดียวแล้ว SDK จะจัดให้</strong>
    <p>Sort / Group / Column width / Row height โดย preflight Target ก่อนทุก mutation และไม่แตะ Record, Field schema, Formula, Filter, Role หรือ Table</p>
    <p class="warn">Hidden fields เป็น verify-only เพราะ automatic OpenAPI phase ผ่านแล้ว ส่วน Field order และ Frozen columns ยังไม่มี documented setter จึงไม่ถูกแก้จาก runner นี้</p>
    <button id="apply">จัด View UI ที่ SDK รองรับ</button>
    <button id="inspect">ตรวจอย่างเดียว</button>
  </div>
  <details>
    <summary>แผนจาก Source</summary>
    <pre>${escapeHtml(summary)}</pre>
  </details>
  <pre id="output"></pre>
  <script>fetch('/client-event?stage=html-executed', { cache: 'no-store' }).catch(() => {});</script>
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}

function setCrossOriginHeaders(request, response) {
  const origin = optionalText(request.headers.origin);
  if (origin && isTrustedLarkOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isTrustedLarkOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'larksuite.com'
      || host.endsWith('.larksuite.com')
      || host === 'feishu.cn'
      || host.endsWith('.feishu.cn');
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveHost(value) {
  const host = optionalText(value) ?? DEFAULT_HOST;
  if (/^[A-Za-z0-9.-]+$/u.test(host) || /^\[[0-9A-Fa-f:]+\]$/u.test(host)) return host;
  throw new TypeError('CUSTOMER_BASE_VIEW_UI_HOST/PUBLIC_HOST must be a hostname or IP address');
}

function formatUrlHost(host) {
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;
  return host;
}

function resolvePort(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError('CUSTOMER_BASE_VIEW_UI_PORT must be 1024..65535');
  return port;
}

function send(response, status, contentType, body, method = 'GET') {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  if (method === 'HEAD') {
    response.end();
    return;
  }
  response.end(body);
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
