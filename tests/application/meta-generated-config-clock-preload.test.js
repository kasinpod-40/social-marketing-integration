import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const preloadUrl = pathToFileURL(resolve(
  'scripts/meta-d1-only-generated-config-clock-preload.mjs',
)).href;

function runPreload(environment = {}) {
  const result = spawnSync(process.execPath, [
    '--import',
    preloadUrl,
    '--input-type=module',
    '--eval',
    `process.stdout.write(JSON.stringify({
      d1: process.env.MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT ?? null,
      lark: process.env.MKT_META_LARK_ORIGINAL_REQUESTED_AT ?? null,
      now: [Date.now(), Date.now()],
    }));`,
  ], {
    cwd: resolve('.'),
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Meta launcher preload canonicalizes epoch-string requested-at values for D1 and Lark', () => {
  const epoch = Date.UTC(2026, 7, 2, 8, 21, 0, 123);
  const observed = runPreload({
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(epoch),
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: String(epoch + 1),
  });

  assert.equal(observed.d1, new Date(epoch).toISOString());
  assert.equal(observed.lark, new Date(epoch + 1).toISOString());
  assert.ok(observed.now[1] > observed.now[0]);
});

test('Meta launcher preload preserves ISO and invalid values for operator validation', () => {
  const iso = '2026-08-02T08:21:00.123Z';
  const observed = runPreload({
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: iso,
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: 'not-a-timestamp',
  });

  assert.equal(observed.d1, iso);
  assert.equal(observed.lark, 'not-a-timestamp');
});
