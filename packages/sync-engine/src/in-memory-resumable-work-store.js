/**
 * Storage-neutral fake/local implementation ของ Resumable Work contract
 * ใช้ทดสอบ Resume semantics โดยไม่จำลอง SQL และไม่ใช้เป็น Cloud production store
 */
export class InMemoryResumableWorkStore {
  constructor() {
    this.works = new Map();
    this.resetEvents = [];
  }

  async beginWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const operationFingerprint = requireText(input.operationFingerprint, 'operationFingerprint');
    const existing = this.works.get(workKey);
    const resumed = existing?.operationFingerprint === operationFingerprint;
    if (!resumed) {
      this.works.set(workKey, {
        operationFingerprint,
        cursorKey: requireText(input.cursorKey, 'cursorKey'),
        workType: requireText(input.workType, 'workType'),
        phases: new Map(),
      });
    }
    return Object.freeze({ workKey, resumed });
  }

  async loadPhase(input = {}) {
    return this.#phase(input.workKey, input.phase)?.progress ?? null;
  }

  async savePhase(input = {}) {
    const work = this.#work(input.workKey);
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
    const work = this.#work(input.workKey);
    const phase = requireText(input.phase, 'phase');
    work.phases.delete(phase);
    this.resetEvents.push(Object.freeze({ workKey: input.workKey, phase }));
    return true;
  }

  async completeWork(workKey) {
    this.works.delete(requireText(workKey, 'workKey'));
    return true;
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

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}

function positiveInteger(value, fieldName) {
  const number = nonNegativeInteger(value, fieldName);
  if (number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
