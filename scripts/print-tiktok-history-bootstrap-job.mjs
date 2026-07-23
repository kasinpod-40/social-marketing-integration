const requestedAt = readRequestedAt(process.env.REQUESTED_AT);
const dryRun = readBoolean(process.env.DRY_RUN, true);

const job = Object.freeze({
  schemaVersion: 1,
  type: 'tiktok.creator.native.history.bootstrap',
  trigger: 'manual',
  requestedAt,
  dryRun,
});

console.log(JSON.stringify(job, null, 2));

function readRequestedAt(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('REQUESTED_AT must be a valid ISO-8601 date-time');
  }
  return date.toISOString();
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new TypeError('DRY_RUN must be true or false');
}
