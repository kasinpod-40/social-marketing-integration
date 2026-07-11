/**
 * Reliability store แบบ Primary + Mirrors
 *
 * กฎสำคัญ:
 * - Primary ต้องสำเร็จเสมอ ไม่เช่นนั้น Operation ล้มเหลวทันที
 * - Mirror เป็น best effort และห้ามกลบผลของ Primary
 * - ใช้ D1 เป็น Primary บน Cloudflare และ Lark เป็น Mirror สำหรับมนุษย์
 */
export class CompositeReliabilityStore {
  constructor(input = {}) {
    this.primary = requireStore(input.primary, 'primary');
    this.mirrors = requireMirrors(input.mirrors ?? []);
    this.onStoreError = typeof input.onStoreError === 'function' ? input.onStoreError : () => undefined;
  }

  async saveSyncRun(entry) {
    return this.#invoke('saveSyncRun', entry);
  }

  async saveSystemAlert(alert) {
    return this.#invoke('saveSystemAlert', alert);
  }

  async saveDeadLetter(deadLetter) {
    return this.#invoke('saveDeadLetter', deadLetter);
  }

  async #invoke(methodName, payload) {
    if (typeof this.primary?.[methodName] !== 'function') {
      throw new TypeError(`Primary reliability store does not implement ${methodName}`);
    }

    // Primary เป็น source of truth จึงต้อง Await และปล่อย Error ขึ้นทันที
    const primaryResult = await this.primary[methodName](payload);
    const targets = this.mirrors.filter((store) => typeof store?.[methodName] === 'function');
    const settled = await Promise.allSettled(targets.map((store) => store[methodName](payload)));
    let mirrorSuccessCount = 0;
    const mirrorFailures = [];

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        mirrorSuccessCount += 1;
        return;
      }
      mirrorFailures.push(result.reason);
      this.onStoreError({
        method: methodName,
        role: 'mirror',
        store: targets[index]?.constructor?.name ?? 'unknown',
        error: result.reason,
      });
    });

    return Object.freeze({
      primarySucceeded: true,
      primaryResult,
      mirrorSuccessCount,
      mirrorFailureCount: mirrorFailures.length,
    });
  }
}

function requireStore(value, fieldName) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`CompositeReliabilityStore requires ${fieldName}`);
  }
  return value;
}

function requireMirrors(value) {
  if (!Array.isArray(value)) throw new TypeError('CompositeReliabilityStore mirrors must be an array');
  return Object.freeze(value.map((store, index) => requireStore(store, `mirrors[${index}]`)));
}
