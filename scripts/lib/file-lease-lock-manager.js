import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';

/**
 * Lease lock สำหรับ Local scripts บนเครื่องเดียวกัน
 * ใช้การสร้างไฟล์แบบ exclusive เพื่อกัน Terminal/Process สองตัว Sync พร้อมกัน
 * ไม่ครอบ Local กับ Cloudflare พร้อมกัน จึงยังห้ามรัน Local write ระหว่างเปิด Cloud Cron
 */
export class FileLeaseLockManager {
  constructor(input = {}) {
    this.directory = input.directory ?? '.mkt-locks';
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async acquire(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');
    const leaseMs = positiveInteger(input?.leaseMs, 'leaseMs');
    await mkdir(this.directory, { recursive: true });
    const filePath = this.#path(lockKey);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const now = this.now();
      const payload = JSON.stringify({ lockKey, ownerId, acquiredAt: now, expiresAt: now + leaseMs });
      try {
        const handle = await open(filePath, 'wx', 0o600);
        await handle.writeFile(payload, 'utf8');
        await handle.close();
        return Object.freeze({ acquired: true, lockKey, ownerId, expiresAt: now + leaseMs, filePath });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw lockError('create', error, lockKey);
        const existing = await readLock(filePath);
        if (existing?.expiresAt <= now) {
          await rm(filePath, { force: true });
          continue;
        }
        return Object.freeze({
          acquired: false,
          lockKey,
          ownerId,
          expiresAt: Number(existing?.expiresAt ?? 0),
          filePath,
        });
      }
    }

    return Object.freeze({ acquired: false, lockKey, ownerId, expiresAt: 0, filePath });
  }

  async release(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');
    const filePath = this.#path(lockKey);
    const existing = await readLock(filePath);
    if (!existing) return false;
    if (existing.ownerId !== ownerId) {
      throw transientError(`Local sync lock owner mismatch for ${lockKey}`, {
        code: 'LOCAL_SYNC_LOCK_OWNER_MISMATCH',
        details: { lockKey },
      });
    }
    await rm(filePath, { force: true });
    return true;
  }

  #path(lockKey) {
    const digest = createHash('sha256').update(lockKey).digest('hex');
    return join(this.directory, `${digest}.lock`);
  }
}

async function readLock(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    // ไฟล์เสียถือว่า Stale และลบได้ในรอบ acquire ถัดไป
    if (error instanceof SyntaxError) return { ownerId: null, expiresAt: 0 };
    throw error;
  }
}

function lockError(operation, cause, lockKey) {
  return transientError(`Local sync lock ${operation} failed`, {
    code: 'LOCAL_SYNC_LOCK_FAILED',
    cause,
    details: { lockKey, causeMessage: cause instanceof Error ? cause.message : String(cause) },
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`FileLeaseLockManager requires ${fieldName}`);
  }
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`FileLeaseLockManager ${fieldName} must be a positive integer`);
  }
  return number;
}
