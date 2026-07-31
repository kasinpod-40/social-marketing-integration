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
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  META_HISTORY_CUSTOMER_RUNTIME_ENV,
  materializeMetaHistoryCustomerRuntimeConfig,
} from '../../scripts/lib/meta-history-runtime-authority.js';
import {
  buildMetaHistorySafeEnvironment,
  loadOrCreateIsoPlan,
  validateIsoPlan,
} from '../../scripts/meta-history-2026-terminal.mjs';

const HEAD = 'b'.repeat(40);
const NOW = Date.UTC(2026, 6, 31, 8, 30, 0, 123);

test('Meta history Terminal materializes every required safe flag and customer identity before child execution', () => {
  const input = {
    MKT_ENV: 'development',
    MKT_CONNECTOR_FACEBOOK_ENABLED: 'true',
    MKT_FUTURE_FEATURE_ENABLED: 'true',
    META_GRAPH_API_VERSION: 'v1.0',
    META_FACEBOOK_PAGE_ID: 'developer-page',
    META_INSTAGRAM_ACCOUNT_ID: 'developer-instagram',
    META_AD_ACCOUNT_ID: 'legacy-account',
    META_AD_ACCOUNT_MAPPINGS: 'developer=1',
  };
  const safe = buildMetaHistorySafeEnvironment(input);

  assert.notEqual(safe, input);
  assert.equal(input.MKT_CONNECTOR_FACEBOOK_ENABLED, 'true');
  assert.equal(input.MKT_FUTURE_FEATURE_ENABLED, 'true');
  assert.equal(input.META_FACEBOOK_PAGE_ID, 'developer-page');
  assert.equal(safe.MKT_ENV, 'development');
  assert.equal(safe.MKT_FUTURE_FEATURE_ENABLED, 'false');
  assert.equal(safe.MKT_CONNECTOR_META_ADS_ENABLED, 'false');
  for (const flag of META_D1_ONLY_REQUIRED_FALSE_FLAGS) {
    assert.equal(safe[flag], 'false', flag);
  }
  for (const [key, value] of Object.entries(META_HISTORY_CUSTOMER_RUNTIME_ENV)) {
    assert.equal(safe[key], value, key);
  }
  assert.equal(safe.META_AD_ACCOUNT_ID, '');
  assert.equal(Object.isFrozen(safe), true);
});

test('Meta history runtime config replaces stale mappings and inserts missing pinned values idempotently', () => {
  const input = `{
  main: "apps/sync-worker/src/index.js",
  vars: {
    META_FACEBOOK_PAGE_ID: "developer-page",
    "META_INSTAGRAM_ACCOUNT_ID": "developer-instagram",
    META_AD_ACCOUNT_ID: "legacy-account",
    META_AD_ACCOUNT_MAPPINGS: "developer=1"
  }
}`;
  const first = materializeMetaHistoryCustomerRuntimeConfig(input);
  const second = materializeMetaHistoryCustomerRuntimeConfig(first);

  assert.equal(second, first);
  assert.doesNotMatch(first, /developer-page|developer-instagram|legacy-account|developer=1/u);
  for (const [key, value] of Object.entries(META_HISTORY_CUSTOMER_RUNTIME_ENV)) {
    assert.match(first, new RegExp(`${key}[^\n]+${String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  }
  assert.match(first, /META_GRAPH_API_VERSION[^\n]+v25\.0/u);
  assert.match(first, /META_AD_ACCOUNT_ID[^\n]+""/u);
});

test('Meta history Terminal persists unique ISO requested-at generations before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-history-terminal-'));
  try {
    const path = join(root, 'runtime-plan.json');
    const plan = await loadOrCreateIsoPlan(path, HEAD, { now: () => NOW });
    assert.equal(plan.createdAt, '2026-07-31T08:30:00.123Z');
    assert.equal(plan.operations.length, 6);
    assert.deepEqual(plan.operations.map((item) => item.target), [
      'facebook',
      'instagram',
      'chemistry_k2',
      'chemistry_k3',
      'chemistry_k2',
      'chemistry_k3',
    ]);
    assert.deepEqual(plan.operations.map((item) => item.originalRequestedAt), [
      '2026-07-31T08:30:00.123Z',
      '2026-07-31T08:30:00.124Z',
      '2026-07-31T08:30:00.125Z',
      '2026-07-31T08:30:00.126Z',
      '2026-07-31T08:30:00.127Z',
      '2026-07-31T08:30:00.128Z',
    ]);
    assert.equal(new Set(plan.operations.map((item) => item.originalRequestedAt)).size, 6);
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
