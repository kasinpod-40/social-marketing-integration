import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  META_K2_POST_ACTIVATION_FAILURE_FILES,
} from '../../scripts/lib/meta-k2-partial-staging-reviewed-launcher.js';
import {
  classifyMetaK2RetryRootEntries,
  retainMetaK2WranglerTransientDirectory,
} from '../../scripts/lib/meta-k2-preview-retry-root.js';

test('accepts only the exact reviewed evidence files plus one real .wrangler directory', () => {
  const result = classifyMetaK2RetryRootEntries([
    ...META_K2_POST_ACTIVATION_FAILURE_FILES.map((name) => ({
      name,
      type: 'file',
    })),
    { name: '.wrangler', type: 'directory' },
  ]);

  assert.equal(result.accepted, true);
  assert.equal(
    result.retryFootprint,
    'postactivation_no_business_after_verified_restore',
  );
  assert.equal(result.fileNames.length, META_K2_POST_ACTIVATION_FAILURE_FILES.length);
  assert.deepEqual(result.transientToolingDirectories, ['.wrangler']);
  assert.equal(result.transientToolingDirectoryCount, 1);
});

test('rejects another directory, a symlink, or file-footprint drift', () => {
  const exactFiles = META_K2_POST_ACTIVATION_FAILURE_FILES.map((name) => ({
    name,
    type: 'file',
  }));

  for (const extra of [
    { name: 'unexpected', type: 'directory' },
    { name: '.wrangler', type: 'symlink' },
    { name: 'unexpected.json', type: 'file' },
  ]) {
    assert.throws(
      () => classifyMetaK2RetryRootEntries([...exactFiles, extra]),
      (error) => error.code === 'META_K2_PREVIEW_RETRY_ROOT_INVALID',
    );
  }
});

test('moves the Wrangler directory to a retained sibling without deleting its contents', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'meta-k2-preview-retry-'));
  const recoveryRoot = join(parent, 'exact-partial-staging-recovery-v1');
  await mkdir(recoveryRoot, { recursive: true });
  for (const name of META_K2_POST_ACTIVATION_FAILURE_FILES) {
    await writeFile(join(recoveryRoot, name), `evidence:${name}\n`);
  }
  const wranglerRoot = join(recoveryRoot, '.wrangler');
  await mkdir(join(wranglerRoot, 'tmp'), { recursive: true });
  await writeFile(join(wranglerRoot, 'tmp', 'marker.txt'), 'preserve me\n');

  try {
    const result = await retainMetaK2WranglerTransientDirectory({
      recoveryRoot,
      now: () => 1785687000000,
    });

    assert.equal(result.retained, true);
    assert.equal(
      result.retainedPath,
      `${recoveryRoot}-wrangler-transient-1785687000000`,
    );
    assert.equal(
      await readFile(join(result.retainedPath, 'tmp', 'marker.txt'), 'utf8'),
      'preserve me\n',
    );
    assert.deepEqual(
      (await readdir(recoveryRoot)).sort(),
      [...META_K2_POST_ACTIVATION_FAILURE_FILES].sort(),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('is a no-op when the exact retry root has no Wrangler transient directory', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'meta-k2-preview-retry-noop-'));
  const recoveryRoot = join(parent, 'exact-partial-staging-recovery-v1');
  await mkdir(recoveryRoot, { recursive: true });
  for (const name of META_K2_POST_ACTIVATION_FAILURE_FILES) {
    await writeFile(join(recoveryRoot, name), `evidence:${name}\n`);
  }

  try {
    const result = await retainMetaK2WranglerTransientDirectory({ recoveryRoot });
    assert.equal(result.retained, false);
    assert.equal(result.retainedPath, null);
    assert.deepEqual(
      (await readdir(recoveryRoot)).sort(),
      [...META_K2_POST_ACTIVATION_FAILURE_FILES].sort(),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
