import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadOrCreateIsoPlan,
  validateIsoPlan,
} from '../../scripts/meta-history-2026-terminal.mjs';

const HEAD = 'b'.repeat(40);
const NOW = Date.UTC(2026, 6, 31, 8, 30, 0, 123);

test('Meta history Terminal persists unique ISO requested-at generations before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-history-terminal-'));
  try {
    const path = join(root, 'runtime-plan.json');
    const plan = await loadOrCreateIsoPlan(path, HEAD, { now: () => NOW });
    assert.equal(plan.createdAt, '2026-07-31T08:30:00.123Z');
    assert.equal(plan.operations.length, 5);
    assert.deepEqual(plan.operations.map((item) => item.originalRequestedAt), [
      '2026-07-31T08:30:00.123Z',
      '2026-07-31T08:30:00.124Z',
      '2026-07-31T08:30:00.125Z',
      '2026-07-31T08:30:00.126Z',
      '2026-07-31T08:30:00.127Z',
    ]);
    assert.equal(new Set(plan.operations.map((item) => item.originalRequestedAt)).size, 5);
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(persisted, plan);
    assert.equal((await stat(path)).mode & 0o077, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Meta history Terminal reuses the exact persisted plan without changing generations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-history-terminal-'));
  try {
    const path = join(root, 'runtime-plan.json');
    const first = await loadOrCreateIsoPlan(path, HEAD, { now: () => NOW });
    const second = await loadOrCreateIsoPlan(path, HEAD, { now: () => NOW + 60_000 });
    assert.deepEqual(second, first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Meta history Terminal rejects epoch strings and operation drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-history-terminal-'));
  try {
    const path = join(root, 'runtime-plan.json');
    const plan = await loadOrCreateIsoPlan(path, HEAD, { now: () => NOW });
    const epoch = structuredClone(plan);
    epoch.operations[0].originalRequestedAt = String(NOW);
    assert.throws(
      () => validateIsoPlan(epoch, HEAD),
      (error) => error?.code === 'META_HISTORY_2026_TERMINAL_TIMESTAMP_INVALID',
    );
    const drift = structuredClone(plan);
    drift.operations[0].periodStart = '2026-06-01';
    assert.throws(
      () => validateIsoPlan(drift, HEAD),
      (error) => error?.code === 'META_HISTORY_2026_TERMINAL_OPERATION_DRIFT',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
