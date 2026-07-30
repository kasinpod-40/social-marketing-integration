import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeTemporaryDirectoryEnvironment } from '../../scripts/lib/canonical-temporary-directory.js';


test('canonical temp environment collapses symlink aliases before sealed clone creation', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'canonical-temp-test-'));
  const realRoot = join(sandbox, 'real');
  const aliasRoot = join(sandbox, 'alias');

  try {
    await mkdir(realRoot);
    await symlink(realRoot, aliasRoot, 'dir');

    const env = {};
    const result = canonicalizeTemporaryDirectoryEnvironment(env, {
      tmpDirectory: aliasRoot,
    });
    const expected = await realpath(realRoot);

    assert.equal(result.canonicalDirectory, expected);
    assert.equal(env.TMPDIR, expected);
    assert.equal(env.TMP, expected);
    assert.equal(env.TEMP, expected);

    const sealedRoot = await mkdtemp(join(env.TMPDIR, 'sealed-'));
    const configPath = join(sealedRoot, '.mkt-woocommerce-2026-completion-wrangler.jsonc');
    await writeFile(configPath, '{}\n');

    assert.equal((await realpath(configPath)).startsWith(`${await realpath(sealedRoot)}/`), true);
    assert.equal((await lstat(configPath)).isSymbolicLink(), false);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});


test('canonical launcher normalizes temp identity before importing the reviewed safe launcher', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-2026-completion-canonical-launcher.mjs', import.meta.url),
    'utf8',
  );

  const canonicalizeIndex = source.indexOf('canonicalizeTemporaryDirectoryEnvironment(process.env)');
  const delegateIndex = source.indexOf("await import('./woocommerce-2026-completion-safe-launcher.mjs')");

  assert.ok(canonicalizeIndex >= 0);
  assert.ok(delegateIndex > canonicalizeIndex);
  assert.doesNotMatch(source, /wrangler.*deploy|queues\/.+\/messages/u);
});


test('canonical temp helper fails closed for non-directory targets', () => {
  assert.throws(
    () => canonicalizeTemporaryDirectoryEnvironment({}, {
      tmpDirectory: '/not-used',
      realpath: () => '/still-not-used',
      stat: () => ({ isDirectory: () => false }),
    }),
    (error) => error?.code === 'CANONICAL_TEMP_DIRECTORY_INVALID',
  );
});
