/**
 * Persist D1 primary + Durable outbox แล้วส่งเพียง Generic drain signal เข้า Queue
 * ไม่เรียก Lark network ใน request path ของ Reliability runner
 */
export class DurableMirrorReliabilityStore {
  constructor(input = {}) {
    this.primary = requireStore(input.primary, 'primary');
    this.outbox = requireOutbox(input.outbox);
    this.queue = requireQueue(input.queue);
    this.deliveryJobType = requireText(input.deliveryJobType, 'deliveryJobType');
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.onScheduleError = typeof input.onScheduleError === 'function'
      ? input.onScheduleError
      : () => undefined;
  }

  async saveSyncRun(entry) {
    return this.#persistAndSchedule('saveSyncRun', entry);
  }

  async saveSystemAlert(alert) {
    return this.#persistAndSchedule('saveSystemAlert', alert);
  }

  async saveDeadLetter(deadLetter) {
    if (typeof this.primary.saveDeadLetter !== 'function') {
      throw new TypeError('Primary reliability store does not implement saveDeadLetter');
    }
    const primaryResult = await this.primary.saveDeadLetter(deadLetter);
    return Object.freeze({ primarySucceeded: true, primaryResult, mirrorScheduled: false });
  }

  async #persistAndSchedule(method, payload) {
    if (typeof this.primary?.[method] !== 'function') {
      throw new TypeError(`Primary reliability store does not implement ${method}`);
    }
    const primaryResult = await this.primary[method](payload);
    await this.outbox.schedule({ method, payload });
    let mirrorScheduled = true;
    try {
      await this.queue.send(Object.freeze({
        schemaVersion: 1,
        type: this.deliveryJobType,
        requestedAt: new Date(this.now()).toISOString(),
      }));
    } catch (error) {
      // Outbox ถูก Persist แล้ว จึงห้ามเปลี่ยน D1 primary success เป็น Sync failure
      // เพียงเพราะ Wake-up signal ล้ม; รอบถัดไปสามารถส่ง Generic drain ซ้ำได้.
      mirrorScheduled = false;
      try {
        this.onScheduleError({
          stage: 'reliability_mirror_signal_failed',
          code: 'RELIABILITY_MIRROR_QUEUE_SEND_FAILED',
          error,
        });
      } catch {
        // Diagnostics callback ห้ามเปลี่ยนผล D1 primary/outbox ที่ Persist สำเร็จแล้ว.
      }
    }
    return Object.freeze({
      primarySucceeded: true,
      primaryResult,
      mirrorScheduled,
    });
  }
}

function requireStore(value, fieldName) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`DurableMirrorReliabilityStore requires ${fieldName}`);
  }
  return value;
}

function requireOutbox(value) {
  if (typeof value?.schedule !== 'function') {
    throw new TypeError('DurableMirrorReliabilityStore requires outbox.schedule');
  }
  return value;
}

function requireQueue(value) {
  if (typeof value?.send !== 'function') {
    throw new TypeError('DurableMirrorReliabilityStore requires queue.send');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`DurableMirrorReliabilityStore requires ${fieldName}`);
  }
  return value.trim();
}
