#!/usr/bin/env node

/**
 * Read-only closeout helper for customer Base view field-order parity.
 *
 * This script intentionally performs no remote writes. It compares two JSON
 * snapshots that contain per-view field order and exits non-zero when cloned
 * views differ. Width is intentionally excluded.
 *
 * Input JSON shape (array or {views:[...]}):
 * {
 *   tableName: string,
 *   viewName: string,
 *   fieldOrder: string[],
 *   protected?: boolean
 * }
 *
 * Usage:
 *   node scripts/customer-base-view-order-audit.mjs \
 *     --source /path/source-view-order.json \
 *     --target /path/target-view-order.json
 */

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[key] = value;
  }
  return out;
}

function load(filePath) {
  const absolute = path.resolve(String(filePath));
  const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const views = Array.isArray(parsed) ? parsed : parsed?.views;
  if (!Array.isArray(views)) {
    throw new Error(`Expected array or {views:[...]} in ${absolute}`);
  }
  return views;
}

function normalize(entry) {
  const tableName = entry.tableName ?? entry.table ?? entry.table_name;
  const viewName = entry.viewName ?? entry.view ?? entry.view_name;
  const fieldOrder = entry.fieldOrder ?? entry.field_order ?? entry.fields;
  if (!tableName || !viewName || !Array.isArray(fieldOrder)) {
    throw new Error(`Invalid view-order entry: ${JSON.stringify(entry)}`);
  }
  return {
    tableName: String(tableName),
    viewName: String(viewName),
    fieldOrder: fieldOrder.map(String),
    protected: Boolean(entry.protected),
  };
}

function keyOf(v) {
  return `${v.tableName}\u0000${v.viewName}`;
}

function equalOrder(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.target) {
  console.error('Usage: node scripts/customer-base-view-order-audit.mjs --source <source.json> --target <target.json>');
  process.exit(2);
}

try {
  const source = load(args.source).map(normalize).filter((v) => !v.protected);
  const target = load(args.target).map(normalize).filter((v) => !v.protected);
  const sourceMap = new Map(source.map((v) => [keyOf(v), v]));
  const targetMap = new Map(target.map((v) => [keyOf(v), v]));

  const missingTarget = [];
  const extraTarget = [];
  const mismatches = [];

  for (const [key, sourceView] of sourceMap) {
    const targetView = targetMap.get(key);
    if (!targetView) {
      missingTarget.push({ tableName: sourceView.tableName, viewName: sourceView.viewName });
      continue;
    }
    if (!equalOrder(sourceView.fieldOrder, targetView.fieldOrder)) {
      mismatches.push({
        tableName: sourceView.tableName,
        viewName: sourceView.viewName,
        expected: sourceView.fieldOrder,
        actual: targetView.fieldOrder,
      });
    }
  }

  for (const [key, targetView] of targetMap) {
    if (!sourceMap.has(key)) {
      extraTarget.push({ tableName: targetView.tableName, viewName: targetView.viewName });
    }
  }

  const ok = missingTarget.length === 0 && extraTarget.length === 0 && mismatches.length === 0;
  const output = {
    ok,
    contractVersion: 'customer_base_view_field_order_parity_v1',
    mode: 'read-only',
    widthInScope: false,
    sourceViewCount: sourceMap.size,
    targetViewCount: targetMap.size,
    fieldOrderMismatchCount: mismatches.length,
    missingTargetViewCount: missingTarget.length,
    extraTargetViewCount: extraTarget.length,
    missingTarget,
    extraTarget,
    mismatches,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_view_field_order_parity_v1',
    mode: 'read-only',
    code: 'VIEW_FIELD_ORDER_AUDIT_ERROR',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(2);
}
