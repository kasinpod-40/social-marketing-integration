import { JOB_TYPES } from '../packages/application/src/jobs/job-catalog.js';

const dlqId = requireText(process.env.DLQ_ID, 'DLQ_ID');
const job = Object.freeze({
  schemaVersion: 1,
  type: JOB_TYPES.DEAD_LETTER_REDRIVE,
  trigger: 'manual_admin',
  requestedAt: new Date().toISOString(),
  dlqId,
});

console.log(JSON.stringify(job, null, 2));

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}
