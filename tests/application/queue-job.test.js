import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';

test('normalizes legacy object jobs to schema version 1', () => {
  const job = normalizeQueueJobMessage(
    { id: 'msg_1', body: { type: 'metric.definitions.seed' } },
    new Date('2026-07-11T00:00:00.000Z'),
  );

  assert.equal(job.id, 'msg_1');
  assert.equal(job.schemaVersion, 1);
  assert.equal(job.body.schemaVersion, 1);
  assert.equal(job.receivedAt, '2026-07-11T00:00:00.000Z');
});

test('parses JSON string jobs and normalizes requestedAt', () => {
  const job = normalizeQueueJobMessage({
    id: 'msg_2',
    body: JSON.stringify({
      schemaVersion: 1,
      type: 'tiktok.creator.native.validate',
      requestedAt: '2026-07-11T07:00:00+07:00',
    }),
  });

  assert.equal(job.body.type, 'tiktok.creator.native.validate');
  assert.equal(job.requestedAt, '2026-07-11T00:00:00.000Z');
  assert.equal(job.body.requestedAt, '2026-07-11T00:00:00.000Z');
});

test('rejects unsupported schema versions before routing', () => {
  assert.throws(
    () => normalizeQueueJobMessage({ body: { schemaVersion: 2, type: 'metric.definitions.seed' } }),
    (error) => error?.code === 'INVALID_SYNC_JOB_SCHEMA_VERSION',
  );
});

test('rejects invalid requestedAt and non-object bodies', () => {
  assert.throws(
    () => normalizeQueueJobMessage({ body: { type: 'metric.definitions.seed', requestedAt: 'not-a-date' } }),
    (error) => error?.code === 'INVALID_SYNC_JOB',
  );
  assert.throws(
    () => normalizeQueueJobMessage({ body: [] }),
    (error) => error?.code === 'INVALID_SYNC_JOB',
  );
});

test('schema version rejects booleans and decimal-like strings instead of coercing them to version 1', () => {
  assert.throws(
    () => normalizeQueueJobMessage({ body: { schemaVersion: true, type: 'metric.definitions.seed' } }),
    (error) => error?.code === 'INVALID_SYNC_JOB_SCHEMA_VERSION',
  );
  assert.throws(
    () => normalizeQueueJobMessage({ body: { schemaVersion: '1.0', type: 'metric.definitions.seed' } }),
    (error) => error?.code === 'INVALID_SYNC_JOB_SCHEMA_VERSION',
  );
});
