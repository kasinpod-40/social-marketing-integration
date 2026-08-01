import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  materializeChatwootControllerEvidenceDirectory,
} from '../../scripts/lib/chatwoot-controller-evidence-isolation.js';

const WRAPPER = new URL(
  '../../scripts/chatwoot-controller-evidence-arbitration-terminal.mjs',
  import.meta.url,
);
const REQUIRED = [
  'session.json',
  'read-only-preflight.json',
  'active-deployment.json',
  'initial-send.attempt.json',
];

test('selected Chatwoot evidence is visible to Dirent as a real directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-evidence-isolation-'));
  try {
    const source = join(root, 'source', 'retained-head');
    const destinationRoot = join(root, 'clone', 'outputs', 'chatwoot-final-30d-daily-uat');
    await mkdir(source, { recursive: true, mode: 0o700 });
    await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
    for (const fileName of REQUIRED) {
      await writeFile(join(source, fileName), `${JSON.stringify({ fileName })}\n`, {
        mode: 0o600,
      });
    }
    await writeFile(join(source, 'extra-evidence.json'), '{}\n', { mode: 0o600 });

    const result = await materializeChatwootControllerEvidenceDirectory({
      sourceDirectory: source,
      destinationRoot,
      directoryName: 'retained-head',
    });

    const entry = (await readdir(destinationRoot, { withFileTypes: true }))
      .find((candidate) => candidate.name === 'retained-head');
    assert.equal(entry?.isDirectory(), true);
    assert.equal(entry?.isSymbolicLink(), false);
    assert.equal((await lstat(result.directory)).isSymbolicLink(), false);
    assert.equal((await stat(result.directory)).isDirectory(), true);
    assert.equal(result.realDirectory, true);
    assert.equal(result.retainedEvidenceMutation, false);

    for (const fileName of REQUIRED) {
      const path = join(result.directory, fileName);
      assert.equal((await lstat(path)).isSymbolicLink(), false);
      assert.equal((await stat(path)).isFile(), true);
    }
    assert.equal(await readFile(join(source, 'extra-evidence.json'), 'utf8'), '{}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('selected evidence isolation rejects a symlink source and existing destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-evidence-isolation-invalid-'));
  try {
    const source = join(root, 'source');
    const linked = join(root, 'linked');
    const destinationRoot = join(root, 'destination');
    await mkdir(source, { recursive: true });
    await mkdir(destinationRoot, { recursive: true });
    for (const fileName of REQUIRED) {
      await writeFile(join(source, fileName), '{}\n');
    }
    await symlink(source, linked, 'dir');

    await assert.rejects(
      materializeChatwootControllerEvidenceDirectory({
        sourceDirectory: linked,
        destinationRoot,
        directoryName: 'candidate',
      }),
      (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_DIRECTORY_INVALID',
    );

    await mkdir(join(destinationRoot, 'candidate'));
    await assert.rejects(
      materializeChatwootControllerEvidenceDirectory({
        sourceDirectory: source,
        destinationRoot,
        directoryName: 'candidate',
      }),
      (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_ISOLATION_DESTINATION_PRESENT',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('arbitration wrapper materializes selected evidence instead of symlinking it', async () => {
  const source = await readFile(WRAPPER, 'utf8');
  assert.match(source, /materializeChatwootControllerEvidenceDirectory/u);
  assert.match(source, /temporary_real_directory_copy/u);
  assert.match(source, /selectedEvidenceRealDirectory/u);
  assert.doesNotMatch(
    source,
    /await symlink\(\s*selection\.directory,\s*join\(cloneFinalRoot, selection\.directoryName\)/u,
  );
  assert.match(source, /chatwoot-initial-terminal-failure-recovery-launcher\.mjs/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /'wrangler', 'deploy'/u);
});
