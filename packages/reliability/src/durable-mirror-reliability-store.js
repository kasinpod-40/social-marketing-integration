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
    const primaryResult = await this.#savePrimary('saveSyncRun', entry);
    return this.#scheduleMirror({
      method: 'saveSyncRun',
      payload: toSyncRunMirrorPayload(entry),
      primaryResult,
    });
  }

  async saveSystemAlert(alert) {
    const primaryResult = await this.#savePrimary('saveSystemAlert', alert);
    const persisted = typeof this.primary.readSystemAlertForMirror === 'function'
      ? await this.primary.readSystemAlertForMirror(requireText(alert?.alertId, 'alert.alertId'))
      : alert;
    return this.#scheduleMirror({
      method: 'saveSystemAlert',
      payload: toSystemAlertMirrorPayload(persisted),
      primaryResult,
    });
  }

  async saveDeadLetter(deadLetter) {
    if (typeof this.primary.saveDeadLetter !== 'function') {
      throw new TypeError('Primary reliability store does not implement saveDeadLetter');
    }
    const primaryResult = await this.primary.saveDeadLetter(deadLetter);
    return Object.freeze({ primarySucceeded: true, primaryResult, mirrorScheduled: false });
  }

  async #savePrimary(method, payload) {
    if (typeof this.primary?.[method] !== 'function') {
      throw new TypeError(`Primary reliability store does not implement ${method}`);
    }
    return this.primary[method](payload);
  }

  async #scheduleMirror(input) {
    await this.outbox.schedule({ method: input.method, payload: input.payload });
    let mirrorScheduled = true;
    try {
      await this.queue.send(Object.freeze({
        schemaVersion: 1,
        type: this.deliveryJobType,
        requestedAt: new Date(this.now()).toISOString(),
      }));
    } catch (error) {
      // Outbox ถูก Persist แล้ว จึงห้ามเปลี่ยน D1 primary success เป็น Sync failure
      // เพียงเพราะ Wake-up signal ล้ม; Scheduled drain จะปลุกงาน pending ซ้ำ.
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
      primaryResult: input.primaryResult,
      mirrorScheduled,
    });
  }
}

function toSyncRunMirrorPayload(value) {
  return Object.freeze({
    syncId: requireText(value?.syncId, 'syncRun.syncId'),
    platform: requireText(value?.platform, 'syncRun.platform'),
    syncType: requireText(value?.syncType, 'syncRun.syncType'),
    status: requireText(value?.status, 'syncRun.status'),
    recordsPulled: nonNegativeInteger(value?.recordsPulled ?? 0, 'syncRun.recordsPulled'),
    recordsWritten: nonNegativeInteger(value?.recordsWritten ?? 0, 'syncRun.recordsWritten'),
    errorCode: optionalText(value?.errorCode),
    errorMessage: optionalText(value?.errorMessage),
  });
}

function toSystemAlertMirrorPayload(value) {
  return Object.freeze({
    alertId: requireText(value?.alertId, 'alert.alertId'),
    syncRunId: optionalText(value?.syncRunId),
    alertType: requireText(value?.alertType, 'alert.alertType'),
    severity: requireText(value?.severity, 'alert.severity'),
    platform: requireText(value?.platform, 'alert.platform'),
    status: requireText(value?.status, 'alert.status'),
    message: requireText(value?.message, 'alert.message'),
    errorCode: optionalText(value?.errorCode),
    createdAt: optionalNonNegativeInteger(value?.createdAt, 'alert.createdAt'),
  });
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

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`DurableMirrorReliabilityStore ${fieldName} must be a non-negative integer`);
  }
  return number;
}

function optionalNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return nonNegativeInteger(value, fieldName);
}
