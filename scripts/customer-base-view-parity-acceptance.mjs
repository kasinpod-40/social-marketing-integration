#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { verifyCustomerBaseViewParityAcceptance } from './lib/customer-base-view-parity-acceptance.js';

const args = parseArgs(process.argv.slice(2));

try {
  const sourcePath = requirePath(args['source-manifest'], '--source-manifest');
  const targetPath = requirePath(args['target-manifest'], '--target-manifest');
  const sourceManifest = readJson(sourcePath);
  const targetManifest = readJson(targetPath);
  const result = verifyCustomerBaseViewParityAcceptance({ sourceManifest, targetManifest });

  process.stdout.write(`${JSON.stringify({
    ...result,
    action: 'verify-customer-view-parity-acceptance',
    sourceManifestFile: path.basename(sourcePath),
    targetManifestFile: path.basename(targetPath),
  }, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_view_parity_acceptance_v1',
    action: 'verify-customer-view-parity-acceptance',
    mode: 'local-read-only-id-redacted',
    code: error?.code ?? 'CUSTOMER_BASE_VIEW_PARITY_ACCEPTANCE_FAILED',
    message: error?.message ?? String(error),
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 2;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new TypeError(`${token} requires a value`);
    result[key] = next;
    index += 1;
  }
  return result;
}

function requirePath(value, flag) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${flag} is required`);
  return path.resolve(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
