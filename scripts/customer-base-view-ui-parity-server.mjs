import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { buildLarkBaseViewManualParityManifest } from './lib/lark-base-view-manual-parity-manifest.js';
import { buildLarkBaseViewJsSdkParityPlan } from './lib/lark-base-view-js-sdk-parity.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const CURRENT_SOURCE_SHA256 = '1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7';
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';
const STRUCTURAL_COUNTS = Object.freeze({
  tables: 33,
  fields: 723,
  views: 111,
  relationFields: 12,
  formulaFields: 4,
  dashboards: 6,
  workflows: 2,
});

try {
  const sourceFile = process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE
    ?? join(homedir(), 'Desktop', 'Social MKT Data Hub.base');
  const port = resolvePort(process.env.CUSTOMER_BASE_VIEW_UI_PORT);
  const inspection = await inspectLarkBaseExport(sourceFile);
  assertCurrentAuthority(inspection);

  const sourceClient = await createLarkBaseExportSourceClient(sourceFile, {
    excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
  });
  const manifest = await buildLarkBaseViewManualParityManifest({ sourceClient });
  const plan = buildLarkBaseViewJsSdkParityPlan(manifest);
  assertPlan(plan);

  const browserScript = await readFile(
    fileURLToPath(new URL('./customer-base-view-ui-parity.browser.js', import.meta.url)),
    'utf8',
  );
  const html = renderHtml({ sourceSha256: inspection.file.sha256, plan });

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://${HOST}:${port}`).pathname;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (path === '/' || path === '/index.html') {
      send(response, 200, 'text/html; charset=utf-8', html);
      return;
    }
    if (path === '/app.js') {
      send(response, 200, 'text/javascript; charset=utf-8', browserScript);
      return;
    }
    if (path === '/plan.json') {
      send(response, 200, 'application/json; charset=utf-8', `${JSON.stringify(plan)}\n`);
      return;
    }
    if (path === '/health') {
      send(response, 200, 'application/json; charset=utf-8', `${JSON.stringify({
        ok: true,
        service: 'customer-base-view-ui-parity',
        mode: 'local-source-plan-plus-base-js-sdk-ui',
        sourceSha256: inspection.file.sha256,
        tables: plan.summary.tableCount,
        views: plan.summary.viewCount,
      })}\n`);
      return;
    }
    send(response, 404, 'text/plain; charset=utf-8', 'Not found\n');
  });

  server.listen(port, HOST, () => {
    console.log(JSON.stringify({
      ok: true,
      stage: 'customer-base-view-ui-parity-server',
      status: 'READY',
      url: `http://${HOST}:${port}`,
      sourceSha256: inspection.file.sha256,
      tables: plan.summary.tableCount,
      views: plan.summary.viewCount,
      baseJsSdkMutations: plan.ownership.baseJsSdkMutations,
      remainingManual: plan.ownership.remainingManual,
      sourceMutationCount: 0,
      remoteMutationCount: 0,
    }, null, 2));
  });
} catch (error) {
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

function assertCurrentAuthority(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== CURRENT_SOURCE_SHA256) {
    mismatches.push({
      dimension: 'sha256',
      expected: CURRENT_SOURCE_SHA256,
      actual: inspection?.file?.sha256 ?? null,
    });
  }
  for (const [dimension, expected] of Object.entries(STRUCTURAL_COUNTS)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  if (mismatches.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_VIEW_UI_SOURCE_AUTHORITY_MISMATCH',
      'View UI runner requires the exact current approved Source export',
      { mismatches },
    );
  }
}

function assertPlan(plan) {
  const mismatches = [];
  if (plan?.summary?.tableCount !== 32) mismatches.push({ dimension: 'cloneTables', expected: 32, actual: plan?.summary?.tableCount ?? null });
  if (plan?.summary?.viewCount !== 110) mismatches.push({ dimension: 'cloneViews', expected: 110, actual: plan?.summary?.viewCount ?? null });
  if (plan?.summary?.fieldOrderAuditViews !== 110) mismatches.push({ dimension: 'fieldOrderViews', expected: 110, actual: plan?.summary?.fieldOrderAuditViews ?? null });
  if (plan?.summary?.sortViews !== 41) mismatches.push({ dimension: 'sortViews', expected: 41, actual: plan?.summary?.sortViews ?? null });
  if (plan?.summary?.groupViews !== 4) mismatches.push({ dimension: 'groupViews', expected: 4, actual: plan?.summary?.groupViews ?? null });
  if (plan?.summary?.columnWidthViews !== 70) mismatches.push({ dimension: 'columnWidthViews', expected: 70, actual: plan?.summary?.columnWidthViews ?? null });
  if (plan?.summary?.columnWidthAssignments !== 898) mismatches.push({ dimension: 'columnWidthAssignments', expected: 898, actual: plan?.summary?.columnWidthAssignments ?? null });
  if (plan?.summary?.rowHeightViews !== 110) mismatches.push({ dimension: 'rowHeightViews', expected: 110, actual: plan?.summary?.rowHeightViews ?? null });
  if (plan?.summary?.frozenColumnManualViews !== 110) mismatches.push({ dimension: 'frozenColumnViews', expected: 110, actual: plan?.summary?.frozenColumnManualViews ?? null });
  if (mismatches.length > 0) {
    throw codedError('CUSTOMER_BASE_VIEW_UI_PLAN_COUNT_MISMATCH', 'Generated View UI plan differs from retained parity evidence', { mismatches });
  }
}

function renderHtml({ sourceSha256, plan }) {
  const summary = JSON.stringify({
    sourceSha256,
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
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function resolvePort(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError('CUSTOMER_BASE_VIEW_UI_PORT must be 1024..65535');
  return port;
}

function send(response, status, contentType, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.end(body);
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
