#!/usr/bin/env node

import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import {
  buildLarkBaseViewManualParityManifest,
  verifyLarkBaseViewManualParityManifests,
} from './lib/lark-base-view-manual-parity-manifest.js';

const SOURCE_EXPORT_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';
const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub.base';
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';
const EXPECTED_SOURCE = Object.freeze({ tables: 33, fields: 723, views: 111, relationFields: 12, formulaFields: 4, dashboards: 6, workflows: 2 });
const EXPECTED_CLONE = Object.freeze({ tables: 32, fields: 705, views: 110 });

const args = parseArgs(process.argv.slice(2));

try {
  const sourceFile = resolveFile(args.source ?? join(homedir(), 'Desktop', SOURCE_EXPORT_FILENAME), '--source');
  const targetFile = resolveFile(args.target, '--target');
  const sourceInspection = await inspectLarkBaseExport(sourceFile);
  const targetInspection = await inspectLarkBaseExport(targetFile);
  assertCurrentSource(sourceInspection);

  const sourceClient = await createLarkBaseExportSourceClient(sourceFile, {
    excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
  });
  const sourceTables = await sourceClient.listTables();
  const cloneTableNames = sourceTables.map((table) => table.name);
  assertUniqueNames(cloneTableNames, 'Source clone table');
  const cloneNameSet = new Set(cloneTableNames);

  const targetRawClient = await createLarkBaseExportSourceClient(targetFile);
  const targetClient = await projectClientByTableNames(targetRawClient, cloneNameSet);

  const sourceScope = await countScope(sourceClient);
  const targetScope = await countScope(targetClient);
  assertExpectedScope(sourceScope, EXPECTED_CLONE, 'Source clone');

  const sourceManifest = await buildLarkBaseViewManualParityManifest({ sourceClient });
  const targetManifest = await buildLarkBaseViewManualParityManifest({ sourceClient: targetClient });
  const acceptance = verifyLarkBaseViewManualParityManifests({
    sourceManifest,
    targetManifest,
    includeColumnWidths: false,
  });

  const scopeMismatch = [];
  for (const [dimension, expected] of Object.entries(EXPECTED_CLONE)) {
    if (targetScope[dimension] !== expected) scopeMismatch.push({ dimension, expected, actual: targetScope[dimension] });
  }

  const ok = acceptance.ok && scopeMismatch.length === 0;
  process.stdout.write(`${JSON.stringify({
    ok,
    contractVersion: 'customer_base_view_export_parity_v1',
    action: 'verify-view-parity-from-base-exports',
    mode: 'local-read-only',
    sourceAuthority: {
      fileName: basename(sourceFile),
      sha256: sourceInspection.file.sha256,
      counts: sourceInspection.counts,
    },
    targetExport: {
      fileName: basename(targetFile),
      sha256: targetInspection.file.sha256,
      counts: targetInspection.counts,
    },
    cloneScope: {
      expected: EXPECTED_CLONE,
      source: sourceScope,
      target: targetScope,
      mismatches: scopeMismatch,
    },
    acceptance,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_view_export_parity_v1',
    action: 'verify-view-parity-from-base-exports',
    mode: 'local-read-only',
    code: error?.code ?? 'CUSTOMER_BASE_VIEW_EXPORT_PARITY_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 2;
}

async function projectClientByTableNames(client, allowedNames) {
  const allTables = await client.listTables();
  const tables = allTables.filter((table) => allowedNames.has(table.name));
  const tableIds = new Set(tables.map((table) => table.tableId));
  const names = new Set(tables.map((table) => table.name));
  if (names.size !== allowedNames.size) {
    const missing = [...allowedNames].filter((name) => !names.has(name)).sort();
    throw codedError('CUSTOMER_BASE_TARGET_CLONE_TABLE_MISSING', 'Target export is missing one or more clone Tables', { missing });
  }
  return Object.freeze({
    async listTables() { return structuredClone(tables); },
    async listFields({ tableId }) {
      requireProjectedTable(tableIds, tableId);
      return client.listFields({ tableId });
    },
    async listViews({ tableId }) {
      requireProjectedTable(tableIds, tableId);
      return client.listViews({ tableId });
    },
  });
}

async function countScope(client) {
  const tables = await client.listTables();
  let fields = 0;
  let views = 0;
  for (const table of tables) {
    fields += (await client.listFields({ tableId: table.tableId })).length;
    views += (await client.listViews({ tableId: table.tableId })).length;
  }
  return Object.freeze({ tables: tables.length, fields, views });
}

function assertCurrentSource(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== SOURCE_EXPORT_SHA256) {
    mismatches.push({ dimension: 'sha256', expected: SOURCE_EXPORT_SHA256, actual: inspection?.file?.sha256 ?? null });
  }
  for (const [dimension, expected] of Object.entries(EXPECTED_SOURCE)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  if (mismatches.length > 0) {
    throw codedError('CUSTOMER_BASE_SOURCE_EXPORT_AUTHORITY_MISMATCH', 'Source export is not the approved current authority', { mismatches });
  }
}

function assertExpectedScope(actual, expected, label) {
  const mismatches = [];
  for (const [dimension, expectedValue] of Object.entries(expected)) {
    if (actual[dimension] !== expectedValue) mismatches.push({ dimension, expected: expectedValue, actual: actual[dimension] });
  }
  if (mismatches.length > 0) throw codedError('CUSTOMER_BASE_SOURCE_CLONE_SCOPE_MISMATCH', `${label} scope differs from the approved clone scope`, { mismatches });
}

function assertUniqueNames(names, label) {
  if (new Set(names).size !== names.length) throw codedError('CUSTOMER_BASE_DUPLICATE_TABLE_NAME', `${label} names must be unique`);
}

function requireProjectedTable(tableIds, tableId) {
  if (!tableIds.has(tableId)) throw codedError('CUSTOMER_BASE_TARGET_TABLE_OUT_OF_SCOPE', `Table is outside projected clone scope: ${tableId}`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new TypeError(`${token} requires a value`);
    result[token.slice(2)] = next;
    index += 1;
  }
  return result;
}

function resolveFile(value, flag) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${flag} is required`);
  return value;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
