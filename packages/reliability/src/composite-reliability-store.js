/**
 * เขียน Operational state ไปหลายปลายทางพร้อมกัน เช่น D1 + Lark Base
 *
 * หลักการ:
 * - สำเร็จอย่างน้อยหนึ่ง Store ถือว่าบันทึกได้ เพื่อไม่ให้ Lark mirror ล่มแล้วหยุดงานที่ D1 เก็บครบ
 * - ถ้าทุก Store ล้มเหลวจึงโยน Error
 * - Error ของ Store รองถูกส่งเข้า onStoreError สำหรับ Structured log โดยไม่กลบผลหลัก
 */
export class CompositeReliabilityStore {
  constructor(input = {}) {
    this.stores = requireStores(input.stores);
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
    const targets = this.stores.filter((store) => typeof store?.[methodName] === 'function');
    if (targets.length === 0) {
      throw new TypeError(`No reliability store implements ${methodName}`);
    }

    const settled = await Promise.allSettled(targets.map((store) => store[methodName](payload)));
    const failures = [];
    let successCount = 0;

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount += 1;
        return;
      }
      failures.push(result.reason);
      this.onStoreError({
        method: methodName,
        store: targets[index]?.constructor?.name ?? 'unknown',
        error: result.reason,
      });
    });

    if (successCount === 0) throw failures[0] ?? new Error(`${methodName} failed in every store`);
    return Object.freeze({ successCount, failureCount: failures.length });
  }
}

function requireStores(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('CompositeReliabilityStore requires at least one store');
  }
  return Object.freeze([...value]);
}
