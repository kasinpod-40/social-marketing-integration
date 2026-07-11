import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUILD_VERSION } from '../../packages/config/src/build-info.js';

test('runtime build version matches package version', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(BUILD_VERSION, packageJson.version);
});
