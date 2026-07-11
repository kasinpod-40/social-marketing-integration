import { transientError } from '../../shared/src/errors/runtime-error.js';

/**
 * Lease lock สำหรับ Unit test หรือ Runtime ภายใน Process เดียว
 * ไม่ใช่ Distributed lock และห้ามใช้แทน D1 เมื่อ Deploy Cloudflare หลาย invocation
 */
export class InMemoryLeaseLockManager {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.locks = new Map();
  }

  async acquire(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');
    const leaseMs = positiveInteger(input?.leaseMs, 'leaseMs');
    const now = this.now();
    const existing = this.locks.get(lockKey);

    if (existing && existing.expiresAt > now && existing.ownerId !== ownerId) {
      return Object.freeze({ acquired: false, lockKey, ownerId, expiresAt: existing.expiresAt });
    }

    const lock = Object.freeze({ acquired: true, lockKey, ownerId, expiresAt: now + leaseMs });
    this.locks.set(lockKey, lock);
    return lock;
  }

  async release(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');
    const existing = this.locks.get(lockKey);
    if (!existing) return false;
    if (existing.ownerId !== ownerId) {
      throw transientError(`Cannot release lock ${lockKey}: owner mismatch`, {
        code: 'SYNC_LOCK_OWNER_MISMATCH',
        details: { lockKey },
      });
    }
    this.locks.delete(lockKey);
    return true;
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`InMemoryLeaseLockManager requires ${fieldName}`);
  }
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError(`InMemoryLeaseLockManager ${fieldName} must be a positive integer`);
  }
  return number;
}
