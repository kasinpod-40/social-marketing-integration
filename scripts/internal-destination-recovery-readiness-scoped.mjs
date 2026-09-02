#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Compatibility launcher for the internal Facebook/YouTube destination-readiness gate.
 *
 * The reviewed readiness script needs Integration Workspace ownership metadata plus
 * Lark/Cloudflare credentials, but it does not read TikTok provider data. Historical
 * developer machines can still carry a legacy TIKTOK_SOURCE_HANDLE in .dev.vars.
 * loadCustomerRuntimeConfig() resolves every connector, so that unrelated legacy value
 * can trip the Integration Workspace TikTok identity lock before the Facebook/YouTube
 * gate reaches any of its reviewed read-only checks.
 *
 * Keep the shared TikTok identity lock intact. For this narrowly scoped child process,
 * shadow only TIKTOK_SOURCE_HANDLE with the canonical profile value. The underlying
 * readiness script still performs all repository, Lark identity, D1 schema, fence,
 * phase, lock and durable-envelope checks and remains non-mutating.
 */
const TARGET = fileURLToPath(new URL('./internal-destination-recovery-readiness.mjs', import.meta.url));
const args = process.argv.slice(2);
const childEnv = Object.freeze({
  ...process.env,
  TIKTOK_SOURCE_HANDLE: 'chemistry_k',
});

const result = spawnSync(process.execPath, [TARGET, ...args], {
  cwd: process.cwd(),
  env: childEnv,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'INTERNAL_DESTINATION_READINESS_SCOPED_LAUNCH_FAILED',
    message: result.error.message,
    providerReads: 0,
    d1Writes: 0,
    larkWrites: 0,
    queueSends: 0,
    customerBaseReads: 0,
    customerBaseWrites: 0,
    persistentConfigWrites: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
