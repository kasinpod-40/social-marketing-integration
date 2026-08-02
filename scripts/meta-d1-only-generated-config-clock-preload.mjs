#!/usr/bin/env node

const TIMESTAMP_ENV_NAMES = Object.freeze([
  'MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT',
  'MKT_META_LARK_ORIGINAL_REQUESTED_AT',
]);

for (const envName of TIMESTAMP_ENV_NAMES) {
  canonicalizeEpochTimestampEnvironment(envName);
}

const realDateNow = Date.now.bind(Date);
let lastIssued = Number.NEGATIVE_INFINITY;

Object.defineProperty(Date, 'now', {
  configurable: true,
  enumerable: false,
  writable: false,
  value() {
    const observed = realDateNow();
    lastIssued = observed > lastIssued ? observed : lastIssued + 1;
    return lastIssued;
  },
});

function canonicalizeEpochTimestampEnvironment(envName) {
  const value = process.env[envName];
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return;

  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < Date.UTC(2000, 0, 1)) return;

  process.env[envName] = new Date(epoch).toISOString();
}
