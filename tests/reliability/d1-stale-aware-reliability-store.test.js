import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1StaleAwareReliabilityStore } from '../../packages/reliability/src/d1-stale-aware-reliability-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0002_reliability.sql', import.meta.url);

test('stale-aware D1 lock returns the persisted owner expiry when acquisition is busy', async () => {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  const firstNow = 1_000_000;
  const leaseMs = 600_000;
  const first = new D1StaleAwareReliabilityStore({ db: d1, now: () => firstNow });
  const second = new D1StaleAwareReliabilityStore({ db: d1, now: () => firstNow + 30_000 });

  try {
    const acquired = await first.acquire({
      lockKey: 'tiktok:chemistry_k:bootstrap',
      ownerId: 'owner-one',
      leaseMs,
    });
    assert.equal(acquired.acquired, true);
    assert.equal(acquired.expiresAt, firstNow + leaseMs);

    const busy = await second.acquire({
      lockKey: 'tiktok:chemistry_k:bootstrap',
      ownerId: 'owner-two',
      leaseMs,
    });
    assert.equal(busy.acquired, false);
    assert.equal(busy.expiresAt, firstNow + leaseMs);
  } finally {
    d1.close();
  }
});
