import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * Storage-neutral fake/local implementation ของ Resumable Work contract
 * ใช้ทดสอบ Resume, generation fence และ outbox semantics โดยไม่ใช้ใน Production
 */
export class InMemoryResumableWorkStore {
  constructor(input = {}) {
    this.works = new Map();
    this.generationFences = new Map();
    this.warningOutbox = new Map();
    this.resetEvents = [];
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.retentionMs = positiveInteger(input.retentionMs ?? 7 * 86_400_000, 'retentionMs');
  }

  async beginWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const cursorKey = requireText(input.cursorKey, 'cursorKey');
    const operationFingerprint = requireText(input.operationFingerprint, 'operationFingerprint');
    const requestedAt = timestamp(input.requestedAt ?? input.generation ?? this.now(), 'requestedAt');
    const generation = timestamp(input.generation ?? requestedAt, 'generation');
    const existing = this.works.get(workKey);

    if (existing && existing.generation !== generation) {
      throw permanentError('Resumable work key was reused with a different generation', {
        code: 'SYNC_WORK_GENERATION_MISMATCH',
        details: { generation },
      });
    }
    if (existing?.lifecycleStatus === 'completed') {
      return Object.freeze({
        workKey,
        resumed: true,
        superseded: false,
        completed: true,
        completion: structuredClone(existing.completion),
      });
    }
    if (existing && ['terminal', 'superseded'].includes(existing.lifecycleStatus)) {
      return Object.freeze({ workKey, resumed: false, superseded: true, completed: false });
    }
    if (existing && existing.operationFingerprint !== operationFingerprint) {
      throw permanentError('Resumable sync operation changed within the same active generation', {
        code: 'SYNC_WORK_OPERATION_MISMATCH',
        details: { generation },
      });
    }
    const fence = this.generationFences.get(cursorKey);
    if (fence && (generation < fence.generation
      || (generation === fence.generation && fence.workKey !== workKey))) {
      this.#recordTerminal({
        workKey,
        cursorKey,
        operationFingerprint,
        workType: requireText(input.workType, 'workType'),
        generation,
        requestedAt,
        lifecycleStatus: 'superseded',
        reason: 'SYNC_WORK_SUPERSEDED',
      });
      return Object.freeze({ workKey, resumed: false, superseded: true, completed: false });
    }
    this.generationFences.set(cursorKey, { generation, requestedAt, workKey });

    const resumed = existing?.lifecycleStatus === 'active'
      && existing.operationFingerprint === operationFingerprint;
    if (!resumed) {
      this.works.set(workKey, {
        operationFingerprint,
        cursorKey,
        workType: requireText(input.workType, 'workType'),
        generation,
        requestedAt,
        lifecycleStatus: 'active',
        phases: new Map(),
        completion: null,
      });
    }
    return Object.freeze({ workKey, resumed, superseded: false, completed: false });
  }

  async assertCurrentGeneration(input = {}) {
    const cursorKey = requireText(input.cursorKey, 'cursorKey');
    const workKey = requireText(input.workKey, 'workKey');
    const generation = timestamp(input.generation, 'generation');
    const fence = this.generationFences.get(cursorKey);
    if (!fence || fence.workKey !== workKey || fence.generation !== generation) {
      throw permanentError('Sync work generation was superseded by a newer job', {
        code: 'SYNC_WORK_SUPERSEDED',
        details: { generation },
      });
    }
    return true;
  }

  async loadPhase(input = {}) {
    return this.#phase(input.workKey, input.phase)?.progress ?? null;
  }

  async savePhase(input = {}) {
    const work = this.#activeWork(input.workKey);
    const phaseName = requireText(input.phase, 'phase');
    const current = work.phases.get(phaseName) ?? { units: new Map() };
    if (input.unit) {
      current.units.set(requireText(input.unit.unitKey, 'unit.unitKey'), Object.freeze({
        unitKey: input.unit.unitKey,
        sequence: nonNegativeInteger(input.unit.sequence, 'unit.sequence'),
        payload: structuredClone(input.unit.payload),
      }));
    }
    current.progress = Object.freeze({
      state: structuredClone(input.state ?? {}),
      expectedItems: nonNegativeInteger(input.expectedItems ?? 0, 'expectedItems'),
      processedItems: nonNegativeInteger(input.processedItems ?? 0, 'processedItems'),
      pagesProcessed: nonNegativeInteger(input.pagesProcessed ?? 0, 'pagesProcessed'),
      chunksProcessed: nonNegativeInteger(input.chunksProcessed ?? 0, 'chunksProcessed'),
      complete: input.complete === true,
    });
    work.phases.set(phaseName, current);
    return current.progress;
  }

  async listPhaseUnits(input = {}) {
    const phase = this.#phase(input.workKey, input.phase);
    const afterSequence = nonNegativeInteger(input.afterSequence ?? 0, 'afterSequence');
    const limit = positiveInteger(input.limit ?? 100, 'limit');
    const units = [...(phase?.units.values() ?? [])]
      .filter((unit) => unit.sequence >= afterSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit)
      .map((unit) => Object.freeze(structuredClone(unit)));
    return Object.freeze({
      units: Object.freeze(units),
      nextSequence: units.length === limit ? units.at(-1).sequence + 1 : null,
    });
  }

  async resetPhase(input = {}) {
    const work = this.#activeWork(input.workKey);
    const phase = requireText(input.phase, 'phase');
    work.phases.delete(phase);
    this.resetEvents.push(Object.freeze({ workKey: input.workKey, phase }));
    return true;
  }

  async saveWarningOutbox(input = {}) {
    const event = requireWarning(input);
    if (event.generationGuard) await this.assertCurrentGeneration(event.generationGuard);
    const existing = this.warningOutbox.get(event.outboxId);
    if (!existing) {
      const createdAt = timestamp(this.now(), 'now');
      this.warningOutbox.set(event.outboxId, {
        ...structuredClone(event),
        status: 'pending',
        deliveryAttempts: 0,
        createdAt,
        updatedAt: createdAt,
      });
    }
    return Object.freeze({ outboxId: event.outboxId, status: existing?.status ?? 'pending' });
  }

  async listPendingWarnings(input = {}) {
    const workKey = optionalText(input.workKey);
    const limit = positiveInteger(input.limit ?? 100, 'limit');
    return Object.freeze([...this.warningOutbox.values()]
      .filter((event) => (!workKey || event.workKey === workKey) && event.status === 'pending')
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0)
        || left.outboxId.localeCompare(right.outboxId))
      .slice(0, limit)
      .map((event) => Object.freeze(structuredClone(event))));
  }

  async markWarningDeliveryFailed(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const event = this.warningOutbox.get(outboxId);
    if (!event || event.status !== 'pending') return false;
    event.deliveryAttempts += 1;
    event.lastErrorCode = optionalText(input.errorCode) ?? 'SYNC_WARNING_ALERT_WRITE_FAILED';
    event.updatedAt = timestamp(input.updatedAt ?? this.now(), 'updatedAt');
    return true;
  }

  async markWarningDelivered(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const event = this.warningOutbox.get(outboxId);
    if (!event) return false;
    event.status = 'delivered';
    event.deliveryAttempts += 1;
    event.deliveredAt = timestamp(input.deliveredAt ?? this.now(), 'deliveredAt');
    return true;
  }

  async completeWork(input) {
    const value = typeof input === 'string' ? { workKey: input, completion: null } : input;
    const work = this.#work(value.workKey);
    work.phases.clear();
    work.lifecycleStatus = 'completed';
    work.completion = structuredClone(value.completion ?? null);
    work.completedAt = timestamp(this.now(), 'now');
    work.expiresAt = work.completedAt + this.retentionMs;
    return true;
  }

  async abandonWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const work = this.works.get(workKey);
    if (!work) return Object.freeze({ terminal: false, found: false });
    const hasPendingWarning = [...this.warningOutbox.values()]
      .some((event) => event.workKey === workKey && event.status === 'pending');
    if (work.lifecycleStatus === 'completed' && hasPendingWarning) {
      return Object.freeze({ terminal: false, found: true, status: 'completed' });
    }
    if (!['terminal', 'superseded'].includes(work.lifecycleStatus)) {
      work.lifecycleStatus = input.lifecycleStatus === 'superseded' ? 'superseded' : 'terminal';
      work.terminalReason = requireText(input.reason, 'reason');
      work.auditReference = optionalText(input.auditReference);
      work.abandonedAt = timestamp(this.now(), 'now');
      work.expiresAt = work.abandonedAt + this.retentionMs;
    }
    return Object.freeze({ terminal: true, found: true, status: work.lifecycleStatus });
  }

  async cleanupExpiredWork(input = {}) {
    const now = timestamp(input.now ?? this.now(), 'now');
    const limit = positiveInteger(input.limit ?? 100, 'limit');
    let deleted = 0;
    for (const [workKey, work] of this.works) {
      if (deleted >= limit) break;
      if (work.lifecycleStatus === 'active' || !(work.expiresAt <= now)) continue;
      if ([...this.warningOutbox.values()]
        .some((event) => event.workKey === workKey && event.status === 'pending')) continue;
      this.works.delete(workKey);
      for (const [outboxId, event] of this.warningOutbox) {
        if (event.workKey === workKey) this.warningOutbox.delete(outboxId);
      }
      deleted += 1;
    }
    return Object.freeze({ deleted });
  }

  #recordTerminal(input) {
    this.works.set(input.workKey, {
      ...input,
      phases: new Map(),
      completion: null,
      abandonedAt: timestamp(this.now(), 'now'),
      expiresAt: timestamp(this.now(), 'now') + this.retentionMs,
      terminalReason: input.reason,
    });
  }

  #activeWork(workKey) {
    const work = this.#work(workKey);
    if (work.lifecycleStatus !== 'active') throw new Error(`Resumable work is not active: ${workKey}`);
    return work;
  }

  #work(workKey) {
    const key = requireText(workKey, 'workKey');
    const work = this.works.get(key);
    if (!work) throw new Error(`Unknown resumable work: ${key}`);
    return work;
  }

  #phase(workKey, phase) {
    return this.#work(workKey).phases.get(requireText(phase, 'phase')) ?? null;
  }
}

function requireWarning(input) {
  return Object.freeze({
    outboxId: requireText(input.outboxId, 'outboxId'),
    workKey: requireText(input.workKey, 'workKey'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    warningType: requireText(input.warningType, 'warningType'),
    sourceKey: requireText(input.sourceKey, 'sourceKey'),
    payload: structuredClone(input.payload ?? {}),
    generationGuard: input.generationGuard ? Object.freeze({
      cursorKey: requireText(input.generationGuard.cursorKey, 'generationGuard.cursorKey'),
      generation: timestamp(input.generationGuard.generation, 'generationGuard.generation'),
      workKey: requireText(input.generationGuard.workKey, 'generationGuard.workKey'),
    }) : null,
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}
function nonNegativeInteger(value, fieldName) {
  return timestamp(value, fieldName);
}
function positiveInteger(value, fieldName) {
  const number = nonNegativeInteger(value, fieldName);
  if (number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
