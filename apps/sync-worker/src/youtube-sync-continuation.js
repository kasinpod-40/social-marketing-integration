import { withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { permanentError, transientError } from '../../../packages/shared/src/errors/runtime-error.js';

/** Enqueue only after the YouTube use case has persisted its bounded source phase. */
export async function enqueueYouTubeSyncContinuation(input = {}) {
  if (input.result?.continuationRequired !== true) return false;
  if (input.operation?.stable !== true) {
    throw permanentError('YouTube bounded continuation requires stable Queue identity', {
      code: 'YOUTUBE_CONTINUATION_STABLE_OPERATION_REQUIRED',
    });
  }
  if (typeof input.env?.MKT_SYNC_QUEUE?.send !== 'function') {
    throw transientError('YouTube continuation Queue binding is unavailable', {
      code: 'YOUTUBE_CONTINUATION_QUEUE_UNAVAILABLE',
    });
  }
  try {
    await input.env.MKT_SYNC_QUEUE.send(withQueueOperation({
      ...input.originalBody,
      continuation: true,
      continuationPhase: input.result.continuationPhase,
    }, input.operation));
  } catch (cause) {
    throw transientError('YouTube continuation Queue send failed', {
      code: 'YOUTUBE_CONTINUATION_QUEUE_SEND_FAILED',
      cause,
    });
  }
  return true;
}
