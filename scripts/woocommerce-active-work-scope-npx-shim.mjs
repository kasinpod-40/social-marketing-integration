#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { rewriteWooCommerceD1CommandArgs } from './lib/woocommerce-active-work-scope.js';

const realNpx = String(process.env.MKT_WOOCOMMERCE_REAL_NPX_PATH ?? '').trim();
if (!realNpx) {
  process.stderr.write('MKT_WOOCOMMERCE_REAL_NPX_PATH is required\n');
  process.exit(1);
}

let rewritten;
try {
  rewritten = rewriteWooCommerceD1CommandArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_ACTIVE_WORK_SCOPE_INVALID',
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exit(1);
}

if (rewritten.changed) {
  process.stderr.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-active-work-scope-applied',
    scope: 'woocommerce_only',
    businessMutationCount: 0,
  })}\n`);
}

const result = spawnSync(realNpx, rewritten.args, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
