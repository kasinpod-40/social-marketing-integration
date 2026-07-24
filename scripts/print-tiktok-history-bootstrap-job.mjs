import { randomUUID } from 'node:crypto';

const requestedAt = readRequestedAt(process.env.REQUESTED_AT);
const originalRequestedAt = Date.parse(requestedAt);
const operationId = readOperationId(process.env.OPERATION_ID);
const dryRun = readBoolean(process.env.DRY_RUN, true);

const job = Object.freeze({
  schemaVersion: 1,
  type: 'tiktok.creator.native.history.bootstrap',
  trigger: 'manual',
  operationId,
  workKey: `tiktok:${operationId}`,
  generation: originalRequestedAt,
  originalRequestedAt,
  requestedAt,
  dryRun,
});

// Payload-only helper: prints validated JSON and never sends a Queue message.
console.log(JSON.stringify(job, null, 2));

function readRequestedAt(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('REQUESTED_AT must be a valid ISO-8601 date-time');
  }
  return date.toISOString();
}

function readOperationId(value) {
  const operationId = value?.trim() || randomUUID().replaceAll('-', '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/u.test(operationId)) {
    throw new TypeError('OPERATION_ID must be 8-128 safe identity characters');
  }
  return operationId;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new TypeError('DRY_RUN must be true or false');
}
