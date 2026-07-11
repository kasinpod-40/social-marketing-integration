import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLeaseLockManager } from '../../scripts/lib/file-lease-lock-manager.js';

test('local file lease prevents concurrent owners and releases only for the owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-lock-'));
  try {
    const manager = new FileLeaseLockManager({ directory, now: () => 1_000 });
    const first = await manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-1', leaseMs: 5_000 });
    const second = await manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-2', leaseMs: 5_000 });

    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    await assert.rejects(
      () => manager.release({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-2' }),
      (error) => error.code === 'LOCAL_SYNC_LOCK_OWNER_MISMATCH',
    );
    assert.equal(await manager.release({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-1' }), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('local file lease replaces an expired lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-lock-'));
  let now = 1_000;
  try {
    const manager = new FileLeaseLockManager({ directory, now: () => now });
    await manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-1', leaseMs: 100 });
    now = 1_101;
    const replacement = await manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-2', leaseMs: 100 });
    assert.equal(replacement.acquired, true);
    assert.equal(replacement.ownerId, 'run-2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
