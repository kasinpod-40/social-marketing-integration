import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * สถานะความพร้อมสำหรับบัญชีที่มีโพสต์/วิดีโอ/ออเดอร์/บทสนทนาจำนวนมาก
 *
 * - verified: ผ่าน Technical gates, Large fixture และ Live account UAT แล้ว
 * - dev_ready: Technical gates + Large fixture ผ่าน เหลือ Live account UAT
 * - foundation_ready: มี Flow หลักแล้วแต่ยังขาด Technical gate หรือ Large fixture
 * - planned: ยังเป็น Contract/Blueprint และห้าม Production
 */
export const LARGE_ACCOUNT_STATUS = Object.freeze({
  VERIFIED: 'verified',
  DEV_READY: 'dev_ready',
  FOUNDATION_READY: 'foundation_ready',
  PLANNED: 'planned',
});

export const LARGE_ACCOUNT_REQUIRED_GATES = Object.freeze([
  'fullBackfill',
  'incrementalSync',
  'periodicFullReconciliation',
  'boundedPagination',
  'durableResume',
  'boundedChunking',
  'stableKeyIdempotency',
  'completenessAccounting',
  'rateLimitAwareRetry',
  'largeAccountFixture',
  'liveAccountUat',
]);

/** สร้าง Contract ที่ validate/freeze แล้วสำหรับเก็บใน Connector catalog */
export function createLargeAccountReadiness(input = {}) {
  const status = requireChoice(
    input.status,
    'largeAccount.status',
    Object.values(LARGE_ACCOUNT_STATUS),
  );
  const primaryEntity = requireText(input.primaryEntity, 'largeAccount.primaryEntity');
  const minimumFixtureItems = positiveInteger(
    input.minimumFixtureItems,
    'largeAccount.minimumFixtureItems',
  );
  const gates = Object.freeze(Object.fromEntries(
    LARGE_ACCOUNT_REQUIRED_GATES.map((gate) => [gate, input.gates?.[gate] === true]),
  ));
  const missingGates = Object.freeze(
    LARGE_ACCOUNT_REQUIRED_GATES.filter((gate) => gates[gate] !== true),
  );

  if (status === LARGE_ACCOUNT_STATUS.VERIFIED && missingGates.length > 0) {
    throw invalidLargeAccountContract('verified status requires every gate', {
      status,
      missingGates,
    });
  }
  if (status === LARGE_ACCOUNT_STATUS.DEV_READY) {
    const missingBeforeLiveUat = missingGates.filter((gate) => gate !== 'liveAccountUat');
    if (missingBeforeLiveUat.length > 0 || gates.liveAccountUat === true) {
      throw invalidLargeAccountContract('dev_ready requires every technical/fixture gate and pending liveAccountUat', {
        status,
        missingGates,
      });
    }
  }

  return Object.freeze({
    status,
    primaryEntity,
    minimumFixtureItems,
    gates,
    missingGates,
    productionReady: status === LARGE_ACCOUNT_STATUS.VERIFIED,
  });
}

function invalidLargeAccountContract(message, details) {
  return permanentError(`Invalid large-account connector contract: ${message}`, {
    code: 'MKT_LARGE_ACCOUNT_CONTRACT_INVALID',
    details,
  });
}

function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.includes(text)) {
    throw invalidLargeAccountContract(`${fieldName} must be one of: ${choices.join(', ')}`, {
      fieldName,
      value: text,
    });
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidLargeAccountContract(`${fieldName} is required`, { fieldName });
  }
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw invalidLargeAccountContract(`${fieldName} must be a positive integer`, { fieldName });
  }
  return number;
}
