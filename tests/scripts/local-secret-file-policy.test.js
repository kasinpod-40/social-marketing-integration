import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectLocalSecretFile,
  secureLocalSecretFile,
} from '../../scripts/lib/local-secret-file-policy.js';

async function makeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mkt-local-secret-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  const shared = join(root, 'shared');
  await mkdir(worktree);
  await mkdir(shared);
  return { root, worktree, shared };
}

test('secureLocalSecretFile secures a worktree symlink target without replacing the link', {
  skip: process.platform === 'win32',
}, async (t) => {
  const { worktree, shared } = await makeFixture(t);
  const target = join(shared, '.dev.vars');
  const link = join(worktree, '.dev.vars');
  await writeFile(target, 'SECRET=value\n', { mode: 0o644 });
  await symlink(target, link);

  const result = await secureLocalSecretFile(link, { expectedBasename: '.dev.vars' });
  const linkStat = await lstat(link);
  const targetStat = await stat(target);

  assert.equal(result.exists, true);
  assert.equal(result.symbolicLink, true);
  assert.equal(result.ownerOnly, true);
  assert.equal(result.mode, '0600');
  assert.equal(linkStat.isSymbolicLink(), true);
  assert.equal(targetStat.mode & 0o777, 0o600);
});

test('inspectLocalSecretFile follows a valid symlink and evaluates target permissions', {
  skip: process.platform === 'win32',
}, async (t) => {
  const { worktree, shared } = await makeFixture(t);
  const target = join(shared, '.dev.vars');
  const link = join(worktree, '.dev.vars');
  await writeFile(target, 'SECRET=value\n', { mode: 0o600 });
  await symlink(target, link);

  const result = await inspectLocalSecretFile(link, { expectedBasename: '.dev.vars' });

  assert.equal(result.symbolicLink, true);
  assert.equal(result.ownerOnly, true);
  assert.equal(result.mode, '0600');
});

test('local secret policy rejects a symlink whose target filename is not .dev.vars', {
  skip: process.platform === 'win32',
}, async (t) => {
  const { worktree, shared } = await makeFixture(t);
  const target = join(shared, 'other-secret.env');
  const link = join(worktree, '.dev.vars');
  await writeFile(target, 'SECRET=value\n', { mode: 0o600 });
  await symlink(target, link);

  await assert.rejects(
    secureLocalSecretFile(link, { expectedBasename: '.dev.vars' }),
    (error) => error.code === 'LOCAL_SECRET_FILE_SYMLINK_TARGET_INVALID',
  );
});

test('local secret policy rejects a broken worktree symlink', {
  skip: process.platform === 'win32',
}, async (t) => {
  const { worktree, shared } = await makeFixture(t);
  const link = join(worktree, '.dev.vars');
  await symlink(join(shared, '.dev.vars'), link);

  await assert.rejects(
    secureLocalSecretFile(link, { expectedBasename: '.dev.vars' }),
    (error) => error.code === 'LOCAL_SECRET_FILE_SYMLINK_INVALID',
  );
});

test('missing local secret remains optional', async (t) => {
  const { worktree } = await makeFixture(t);
  const result = await inspectLocalSecretFile(join(worktree, '.dev.vars'), {
    expectedBasename: '.dev.vars',
  });
  assert.deepEqual(result, {
    exists: false,
    symbolicLink: false,
    ownerOnly: true,
    mode: null,
    resolvedPath: null,
    device: null,
    inode: null,
  });
});
