import { withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { permanentError, transientError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  DEFAULT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION,
  DEFAULT_TIKTOK_SOURCE_PAGES_PER_INVOCATION,
  readPositiveInteger,
  readSyncJobGeneration,
  requireJobText,
} from './worker-runtime-support.js';

/** Resolve durable TikTok identity and bounded invocation budgets from the Queue contract. */
export function resolveTikTokSyncInvocation(input = {}) {
  const operation = input.operation?.stable === true ? input.operation : null;
  const requestedAt = operation?.originalRequestedAt
    ?? readSyncJobGeneration(input.job, 'TikTok', input.message?.timestamp);
  return Object.freeze({
    operation,
    requestedAt,
    generation: operation?.generation ?? requestedAt,
    workKey: operation?.workKey
      ?? `tiktok:${requireJobText(input.message?.id, 'message.id')}`,
    continuationSequence: input.job?.body?.continuationSequence,
    ...(operation ? {
      maxSourcePagesPerInvocation: readPositiveInteger(
        input.env?.MKT_TIKTOK_SOURCE_PAGES_PER_INVOCATION,
        DEFAULT_TIKTOK_SOURCE_PAGES_PER_INVOCATION,
      ),
      maxBusinessUnitsPerInvocation: readPositiveInteger(
        input.env?.MKT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION,
        DEFAULT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION,
      ),
    } : {}),
  });
}

/** Enqueue only after the use case has persisted its durable invocation checkpoint. */
export async function enqueueTikTokSyncContinuation(input = {}) {
  if (input.result?.continuationRequired !== true) return false;
  if (!input.operation?.stable) {
    throw permanentError('TikTok bounded continuation requires stable Queue identity', {
      code: 'TIKTOK_CONTINUATION_STABLE_OPERATION_REQUIRED',
    });
  }
  if (typeof input.env?.MKT_SYNC_QUEUE?.send !== 'function') {
    throw transientError('TikTok continuation Queue binding is unavailable', {
      code: 'TIKTOK_CONTINUATION_QUEUE_UNAVAILABLE',
    });
  }
  const body = withQueueOperation({
    ...input.originalBody,
    continuation: true,
    continuationSequence: input.result.continuationSequence,
    continuationPhase: input.result.continuationPhase,
    continuationNextSequence: input.result.continuationNextSequence,
  }, input.operation);
  try {
    await input.env.MKT_SYNC_QUEUE.send(body);
  } catch (cause) {
    throw transientError('TikTok continuation Queue send failed', {
      code: 'TIKTOK_CONTINUATION_QUEUE_SEND_FAILED',
      cause,
    });
  }
  return true;
}
