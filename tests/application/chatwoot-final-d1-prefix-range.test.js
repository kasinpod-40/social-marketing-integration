import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatwootFinalUatPreflightSql,
  buildChatwootFinalUatSnapshotSql,
  createChatwootFinalUatSession,
} from '../../scripts/lib/chatwoot-final-30d-daily-uat.js';

const HEAD = '761123b079a17ce8be4683d548f81d5b87802c8c';
const INITIAL_AT = Date.parse('2026-07-31T15:40:00Z');

function initialOperation() {
  return createChatwootFinalUatSession({
    repositoryHead: HEAD,
    createdAt: INITIAL_AT,
    initialRequestedAt: INITIAL_AT,
    dailyRequestedAt: INITIAL_AT + 1_000,
  }).initial;
}

test('Chatwoot D1 preflight and Snapshot avoid LIKE/GLOB pattern limits', () => {
  const operation = initialOperation();
  const preflight = buildChatwootFinalUatPreflightSql();
  const snapshot = buildChatwootFinalUatSnapshotSql(operation);
  const combined = `${preflight} ${snapshot}`;

  assert.doesNotMatch(combined, /\b(?:LIKE|GLOB)\b/iu);
  assert.match(preflight, /operation_id >= 'chatwoot-' AND operation_id < 'chatwoot\.'/u);
  assert.ok(preflight.includes("name >= 'chatwoot_' AND name < 'chatwoot`'"));
  assert.ok(preflight.includes("name >= 'idx_chatwoot_' AND name < 'idx_chatwoot`'"));

  const lower = `${operation.syncRunId}:unit:`;
  const upper = `${operation.syncRunId}:unit;`;
  const clause = `sync_run_id >= '${lower}' AND sync_run_id < '${upper}'`;
  assert.equal(snapshot.split(clause).length - 1, 5);
});
