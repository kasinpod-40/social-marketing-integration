import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = 'scripts/meta-paid-lark-drain-closeout-supervised.mjs';

test('supervisor emits bounded heartbeats and read-only silence timeout', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /META_PAID_LARK_DRAIN_SUPERVISOR_HEARTBEAT_MS\s*=\s*30_000/u);
  assert.match(source, /META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS\s*=\s*120_000/u);
  assert.match(source, /read-only-drain-supervisor-heartbeat/u);
  assert.match(source, /closeout-supervisor-heartbeat/u);
});

test('supervisor only terminates a silent child before closeout launch', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /if \(!closeoutLaunched[\s\S]*quietMs >= META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS\)/u);
  assert.match(source, /if \(!settled && !closeoutLaunched\) terminateProcessGroup/u);
  assert.match(source, /"action"\\s\*:\\s\*"launch_existing_closeout"/u);
  assert.match(source, /"stage"\\s\*:\\s\*"private-safe-config-materialized"/u);
});

test('supervisor delegates only to existing guarded drain and has no direct remote mutation command', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /meta-paid-lark-drain-closeout\.mjs/u);
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /\bd1\b[\s\S]{0,40}\bexecute\b/iu);
  assert.doesNotMatch(source, /\.send\s*\(/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
});

test('supervisor cannot claim direct mutation status after delegation', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /directRemoteMutationPerformed:\s*false/u);
  assert.doesNotMatch(source, /remoteMutationPerformed:\s*false/u);
});
