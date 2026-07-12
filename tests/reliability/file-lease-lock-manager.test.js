import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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

test('local file lease renewal extends only the current owner lease', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-lock-'));
  let now = 1_000;
  try {
    const manager = new FileLeaseLockManager({ directory, now: () => now });
    await manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-1', leaseMs: 1_000 });
    now = 1_500;
    const renewed = await manager.renew({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-1', leaseMs: 2_000 });
    const wrongOwner = await manager.renew({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-2', leaseMs: 2_000 });

    assert.equal(renewed.renewed, true);
    assert.equal(renewed.expiresAt, 3_500);
    assert.equal(wrongOwner.renewed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('expired-lock takeover is serialized so only one new owner can acquire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-lock-'));
  let now = 1_000;
  try {
    const manager = new FileLeaseLockManager({ directory, now: () => now });
    await manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-1', leaseMs: 100 });
    now = 1_101;

    const attempts = await Promise.all([
      manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-2', leaseMs: 1_000 }),
      manager.acquire({ lockKey: 'dev:tiktok:ft:native', ownerId: 'run-3', leaseMs: 1_000 }),
    ]);
    const winners = attempts.filter((result) => result.acquired);
    const blocked = attempts.filter((result) => !result.acquired);

    assert.equal(winners.length, 1);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].expiresAt, winners[0].expiresAt);
    assert.equal(await manager.release({
      lockKey: 'dev:tiktok:ft:native',
      ownerId: winners[0].ownerId,
    }), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('orphan mutation guard fails closed instead of overwriting another owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-lock-'));
  const lockKey = 'dev:tiktok:ft:native';
  const digest = createHash('sha256').update(lockKey).digest('hex');
  try {
    await writeFile(join(directory, `${digest}.lock.guard`), '{}', { mode: 0o600 });
    const manager = new FileLeaseLockManager({
      directory,
      guardMaxAttempts: 2,
      guardRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    await assert.rejects(
      () => manager.acquire({ lockKey, ownerId: 'run-1', leaseMs: 1_000 }),
      (error) => error.code === 'LOCAL_SYNC_LOCK_GUARD_BUSY'
        && error.details.attempts === 2,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
