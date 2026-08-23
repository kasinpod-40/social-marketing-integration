export const META_PAID_LARK_DRAIN_CLOSEOUT_CONTRACT_VERSION =
  'meta_paid_lark_drain_closeout_v1';

export const META_PAID_LARK_DRAIN_POLL_MS = 30_000;
export const META_PAID_LARK_DRAIN_MAX_POLLS = 720;

export function classifyMetaPaidLarkDrainStep(input = {}) {
  const initialWorkKeys = new Set(normalizeKeys(input.initialWorkKeys));
  const previous = normalizeCounts(input.previous);
  const current = normalizeCounts(input.current);
  const currentWorkKeys = normalizeKeys(input.currentWorkKeys);
  const appearedWorkKeys = currentWorkKeys.filter((key) => !initialWorkKeys.has(key));
  const idle = current.activeWork === 0
    && current.activeQueueOperations === 0
    && current.activeLocks === 0;
  const previousIdle = previous.activeWork === 0
    && previous.activeQueueOperations === 0
    && previous.activeLocks === 0;

  if (input.staleReviewRequired === true) {
    return deepFreeze({
      action: 'stop_exact_recovery_review_required',
      appearedWorkKeys,
      idle,
      previousIdle,
    });
  }
  if (idle && previousIdle) {
    return deepFreeze({
      action: 'launch_existing_closeout',
      appearedWorkKeys,
      idle: true,
      previousIdle: true,
    });
  }
  return deepFreeze({
    action: 'continue_read_only_drain',
    appearedWorkKeys,
    idle,
    previousIdle,
  });
}

function normalizeCounts(value = {}) {
  const activeWork = nonNegative(value.activeWork);
  const activeQueueOperations = nonNegative(value.activeQueueOperations);
  const activeLocks = nonNegative(value.activeLocks);
  return Object.freeze({ activeWork, activeQueueOperations, activeLocks });
}

function normalizeKeys(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value
    .filter((item) => typeof item === 'string' && item.length > 0)
    .map((item) => item.trim())
    .filter(Boolean));
}

function nonNegative(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error('Drain closeout counts must be non-negative integers');
  }
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
